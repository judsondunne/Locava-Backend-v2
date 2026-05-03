import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { runFfmpeg } from "./ffmpeg-runner.js";
import { parseDurationSeconds, pickPrimaryStreams, runFfprobeJson } from "./ffprobe.js";
import { moovHintFromMp4Prefix } from "./mp4-moov-hint.js";
import { uploadFileToWasabiKey } from "./wasabi-upload-file.js";
import type { WasabiRuntimeConfig } from "../storage/wasabi-config.js";
import { shouldGenerate1080Ladder } from "./video-source-policy.js";

export type VideoAssetJob = { id: string; original: string };

export type EncodedVideoAssetResult = {
  assetId: string;
  variants: Record<string, string>;
  variantMetadata: Record<string, unknown>;
  playbackLabGenerated: Record<string, string>;
  generationMetadata: Record<string, Record<string, unknown>>;
  diagnosticsJson: string;
  lastVerifyResults: Array<Record<string, unknown>>;
  sourceWidth: number;
  sourceHeight: number;
  durationSec: number;
};

function labKeyPrefix(postId: string, assetId: string): string {
  const safePost = postId.replace(/^\/+/, "");
  const safeAsset = assetId.replace(/^\/+/, "");
  return `videos-lab/${safePost}/${safeAsset}`;
}

function buildScaleFilter(width: number, height: number, targetHLandscape: number, targetWPortrait: number): string {
  const landscape = width >= height;
  if (landscape) return `scale=-2:${targetHLandscape}:flags=lanczos,format=yuv420p`;
  return `scale=${targetWPortrait}=-2:flags=lanczos,format=yuv420p`;
}

