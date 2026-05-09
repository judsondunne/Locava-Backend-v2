import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { runFfmpeg } from "./ffmpeg-runner.js";
import {
  detectHdrFromFfprobe,
  parseDurationSeconds,
  pickPrimaryStreams,
  runFfprobeJson,
  type HdrDetectionResult,
} from "./ffprobe.js";
import { moovHintFromMp4Prefix } from "./mp4-moov-hint.js";
import { uploadFileToWasabiKey } from "./wasabi-upload-file.js";
import type { WasabiRuntimeConfig } from "../storage/wasabi-config.js";
import { shouldGenerate1080Ladder } from "./video-source-policy.js";
import { normalizeVideoLabPostFolder } from "./normalizeVideoLabPostFolder.js";
import { buildHdrAwareEncodeFilter, hdrFilterMode } from "./hdr-poster-pipeline.js";

export type VideoAssetJob = { id: string; original: string };

/** Fine-grained encoder progress for debug UIs (download, each ffmpeg, Wasabi PUT). */
export type VideoEncoderProgress = { phase: string; detail?: string };

/** When set, only these outputs are encoded/uploaded (skips the rest of the ladder). Used by repair paths that already have most variants. */
export type VideoEncodeOnlySelection = Partial<{
  preview360Avc: boolean;
  main720Avc: boolean;
  startup540FaststartAvc: boolean;
  startup720FaststartAvc: boolean;
  startup1080FaststartAvc: boolean;
  upgrade1080FaststartAvc: boolean;
  posterHigh: boolean;
}>;

function isPartialEncodeMode(sel: VideoEncodeOnlySelection | undefined): boolean {
  return Boolean(sel && Object.keys(sel).length > 0);
}

function wantEncode(sel: VideoEncodeOnlySelection | undefined, key: keyof VideoEncodeOnlySelection): boolean {
  if (!isPartialEncodeMode(sel)) return true;
  return Boolean(sel![key]);
}

function encodeConcurrency(partial: boolean): number {
  const raw = process.env.VIDEO_ENCODE_MAX_PARALLEL?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.min(8, Math.floor(n));
  }
  return partial ? 3 : 1;
}

async function runEncodeJobsConcurrent(jobs: Array<() => Promise<void>>, concurrency: number): Promise<void> {
  if (jobs.length === 0) return;
  const workers = Math.max(1, Math.min(concurrency, jobs.length));
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= jobs.length) break;
      const job = jobs[i];
      if (job) await job();
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
}

export type EncodedVideoAssetResult = {
  assetId: string;
  /** `videos-lab/{normalizedPostFolder}/{assetId}` — verify lab MP4s with authenticated S3, not anonymous HTTP. */
  videosLabKeyPrefix: string;
  variants: Record<string, string>;
  variantMetadata: Record<string, unknown>;
  playbackLabGenerated: Record<string, string>;
  generationMetadata: Record<string, Record<string, unknown>>;
  diagnosticsJson: string;
  lastVerifyResults: Array<Record<string, unknown>>;
  sourceWidth: number;
  sourceHeight: number;
  durationSec: number;
  /** HDR / wide-gamut diagnostics for the source. Always populated; used by audit + ops tooling. */
  hdr: HdrDetectionResult;
  /** Filter mode actually applied to BOTH the encoded videos and the poster JPG. */
  filterMode: "sdr" | "wide_gamut" | "hdr_tonemap";
};

/** S3 key prefix for lab outputs: `videos-lab/{normalizedPostFolder}/{assetId}`. */
export function videosLabKeyPrefix(postIdOrKey: string, assetId: string): string {
  const folder = normalizeVideoLabPostFolder(postIdOrKey);
  const safeAsset = assetId.replace(/^\/+/, "");
  return `videos-lab/${folder}/${safeAsset}`;
}

/** Object key suffixes under `videosLabKeyPrefix` (must match uploadOne calls). Used by worker S3 verification. */
export const LAB_ARTIFACT_KEYS = {
  preview360Avc: "preview360_avc.mp4",
  main720Avc: "main720_avc.mp4",
  main720Hevc: "main720_hevc.mp4",
  startup540FaststartAvc: "startup540_faststart_avc.mp4",
  startup720FaststartAvc: "startup720_faststart_avc.mp4",
  startup1080FaststartAvc: "startup1080_faststart_avc.mp4",
  upgrade1080FaststartAvc: "upgrade1080_faststart_avc.mp4",
  posterHigh: "poster_high.jpg"
} as const;

