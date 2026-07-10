import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { PlaceImageResult } from "../../types/places.js";

/**
 * Pixel-level photo checks — complements the metadata-only heuristics in
 * scorePhotoResultMetadata with ground truth from the actual image bytes:
 *
 * - Monochrome: decode a small raster and measure per-pixel saturation. A true
 *   B&W/grayscale image has near-zero saturation regardless of what its caption
 *   says. (Sepia/toned images keep moderate saturation and remain the metadata
 *   layer's job — a uniform-hue rule would false-positive on blue-sky photos.)
 * - Text-on-image: OCR (tesseract.js) over the image; confident alphabetic words
 *   mean rendered text (posters, memes, watermark banners).
 *
 * Everything is best-effort: fetch/decode/OCR failures never reject a photo,
 * they just mark it unverified.
 */

export type PixelPhotoAnalysis = {
  fetched: boolean;
  width?: number;
  height?: number;
  meanSaturation?: number;
  saturationP90?: number;
  monochrome?: boolean;
  textDetected?: boolean;
  textSample?: string;
  failReason?: string;
};

const MONO_MEAN_SAT_MAX = 0.08;
const MONO_P90_SAT_MAX = 0.15;

export async function fetchImageBuffer(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Buffer | null> {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const maxBytes = opts.maxBytes ?? 6 * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "locava-photo-check/1.0", accept: "image/*" },
    });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Decode + downsample, then measure saturation. Pure function over bytes — unit-testable. */
export async function analyzeColorFromBuffer(buf: Buffer): Promise<{
  width: number;
  height: number;
  meanSaturation: number;
  saturationP90: number;
  monochrome: boolean;
}> {
  const meta = await sharp(buf).metadata();
  const { data, info } = await sharp(buf)
    .resize(96, 96, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const saturations: number[] = [];
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    saturations.push(max === 0 ? 0 : (max - min) / max);
  }
  saturations.sort((a, b) => a - b);
  const mean = saturations.reduce((s, v) => s + v, 0) / Math.max(saturations.length, 1);
  const p90 = saturations[Math.min(saturations.length - 1, Math.floor(saturations.length * 0.9))] ?? 0;

  return {
    width: meta.width ?? info.width,
    height: meta.height ?? info.height,
    meanSaturation: mean,
    saturationP90: p90,
    monochrome: mean < MONO_MEAN_SAT_MAX && p90 < MONO_P90_SAT_MAX,
  };
}

/** OCR the buffer; report confident alphabetic words only. Lazy-loads tesseract. */
export async function detectTextFromBuffer(
  buf: Buffer,
): Promise<{ textDetected: boolean; textSample?: string } | null> {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      cachePath: path.join(os.tmpdir(), "locava-tessdata"),
      // silence per-job logging
      logger: () => {},
    });
    try {
      // Upscale small images a bit for OCR reliability, cap size for speed.
      const prepared = await sharp(buf).resize(900, 900, { fit: "inside", withoutEnlargement: false }).png().toBuffer();
      const { data } = await worker.recognize(prepared);
      const confidence = data.confidence ?? 0;
      const words = (data.text ?? "").match(/[A-Za-z]{3,}/g) ?? [];
      // Natural photos OCR to sparse garbage at low confidence; rendered text
      // yields several clean words at decent page confidence.
      const strong =
        (confidence >= 60 && words.length >= 3) ||
        (confidence >= 75 && words.some((w) => w.length >= 6));
      return {
        textDetected: strong,
        textSample: strong ? words.slice(0, 4).join(" ") : undefined,
      };
    } finally {
      await worker.terminate();
    }
  } catch {
    return null; // OCR unavailable — never blocks
  }
}

export type PixelCheckedResult = {
  result: PlaceImageResult;
  analysis: PixelPhotoAnalysis;
  rejectReasons: string[];
};

export type PixelCheckSummary = {
  kept: PlaceImageResult[];
  rejected: PixelCheckedResult[];
  analyzed: number;
  ocrRan: number;
  unverified: number;
};

/**
 * Run pixel checks over search results. `maxImages` bounds fetch+decode work;
 * `maxOcr` bounds the (much slower) OCR pass, applied to the first results —
 * callers should pass results already ranked best-first.
 */
export async function applyPixelQualityChecks(
  results: PlaceImageResult[],
  opts: { maxImages?: number; maxOcr?: number; fetcher?: typeof fetchImageBuffer } = {},
): Promise<PixelCheckSummary> {
  const maxImages = opts.maxImages ?? 8;
  const maxOcr = opts.maxOcr ?? 4;
  const fetcher = opts.fetcher ?? fetchImageBuffer;

  const kept: PlaceImageResult[] = [];
  const rejected: PixelCheckedResult[] = [];
  let analyzed = 0;
  let ocrRan = 0;
  let unverified = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (i >= maxImages) {
      kept.push(result);
      continue;
    }
    const buf = await fetcher(result.imageUrl);
    if (!buf) {
      unverified += 1;
      kept.push(result); // best-effort: unfetchable ≠ bad
      continue;
    }
    const analysis: PixelPhotoAnalysis = { fetched: true };
    const reasons: string[] = [];
    try {
      const color = await analyzeColorFromBuffer(buf);
      analyzed += 1;
      analysis.width = color.width;
      analysis.height = color.height;
      analysis.meanSaturation = Number(color.meanSaturation.toFixed(3));
      analysis.saturationP90 = Number(color.saturationP90.toFixed(3));
      analysis.monochrome = color.monochrome;
      if (color.monochrome) reasons.push("monochrome_pixels");
    } catch {
      unverified += 1;
      kept.push(result);
      continue;
    }
    if (reasons.length === 0 && ocrRan < maxOcr) {
      const ocr = await detectTextFromBuffer(buf);
      if (ocr) {
        ocrRan += 1;
        analysis.textDetected = ocr.textDetected;
        analysis.textSample = ocr.textSample;
        if (ocr.textDetected) reasons.push("text_on_image");
      }
    }
    if (reasons.length > 0) {
      rejected.push({ result, analysis, rejectReasons: reasons });
    } else {
      kept.push(result);
    }
  }

  return { kept, rejected, analyzed, ocrRan, unverified };
}