async function downloadToFile(url: string, dest: string): Promise<void> {
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
      "-map",
      `0:${input.videoAbsIndex}`,
      "-frames:v",
      "1",
      "-q:v",
      "3",
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
}): Promise<EncodedVideoAssetResult> {
  const ffmpeg = input.ffmpegBin ?? "ffmpeg";
  const ffprobe = process.env.FFPROBE_BIN?.trim() || "ffprobe";
  const timings: Record<string, number> = {};
  const t0 = Date.now();
  const originalUrl = input.asset.original.trim();
  const localIn = path.join(input.workDir, "source_in.mp4");
  await downloadToFile(originalUrl, localIn);
  timings.downloadMs = Date.now() - t0;

  const probe = await runFfprobeJson(localIn, ffprobe);
  const { video, audio } = pickPrimaryStreams(probe.streams);
  if (!video || typeof video.index !== "number") throw new Error("ffprobe_missing_video_stream");
  const w = Number(video.width ?? 0);
  const h = Number(video.height ?? 0);
  if (!(w > 0) || !(h > 0)) throw new Error("ffprobe_invalid_dimensions");
  const durationSec = parseDurationSeconds(probe.format, probe.streams);
  const audioIdx = audio && typeof audio.index === "number" ? audio.index : null;
  const enable1080 = shouldGenerate1080Ladder(w, h);

  const prefix = labKeyPrefix(input.postId, input.asset.id);
  const variants: Record<string, string> = {};
  const variantMetadata: Record<string, unknown> = {};
  const playbackLabGenerated: Record<string, string> = {};
  const generationMetadata: Record<string, Record<string, unknown>> = {};
  const lastVerifyResults: Array<Record<string, unknown>> = [];

  const vf360 = buildScaleFilter(w, h, 360, 360);
  const vf540 = buildScaleFilter(w, h, 540, 540);
  const vf720 = buildScaleFilter(w, h, 720, 720);
  const vf1080 = buildScaleFilter(w, h, 1080, 1080);

  const outPreview = path.join(input.workDir, "out_preview360_avc.mp4");
  const outMain720Avc = path.join(input.workDir, "out_main720_avc.mp4");
  const outStartup540 = path.join(input.workDir, "out_startup540_avc.mp4");
  const outStartup720 = path.join(input.workDir, "out_startup720_avc.mp4");
  const outStartup1080 = path.join(input.workDir, "out_startup1080_avc.mp4");
  const outUpgrade1080 = path.join(input.workDir, "out_upgrade1080_avc.mp4");
  const outMain720Hevc = path.join(input.workDir, "out_main720_hevc.mp4");
  const outPosterHigh = path.join(input.workDir, "out_poster_high.jpg");

  const encStart = Date.now();
  await encodeAvcFaststart({
    ffmpeg,
    inputPath: localIn,
    outputPath: outPreview,
    videoAbsIndex: video.index,
    audioAbsIndex: audioIdx,
    vf: vf360,
    crf: 24,
    preset: "veryfast"
  });
  await encodeAvcFaststart({
    ffmpeg,
    inputPath: localIn,
    outputPath: outMain720Avc,
    videoAbsIndex: video.index,
    audioAbsIndex: audioIdx,
    vf: vf720,
    crf: 20,
    preset: "medium"
  });
  await encodeAvcFaststart({
    ffmpeg,
    inputPath: localIn,
    outputPath: outStartup540,
    videoAbsIndex: video.index,
    audioAbsIndex: audioIdx,
    vf: vf540,
    crf: 26,
    preset: "veryfast"
  });
  await encodeAvcFaststart({
    ffmpeg,
    inputPath: localIn,
    outputPath: outStartup720,
    videoAbsIndex: video.index,
    audioAbsIndex: audioIdx,
    vf: vf720,
    crf: 24,
    preset: "veryfast"
  });

  if (enable1080) {
    await encodeAvcFaststart({
      ffmpeg,
      inputPath: localIn,
      outputPath: outStartup1080,
      videoAbsIndex: video.index,
      audioAbsIndex: audioIdx,
      vf: vf1080,
      crf: 24,
      preset: "veryfast"
    });
    await encodeAvcFaststart({
      ffmpeg,
      inputPath: localIn,
      outputPath: outUpgrade1080,
      videoAbsIndex: video.index,
      audioAbsIndex: audioIdx,
      vf: vf1080,
      crf: 18,
      preset: "medium"
    });
  }

  await encodePosterHighJpeg({
    ffmpeg,
    inputPath: localIn,
    outputPath: outPosterHigh,
    videoAbsIndex: video.index,
    vf: buildScaleFilter(w, h, 1080, 1080)
  });

  let hevcOk = false;
  const hevcWanted = input.enableMain720Hevc === true || process.env.VIDEO_MAIN720_HEVC_ENABLED === "1";
  if (hevcWanted) {
    hevcOk = await encodeHevcFaststart({
      ffmpeg,
      inputPath: localIn,
      outputPath: outMain720Hevc,
      videoAbsIndex: video.index,
      audioAbsIndex: audioIdx,
      vf: vf720,
      crf: 26
    });
  }
  timings.encodeMs = Date.now() - encStart;

  const uploadOne = async (local: string, keySuffix: string, contentType: string) => {
    const key = `${prefix}/${keySuffix}`;
    return uploadFileToWasabiKey({ cfg: input.cfg, localPath: local, key, contentType });
  };

  const upStart = Date.now();
  const upPreview = await uploadOne(outPreview, "preview360_avc.mp4", "video/mp4");
  const upMain720Avc = await uploadOne(outMain720Avc, "main720_avc.mp4", "video/mp4");
  const up540 = await uploadOne(outStartup540, "startup540_faststart_avc.mp4", "video/mp4");
  const up720 = await uploadOne(outStartup720, "startup720_faststart_avc.mp4", "video/mp4");
  let up1080s: { startup: typeof up720; upgrade: typeof up720 } | null = null;
  if (enable1080) {
    up1080s = {
      startup: await uploadOne(outStartup1080, "startup1080_faststart_avc.mp4", "video/mp4"),
      upgrade: await uploadOne(outUpgrade1080, "upgrade1080_faststart_avc.mp4", "video/mp4")
    };
  }
  const upPosterHigh = await uploadOne(outPosterHigh, "poster_high.jpg", "image/jpeg");
  let upHevc: { publicUrl: string; sizeBytes: number } | null = null;
  if (hevcOk) {
    upHevc = await uploadOne(outMain720Hevc, "main720_hevc.mp4", "video/mp4");
  }
  timings.uploadMs = Date.now() - upStart;

  const previewUrl = upPreview.publicUrl;
  const main720AvcUrl = upMain720Avc.publicUrl;
  const main720Url = upHevc?.publicUrl ?? main720AvcUrl;

  variants.preview360 = previewUrl;
  variants.preview360Avc = previewUrl;
  variants.main720Avc = main720AvcUrl;
  variants.main720 = main720Url;
  if (enable1080 && up1080s) {
    variants.main1080 = up1080s.upgrade.publicUrl;
    variants.main1080Avc = up1080s.upgrade.publicUrl;
  }

  const previewW = w >= h ? Math.round((360 * w) / h) : 360;
  const previewH = w >= h ? 360 : Math.round((360 * h) / w);
  variantMetadata.preview360 = {
    codec: "h264",
    width: previewW,
    height: previewH,
    sizeBytes: upPreview.sizeBytes,
    bitrateKbps: bitrateKbpsFromFile(upPreview.sizeBytes, durationSec)
  };
  variantMetadata.preview360Avc = variantMetadata.preview360;
  const m720W = w >= h ? Math.round((720 * w) / h) : 720;
  const m720H = w >= h ? 720 : Math.round((720 * h) / w);
  variantMetadata.main720Avc = {
    codec: "h264",
    width: m720W,
    height: m720H,
    sizeBytes: upMain720Avc.sizeBytes,
    bitrateKbps: bitrateKbpsFromFile(upMain720Avc.sizeBytes, durationSec)
  };
  variantMetadata.main720 =
    upHevc != null
      ? { codec: "hevc", width: m720W, height: m720H, sizeBytes: upHevc.sizeBytes, bitrateKbps: bitrateKbpsFromFile(upHevc.sizeBytes, durationSec) }
      : { codec: "h264", width: m720W, height: m720H, sizeBytes: upMain720Avc.sizeBytes, bitrateKbps: bitrateKbpsFromFile(upMain720Avc.sizeBytes, durationSec) };

  const lab = playbackLabGenerated;
  lab.startup540FaststartAvc = up540.publicUrl;
  lab.startup720FaststartAvc = up720.publicUrl;
  lab.startup540Faststart = up540.publicUrl;
  lab.startup720Faststart = up720.publicUrl;
  if (enable1080 && up1080s) {
    lab.startup1080FaststartAvc = up1080s.startup.publicUrl;
    lab.startup1080Faststart = up1080s.startup.publicUrl;
    lab.upgrade1080FaststartAvc = up1080s.upgrade.publicUrl;
    lab.upgrade1080Faststart = up1080s.upgrade.publicUrl;
  }
  lab.posterHigh = upPosterHigh.publicUrl;

  const metaBase = (label: string, codec: string): Record<string, unknown> => ({
    outputCodec: codec,
    generationType: "reencode_resize",
    label
  });
  generationMetadata.startup540FaststartAvc = metaBase("startup540FaststartAvc", "h264");
  generationMetadata.startup720FaststartAvc = metaBase("startup720FaststartAvc", "h264");
  if (enable1080 && up1080s) {
    generationMetadata.startup1080FaststartAvc = metaBase("startup1080FaststartAvc", "h264");
    generationMetadata.upgrade1080FaststartAvc = metaBase("upgrade1080FaststartAvc", "h264");
  }
  generationMetadata.posterHigh = { outputCodec: "jpeg", generationType: "frame_grab", label: "posterHigh" };

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

  await verifyLocalMoov("preview360Avc", outPreview, previewUrl);
  await verifyLocalMoov("main720Avc", outMain720Avc, main720AvcUrl);
  await verifyLocalMoov("startup540FaststartAvc", outStartup540, up540.publicUrl);
  await verifyLocalMoov("startup720FaststartAvc", outStartup720, up720.publicUrl);
  if (enable1080 && up1080s) {
    await verifyLocalMoov("startup1080FaststartAvc", outStartup1080, up1080s.startup.publicUrl);
    await verifyLocalMoov("upgrade1080FaststartAvc", outUpgrade1080, up1080s.upgrade.publicUrl);
  }
  if (upHevc) {
    await verifyLocalMoov("main720", outMain720Hevc, upHevc.publicUrl);
  }

  const diagnostics = {
    generationPolicyVersion: "backend_v2_video_pipeline_v1",
    timingsMs: timings,
    source: {
      width: w,
      height: h,
      durationSec,
      videoCodec: String(video.codec_name ?? ""),
      audioCodec: audio ? String(audio.codec_name ?? "") : null
    },
    outputs: {
      preview360Avc: previewUrl,
      main720Avc: main720AvcUrl,
      main720: main720Url,
      startup540FaststartAvc: up540.publicUrl,
      startup720FaststartAvc: up720.publicUrl,
      ...(enable1080 && up1080s
        ? {
            startup1080FaststartAvc: up1080s.startup.publicUrl,
            upgrade1080FaststartAvc: up1080s.upgrade.publicUrl
          }
        : {}),
      posterHigh: upPosterHigh.publicUrl
    }
  };

  return {
    assetId: input.asset.id,
    variants,
    variantMetadata,
    playbackLabGenerated: lab,
    generationMetadata,
    diagnosticsJson: JSON.stringify(diagnostics),
    lastVerifyResults,
    sourceWidth: w,
    sourceHeight: h,
    durationSec
  };
}