/**
 * Pure string builder; verified by unit test (ffmpeg is picky about `w:h` syntax).
 * @deprecated Use `buildHdrAwareEncodeFilter(hdr, ...)` so HDR sources are normalized to SDR BT.709.
 *   Kept for non-HDR callers/tests that pass plain SDR sources.
 */
export function buildPlaybackLabScaleFilter(
  width: number,
  height: number,
  targetHLandscape: number,
  targetWPortrait: number
): string {
  const landscape = width >= height;
  if (landscape) return `scale=-2:${targetHLandscape}:flags=lanczos,format=yuv420p`;
  // ffmpeg scale takes w:h — must be a single colon before -2, not `360=-2` (that breaks parsing).
  return `scale=${targetWPortrait}:-2:flags=lanczos,format=yuv420p`;
}

/** Download remote source MP4 (or other container) to a local path for ffprobe/encode. */
export async function downloadVideoSourceToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download_failed:${res.status}`);
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  await pipeline(body, createWriteStream(dest));
}

async function encodeAvcFaststart(input: {
  ffmpeg: string;
  inputPath: string;
  outputPath: string;
  videoAbsIndex: number;
  audioAbsIndex: number | null;
  vf: string;
  crf: number;
  preset: string;
}): Promise<void> {
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input.inputPath,
    "-map",
    `0:${input.videoAbsIndex}`,
    ...(input.audioAbsIndex != null ? ["-map", `0:${input.audioAbsIndex}`] : ["-an"]),
    "-c:v",
    "libx264",
    "-preset",
    input.preset,
    "-threads",
    "0",
    "-crf",
    String(input.crf),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    ...(input.audioAbsIndex != null ? ["-c:a", "aac", "-b:a", "128k"] : []),
    "-vf",
    input.vf,
    input.outputPath
  ];
  await runFfmpeg(args, input.ffmpeg);
}

async function encodeHevcFaststart(input: {
  ffmpeg: string;
  inputPath: string;
  outputPath: string;
  videoAbsIndex: number;
  audioAbsIndex: number | null;
  vf: string;
  crf: number;
}): Promise<boolean> {
  try {
    await runFfmpeg(
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input.inputPath,
        "-map",
        `0:${input.videoAbsIndex}`,
        ...(input.audioAbsIndex != null ? ["-map", `0:${input.audioAbsIndex}`] : ["-an"]),
        "-c:v",
        "libx265",
        "-preset",
        "fast",
        "-threads",
        "0",
        "-crf",
        String(input.crf),
        "-tag:v",
        "hvc1",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        ...(input.audioAbsIndex != null ? ["-c:a", "aac", "-b:a", "128k"] : []),
        "-vf",
        input.vf,
        input.outputPath
      ],
      input.ffmpeg,
    );
    return true;
  } catch {
    return false;
  }
}

async function encodePosterHighJpeg(input: {
  ffmpeg: string;
  inputPath: string;
  outputPath: string;
  videoAbsIndex: number;
  vf: string;
  /**
   * When true, the `-i` input is a normalized SDR BT.709 mp4 (the startup720 output) — no stream
   * mapping is needed and the filter chain is just the SDR scale.
   *   This is the safer code path for HDR sources because the poster is extracted from the SAME
   *   pixels the user will see during playback, instead of a second-pass tonemap of the raw HDR.
   */
  fromNormalizedSdrInput?: boolean;
}): Promise<void> {
  await runFfmpeg(
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "0",
      "-i",
      input.inputPath,
      ...(input.fromNormalizedSdrInput ? [] : ["-map", `0:${input.videoAbsIndex}`]),
      "-frames:v",
      "1",
      "-q:v",
      "3",
      // Tag the JPEG as Rec.709-compatible (sRGB-like) so iOS/Android image viewers don't reinterpret it.
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-colorspace",
      "bt709",
      "-color_range",
      "tv",
      "-vf",
      input.vf,
      input.outputPath
    ],
    input.ffmpeg,
  );
}

function bitrateKbpsFromFile(sizeBytes: number, durationSec: number): number {
  if (!(durationSec > 0.05) || !(sizeBytes > 0)) return 0;
  return Math.round((sizeBytes * 8) / durationSec / 1000);
}

export async function encodeAndUploadVideoAsset(input: {
  cfg: WasabiRuntimeConfig;
  postId: string;
  asset: VideoAssetJob;
  workDir: string;
  ffmpegBin?: string;
  enableMain720Hevc?: boolean;
  encodeOnly?: VideoEncodeOnlySelection;
  /** When set, skips HTTP download and uses this file as `source_in` (same as default layout under `workDir`). */
  preDownloadedSourcePath?: string;
  onProgress?: (evt: VideoEncoderProgress) => void;
}): Promise<EncodedVideoAssetResult> {
  const ffmpeg = input.ffmpegBin ?? "ffmpeg";
  const ffprobe = process.env.FFPROBE_BIN?.trim() || "ffprobe";
  const timings: Record<string, number> = {};
  const tPipeline = Date.now();
  const emit = (phase: string, detail?: string) => {
    input.onProgress?.({ phase, detail });
  };
  const postFolder = normalizeVideoLabPostFolder(input.postId);
  emit("encoder_pipeline_open", `post=${postFolder} asset=${input.asset.id}`);
  const t0 = Date.now();
  const originalUrl = input.asset.original.trim();
  const localIn = path.join(input.workDir, "source_in.mp4");
  const srcHint = originalUrl.length > 140 ? `${originalUrl.slice(0, 140)}…` : originalUrl;
  emit("encoder_download_start", srcHint);
  const pre = input.preDownloadedSourcePath?.trim();
  if (pre) {
    const absPre = path.resolve(pre);
    const absIn = path.resolve(localIn);
    if (absPre !== absIn) {
      await fs.copyFile(absPre, absIn);
    }
  } else {
    await downloadVideoSourceToFile(originalUrl, localIn);
  }
  const stIn = await fs.stat(localIn);
  timings.downloadMs = Date.now() - t0;
  emit(
    "encoder_download_done",
    `${timings.downloadMs}ms bytes=${stIn.size} (~${(stIn.size / (1024 * 1024)).toFixed(2)} MiB)`
  );

  emit("encoder_ffprobe_start", path.basename(localIn));
  const probe = await runFfprobeJson(localIn, ffprobe);
  const { video, audio } = pickPrimaryStreams(probe.streams);
  if (!video || typeof video.index !== "number") throw new Error("ffprobe_missing_video_stream");
  const w = Number(video.width ?? 0);
  const h = Number(video.height ?? 0);
  if (!(w > 0) || !(h > 0)) throw new Error("ffprobe_invalid_dimensions");
  const durationSec = parseDurationSeconds(probe.format, probe.streams);
  const audioIdx = audio && typeof audio.index === "number" ? audio.index : null;
  /**
   * HDR / wide-gamut detection is applied uniformly to ALL outputs (preview360, main720, startup540,
   * startup720, startup1080, upgrade1080, posterHigh). This guarantees the poster image and the
   * playable startup video share the SAME tone-mapped SDR BT.709 pixels — the iPhone HDR poster
   * mismatch fix.
   */
  const hdr = detectHdrFromFfprobe(probe, video);
  const filterMode = hdrFilterMode(hdr);
  emit(
    "encoder_ffprobe_done",
    `${w}x${h} dur=${durationSec.toFixed(2)}s vcodec=${String(video.codec_name ?? "?")} hdr=${hdr.kind}/${filterMode}`
  );
  const enable1080 = shouldGenerate1080Ladder(w, h);
  const encodeOnly = input.encodeOnly;
  if (isPartialEncodeMode(encodeOnly) && !Object.values(encodeOnly!).some(Boolean)) {
    throw new Error("encode_only_empty");
  }

  const partial = isPartialEncodeMode(encodeOnly);
  const main720Preset = partial ? "veryfast" : "medium";
  const upgrade1080Preset = partial ? "veryfast" : "medium";

  const prefix = videosLabKeyPrefix(input.postId, input.asset.id);
  const variants: Record<string, string> = {};
  const variantMetadata: Record<string, unknown> = {};
  const playbackLabGenerated: Record<string, string> = {};
  const generationMetadata: Record<string, Record<string, unknown>> = {};
  const lastVerifyResults: Array<Record<string, unknown>> = [];

  const vf360 = buildHdrAwareEncodeFilter(hdr, w, h, 360, 360);
  const vf540 = buildHdrAwareEncodeFilter(hdr, w, h, 540, 540);
  const vf720 = buildHdrAwareEncodeFilter(hdr, w, h, 720, 720);
  const vf1080 = buildHdrAwareEncodeFilter(hdr, w, h, 1080, 1080);

  const outPreview = path.join(input.workDir, "out_preview360_avc.mp4");
  const outMain720Avc = path.join(input.workDir, "out_main720_avc.mp4");
  const outStartup540 = path.join(input.workDir, "out_startup540_avc.mp4");
  const outStartup720 = path.join(input.workDir, "out_startup720_avc.mp4");
  const outStartup1080 = path.join(input.workDir, "out_startup1080_avc.mp4");
  const outUpgrade1080 = path.join(input.workDir, "out_upgrade1080_avc.mp4");
  const outMain720Hevc = path.join(input.workDir, "out_main720_hevc.mp4");
  const outPosterHigh = path.join(input.workDir, "out_poster_high.jpg");

  const encStart = Date.now();
  const encodeJobs: Array<() => Promise<void>> = [];
  const pushEnc = (label: string, run: () => Promise<void>) => {
    encodeJobs.push(async () => {
      emit("encoder_ffmpeg_start", label);
      const t = Date.now();
      try {
        await run();
        emit("encoder_ffmpeg_done", `${label} ${Date.now() - t}ms`);
      } catch (err) {
        emit("encoder_ffmpeg_error", `${label} ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    });
  };

  if (wantEncode(encodeOnly, "preview360Avc")) {
    pushEnc("preview360Avc_crf24_veryfast", () =>
      encodeAvcFaststart({
        ffmpeg,
        inputPath: localIn,
        outputPath: outPreview,
        videoAbsIndex: video.index,
        audioAbsIndex: audioIdx,
        vf: vf360,
        crf: 24,
        preset: "veryfast"
      })
    );
  }
  if (wantEncode(encodeOnly, "main720Avc")) {
    pushEnc(`main720Avc_crf20_${main720Preset}`, () =>
      encodeAvcFaststart({
        ffmpeg,
        inputPath: localIn,
        outputPath: outMain720Avc,
        videoAbsIndex: video.index,
        audioAbsIndex: audioIdx,
        vf: vf720,
        crf: 20,
        preset: main720Preset
      })
    );
  }
  if (wantEncode(encodeOnly, "startup540FaststartAvc")) {
    pushEnc("startup540FaststartAvc_crf26_veryfast", () =>
      encodeAvcFaststart({
        ffmpeg,
        inputPath: localIn,
        outputPath: outStartup540,
        videoAbsIndex: video.index,
        audioAbsIndex: audioIdx,
        vf: vf540,
        crf: 26,
        preset: "veryfast"
      })
    );
  }
  if (wantEncode(encodeOnly, "startup720FaststartAvc")) {
    pushEnc("startup720FaststartAvc_crf24_veryfast", () =>
      encodeAvcFaststart({
        ffmpeg,
        inputPath: localIn,
        outputPath: outStartup720,
        videoAbsIndex: video.index,
        audioAbsIndex: audioIdx,
        vf: vf720,
        crf: 24,
        preset: "veryfast"
      })
    );
  }
  if (enable1080 && wantEncode(encodeOnly, "startup1080FaststartAvc")) {
    pushEnc("startup1080FaststartAvc_crf24_veryfast", () =>
      encodeAvcFaststart({
        ffmpeg,
        inputPath: localIn,
        outputPath: outStartup1080,
        videoAbsIndex: video.index,
        audioAbsIndex: audioIdx,
        vf: vf1080,
        crf: 24,
        preset: "veryfast"
      })
    );
  }
  if (enable1080 && wantEncode(encodeOnly, "upgrade1080FaststartAvc")) {
    pushEnc(`upgrade1080FaststartAvc_crf18_${upgrade1080Preset}`, () =>
      encodeAvcFaststart({
        ffmpeg,
        inputPath: localIn,
        outputPath: outUpgrade1080,
        videoAbsIndex: video.index,
        audioAbsIndex: audioIdx,
        vf: vf1080,
        crf: 18,
        preset: upgrade1080Preset
      })
    );
  }
  /**
   * Poster generation strategy:
   *   - SDR sources (the common case) keep the original behavior: extract the first frame from the
   *     raw input using the same scale filter as the videos. Byte-identical to the previous
   *     non-HDR path.
   *   - HDR sources (Dolby Vision / HDR10 / HLG) and wide-gamut SDR sources (P3 / Rec.2020) extract
   *     the poster from the *normalized* startup720 SDR mp4 once it is finished encoding. This
   *     guarantees the poster JPG and the playable startup video share identical pixels, fixing
   *     the iPhone "dull poster vs bright video" mismatch.
   *   - When the HDR pipeline is in use but startup720 was NOT requested in this run, we fall back
   *     to extracting from the raw input but still apply the HDR-aware filter chain.
   */
  let posterFromNormalizedSdr = false;
  let posterSourceFile = localIn;
  let posterVf = buildHdrAwareEncodeFilter(hdr, w, h, 1080, 1080);
  if (wantEncode(encodeOnly, "posterHigh")) {
    if (filterMode !== "sdr" && wantEncode(encodeOnly, "startup720FaststartAvc")) {
      // Defer the poster encode until after startup720 has finished — push as a separate job below.
      posterFromNormalizedSdr = true;
      posterSourceFile = outStartup720;
      posterVf = buildPlaybackLabScaleFilter(w, h, 1080, 1080);
    }
    if (!posterFromNormalizedSdr) {
      pushEnc("posterHigh_jpeg", () =>
        encodePosterHighJpeg({
          ffmpeg,
          inputPath: posterSourceFile,
          outputPath: outPosterHigh,
          videoAbsIndex: video.index,
          vf: posterVf,
        })
      );
    }
  }

  emit(
    "encoder_ffprobe_summary",
    `${w}x${h} dur=${durationSec.toFixed(2)}s audio=${audioIdx != null} 1080ladder=${enable1080} jobs=${encodeJobs.length} parallel=${encodeConcurrency(partial)} hdr=${hdr.kind} filterMode=${filterMode}`
  );
  emit("encoder_transcode_batch_start", String(encodeJobs.length));
  await runEncodeJobsConcurrent(encodeJobs, encodeConcurrency(partial));
  emit("encoder_transcode_batch_done", `wallMs=${Date.now() - encStart}`);

  /**
   * Deferred poster encode for HDR/wide-gamut sources: extract from the already-normalized
   * startup720 mp4 so the poster shares identical SDR BT.709 pixels with the playable video.
   */
  if (posterFromNormalizedSdr) {
    emit("encoder_ffmpeg_start", "posterHigh_jpeg_from_normalized_sdr");
    const t = Date.now();
    try {
      await encodePosterHighJpeg({
        ffmpeg,
        inputPath: posterSourceFile,
        outputPath: outPosterHigh,
        videoAbsIndex: 0,
        vf: posterVf,
        fromNormalizedSdrInput: true,
      });
      emit("encoder_ffmpeg_done", `posterHigh_from_normalized_sdr ${Date.now() - t}ms`);
    } catch (err) {
      // Best-effort: fall back to raw input with HDR-aware filter chain so we still produce a poster.
      emit(
        "encoder_ffmpeg_error",
        `posterHigh_from_normalized_sdr ${err instanceof Error ? err.message : String(err)} — falling back to raw input`,
      );
      await encodePosterHighJpeg({
        ffmpeg,
        inputPath: localIn,
        outputPath: outPosterHigh,
        videoAbsIndex: video.index,
        vf: buildHdrAwareEncodeFilter(hdr, w, h, 1080, 1080),
      });
      emit("encoder_ffmpeg_done", `posterHigh_fallback_raw ${Date.now() - t}ms`);
    }
  }

  let hevcOk = false;
  const hevcWanted =
    !partial && (input.enableMain720Hevc === true || process.env.VIDEO_MAIN720_HEVC_ENABLED === "1");
  if (hevcWanted) {
    emit("encoder_ffmpeg_start", "main720Hevc_crf26_fast");
    const tHevc = Date.now();
    hevcOk = await encodeHevcFaststart({
      ffmpeg,
      inputPath: localIn,
      outputPath: outMain720Hevc,
      videoAbsIndex: video.index,
      audioAbsIndex: audioIdx,
      vf: vf720,
      crf: 26
    });
    emit("encoder_ffmpeg_done", `main720Hevc ok=${hevcOk} ${Date.now() - tHevc}ms`);
  }
  timings.encodeMs = Date.now() - encStart;
  emit("encoder_transcode_all_done", `encodePhaseMs=${timings.encodeMs}`);

  const uploadOne = async (local: string, keySuffix: string, contentType: string) => {
    const key = `${prefix}/${keySuffix}`;
    return uploadFileToWasabiKey({ cfg: input.cfg, localPath: local, key, contentType });
  };

  type Up = Awaited<ReturnType<typeof uploadOne>>;
  const trackedUpload = async (label: string, work: Promise<Up | null>): Promise<Up | null> => {
    emit("encoder_upload_start", label);
    const t = Date.now();
    const r = await work;
    if (r) {
      emit(
        "encoder_upload_done",
        `${label} ${Date.now() - t}ms ${Math.round(r.sizeBytes / 1024)}KiB`
      );
    } else {
      emit("encoder_upload_skip", label);
    }
    return r;
  };
  const upStart = Date.now();
  emit("encoder_upload_batch_start", "wasabi_parallel_puts");
  const [
    upPreview,
    upMain720Avc,
    up540,
    up720,
    up1080Startup,
    up1080Upgrade,
    upPosterHigh,
    upHevc
  ] = await Promise.all([
    trackedUpload(
      "preview360_avc.mp4",
      wantEncode(encodeOnly, "preview360Avc")
        ? uploadOne(outPreview, "preview360_avc.mp4", "video/mp4")
        : Promise.resolve(null as Up | null)
    ),
    trackedUpload(
      "main720_avc.mp4",
      wantEncode(encodeOnly, "main720Avc")
        ? uploadOne(outMain720Avc, "main720_avc.mp4", "video/mp4")
        : Promise.resolve(null as Up | null)
    ),
    trackedUpload(
      "startup540_faststart_avc.mp4",
      wantEncode(encodeOnly, "startup540FaststartAvc")
        ? uploadOne(outStartup540, "startup540_faststart_avc.mp4", "video/mp4")
        : Promise.resolve(null as Up | null)
    ),
    trackedUpload(
      "startup720_faststart_avc.mp4",
      wantEncode(encodeOnly, "startup720FaststartAvc")
        ? uploadOne(outStartup720, "startup720_faststart_avc.mp4", "video/mp4")
        : Promise.resolve(null as Up | null)
    ),
    trackedUpload(
      "startup1080_faststart_avc.mp4",
      enable1080 && wantEncode(encodeOnly, "startup1080FaststartAvc")
        ? uploadOne(outStartup1080, "startup1080_faststart_avc.mp4", "video/mp4")
        : Promise.resolve(null as Up | null)
    ),
    trackedUpload(
      "upgrade1080_faststart_avc.mp4",
      enable1080 && wantEncode(encodeOnly, "upgrade1080FaststartAvc")
        ? uploadOne(outUpgrade1080, "upgrade1080_faststart_avc.mp4", "video/mp4")
        : Promise.resolve(null as Up | null)
    ),
    trackedUpload(
      "poster_high.jpg",
      wantEncode(encodeOnly, "posterHigh")
        ? uploadOne(outPosterHigh, "poster_high.jpg", "image/jpeg")
        : Promise.resolve(null as Up | null)
    ),
    trackedUpload(
      "main720_hevc.mp4",
      hevcOk ? uploadOne(outMain720Hevc, "main720_hevc.mp4", "video/mp4") : Promise.resolve(null as Up | null)
    )
  ]);
  const up1080s =
    up1080Startup || up1080Upgrade ? { startup: up1080Startup, upgrade: up1080Upgrade } : null;
  timings.uploadMs = Date.now() - upStart;
  emit("encoder_upload_batch_done", `${timings.uploadMs}ms`);

  const previewUrl = upPreview?.publicUrl ?? "";
  const main720AvcUrl = upMain720Avc?.publicUrl ?? "";
  const main720Url = upHevc?.publicUrl ?? main720AvcUrl;

  if (upPreview) {
    variants.preview360 = previewUrl;
    variants.preview360Avc = previewUrl;
  }
  if (upMain720Avc) {
    variants.main720Avc = main720AvcUrl;
  }
  if (upHevc || upMain720Avc) {
    variants.main720 = main720Url;
  }
  if (enable1080 && up1080s?.upgrade?.publicUrl) {
    variants.main1080 = up1080s.upgrade.publicUrl;
    variants.main1080Avc = up1080s.upgrade.publicUrl;
  }

  const previewW = w >= h ? Math.round((360 * w) / h) : 360;
  const previewH = w >= h ? 360 : Math.round((360 * h) / w);
  if (upPreview) {
    variantMetadata.preview360 = {
      codec: "h264",
      width: previewW,
      height: previewH,
      sizeBytes: upPreview.sizeBytes,
      bitrateKbps: bitrateKbpsFromFile(upPreview.sizeBytes, durationSec)
    };
    variantMetadata.preview360Avc = variantMetadata.preview360;
  }
  const m720W = w >= h ? Math.round((720 * w) / h) : 720;
  const m720H = w >= h ? 720 : Math.round((720 * h) / w);
  if (upMain720Avc) {
    variantMetadata.main720Avc = {
      codec: "h264",
      width: m720W,
      height: m720H,
      sizeBytes: upMain720Avc.sizeBytes,
      bitrateKbps: bitrateKbpsFromFile(upMain720Avc.sizeBytes, durationSec)
    };
  }
  if (upHevc != null || upMain720Avc != null) {
    variantMetadata.main720 =
      upHevc != null
        ? {
            codec: "hevc",
            width: m720W,
            height: m720H,
            sizeBytes: upHevc.sizeBytes,
            bitrateKbps: bitrateKbpsFromFile(upHevc.sizeBytes, durationSec)
          }
        : {
            codec: "h264",
            width: m720W,
            height: m720H,
            sizeBytes: upMain720Avc!.sizeBytes,
            bitrateKbps: bitrateKbpsFromFile(upMain720Avc!.sizeBytes, durationSec)
          };
  }

  const lab = playbackLabGenerated;
  if (up540) {
    lab.startup540FaststartAvc = up540.publicUrl;
    lab.startup540Faststart = up540.publicUrl;
  }
  if (up720) {
    lab.startup720FaststartAvc = up720.publicUrl;
    lab.startup720Faststart = up720.publicUrl;
  }
  if (up1080s?.startup) {
    lab.startup1080FaststartAvc = up1080s.startup.publicUrl;
    lab.startup1080Faststart = up1080s.startup.publicUrl;
  }
  if (up1080s?.upgrade) {
    lab.upgrade1080FaststartAvc = up1080s.upgrade.publicUrl;
    lab.upgrade1080Faststart = up1080s.upgrade.publicUrl;
  }
  if (upPosterHigh) {
    lab.posterHigh = upPosterHigh.publicUrl;
  }

  const metaBase = (label: string, codec: string): Record<string, unknown> => ({
    outputCodec: codec,
    generationType: "reencode_resize",
    label
  });
  if (up540) generationMetadata.startup540FaststartAvc = metaBase("startup540FaststartAvc", "h264");
  if (up720) generationMetadata.startup720FaststartAvc = metaBase("startup720FaststartAvc", "h264");
  if (up1080s?.startup) generationMetadata.startup1080FaststartAvc = metaBase("startup1080FaststartAvc", "h264");
  if (up1080s?.upgrade) generationMetadata.upgrade1080FaststartAvc = metaBase("upgrade1080FaststartAvc", "h264");
  if (upPosterHigh) {
    generationMetadata.posterHigh = { outputCodec: "jpeg", generationType: "frame_grab", label: "posterHigh" };
  }

  const verifyLocalMoov = async (label: string, file: string, publicUrl: string) => {
    const buf = await fs.readFile(file);
    const hint = moovHintFromMp4Prefix(buf);
    lastVerifyResults.push({
      label,
      url: publicUrl,
      moovHint: hint,
      ok: hint === "moov_before_mdat_in_prefix"
    });
    if (hint !== "moov_before_mdat_in_prefix") throw new Error(`local_moov_verify_failed:${label}`);
  };

  const verifyTasks: Array<Promise<void>> = [];
  if (upPreview) verifyTasks.push(verifyLocalMoov("preview360Avc", outPreview, previewUrl));
  if (upMain720Avc) verifyTasks.push(verifyLocalMoov("main720Avc", outMain720Avc, main720AvcUrl));
  if (up540) verifyTasks.push(verifyLocalMoov("startup540FaststartAvc", outStartup540, up540.publicUrl));
  if (up720) verifyTasks.push(verifyLocalMoov("startup720FaststartAvc", outStartup720, up720.publicUrl));
  if (up1080s?.startup) {
    verifyTasks.push(verifyLocalMoov("startup1080FaststartAvc", outStartup1080, up1080s.startup.publicUrl));
  }
  if (up1080s?.upgrade) {
    verifyTasks.push(verifyLocalMoov("upgrade1080FaststartAvc", outUpgrade1080, up1080s.upgrade.publicUrl));
  }
  if (upHevc) {
    verifyTasks.push(verifyLocalMoov("main720", outMain720Hevc, upHevc.publicUrl));
  }
  emit("encoder_moov_verify_start", `files=${verifyTasks.length}`);
  const tMoov = Date.now();
  await Promise.all(verifyTasks);
  emit("encoder_moov_verify_done", `${Date.now() - tMoov}ms`);

  emit("encoder_pipeline_complete", `totalMs=${Date.now() - tPipeline}`);

  const diagnostics = {
    generationPolicyVersion: "backend_v2_video_pipeline_v1",
    timingsMs: timings,
    encodeMode: partial ? "partial_selection" : "full_ladder",
    source: {
      width: w,
      height: h,
      durationSec,
      videoCodec: String(video.codec_name ?? ""),
      audioCodec: audio ? String(audio.codec_name ?? "") : null,
      colorSpace: hdr.colorSpace,
      colorTransfer: hdr.colorTransfer,
      colorPrimaries: hdr.colorPrimaries,
      pixFmt: hdr.pixFmt,
      hdrKind: hdr.kind,
      hdrIsHdr: hdr.isHdr,
      hdrIsWideGamutOrHdr: hdr.isWideGamutOrHdr,
      dolbyVisionSideData: hdr.dolbyVisionSideData,
      hdrDetectionReason: hdr.reason,
    },
    output: {
      filterMode,
      toneMappingApplied: filterMode === "hdr_tonemap",
      colorNormalizationApplied: filterMode !== "sdr",
      colorPrimaries: "bt709",
      colorTransfer: "bt709",
      colorSpace: "bt709",
      colorRange: "tv",
      videoCodec: "h264",
    },
    poster: {
      generatedFromNormalizedSdrInput: posterFromNormalizedSdr,
      generationMode: filterMode === "sdr" ? "raw_sdr" : posterFromNormalizedSdr ? "normalized_startup720" : "raw_with_hdr_filter",
    },
    outputs: {
      ...(previewUrl ? { preview360Avc: previewUrl } : {}),
      ...(main720AvcUrl ? { main720Avc: main720AvcUrl } : {}),
      ...(main720Url ? { main720: main720Url } : {}),
      ...(up540 ? { startup540FaststartAvc: up540.publicUrl } : {}),
      ...(up720 ? { startup720FaststartAvc: up720.publicUrl } : {}),
      ...(up1080s?.startup ? { startup1080FaststartAvc: up1080s.startup.publicUrl } : {}),
      ...(up1080s?.upgrade ? { upgrade1080FaststartAvc: up1080s.upgrade.publicUrl } : {}),
      ...(upPosterHigh ? { posterHigh: upPosterHigh.publicUrl } : {})
    }
  };

  return {
    assetId: input.asset.id,
    videosLabKeyPrefix: prefix,
    variants,
    variantMetadata,
    playbackLabGenerated: lab,
    generationMetadata,
    diagnosticsJson: JSON.stringify(diagnostics),
    lastVerifyResults,
    sourceWidth: w,
    sourceHeight: h,
    durationSec,
    hdr,
    filterMode,
  };
}
