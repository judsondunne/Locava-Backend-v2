import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { analyzeColorFromBuffer, applyPixelQualityChecks } from "./pixelPhotoChecks.js";
import type { PlaceImageResult } from "../../types/places.js";

async function solid(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

async function grayscaleGradient(): Promise<Buffer> {
  // 64x64 raw grayscale ramp rendered into RGB.
  const px = Buffer.alloc(64 * 64 * 3);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const v = Math.floor((x / 63) * 255);
      const i = (y * 64 + x) * 3;
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
    }
  }
  return sharp(px, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
}

async function colorfulGradient(): Promise<Buffer> {
  const px = Buffer.alloc(64 * 64 * 3);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 3;
      px[i] = Math.floor((x / 63) * 255);
      px[i + 1] = Math.floor((y / 63) * 255);
      px[i + 2] = 180;
    }
  }
  return sharp(px, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
}

function fakeResult(id: string): PlaceImageResult {
  return {
    id,
    imageUrl: `https://img.example.com/${id}.png`,
    caption: "Warren Falls Vermont",
    sourceName: "example",
    sourceUrl: "https://example.com",
  } as PlaceImageResult;
}

describe("analyzeColorFromBuffer", () => {
  it("flags a solid gray image as monochrome", async () => {
    const a = await analyzeColorFromBuffer(await solid(128, 128, 128));
    expect(a.monochrome).toBe(true);
    expect(a.meanSaturation).toBeLessThan(0.05);
  });

  it("flags a grayscale gradient as monochrome", async () => {
    const a = await analyzeColorFromBuffer(await grayscaleGradient());
    expect(a.monochrome).toBe(true);
  });

  it("does not flag a colorful image", async () => {
    const a = await analyzeColorFromBuffer(await colorfulGradient());
    expect(a.monochrome).toBe(false);
    expect(a.meanSaturation).toBeGreaterThan(0.2);
  });

  it("does not flag a saturated single-color (e.g. sky-like) image", async () => {
    const a = await analyzeColorFromBuffer(await solid(70, 130, 220));
    expect(a.monochrome).toBe(false);
  });
});

describe("applyPixelQualityChecks", () => {
  it("rejects monochrome images and keeps colorful ones (injected fetcher, no OCR)", async () => {
    const buffers: Record<string, Buffer> = {
      gray: await grayscaleGradient(),
      color: await colorfulGradient(),
    };
    const results = [fakeResult("gray"), fakeResult("color")];
    const summary = await applyPixelQualityChecks(results, {
      maxOcr: 0,
      fetcher: async (url: string) => buffers[url.includes("gray") ? "gray" : "color"] ?? null,
    });
    expect(summary.analyzed).toBe(2);
    expect(summary.rejected.map((r) => r.result.id)).toEqual(["gray"]);
    expect(summary.rejected[0]!.rejectReasons).toContain("monochrome_pixels");
    expect(summary.kept.map((k) => k.id)).toEqual(["color"]);
  });

  it("keeps images it cannot fetch (best-effort, never blocks)", async () => {
    const summary = await applyPixelQualityChecks([fakeResult("x")], {
      maxOcr: 0,
      fetcher: async () => null,
    });
    expect(summary.kept.length).toBe(1);
    expect(summary.unverified).toBe(1);
  });

  it("leaves results beyond maxImages unanalyzed but kept", async () => {
    const color = await colorfulGradient();
    const summary = await applyPixelQualityChecks(
      [fakeResult("a"), fakeResult("b"), fakeResult("c")],
      { maxImages: 1, maxOcr: 0, fetcher: async () => color },
    );
    expect(summary.analyzed).toBe(1);
    expect(summary.kept.length).toBe(3);
  });
});
