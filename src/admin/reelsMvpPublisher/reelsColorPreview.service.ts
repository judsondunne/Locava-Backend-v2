import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { getStagedDoc, pickEffectiveDraftAndMedia } from "./stagingRepo.js";
import type { Firestore } from "firebase-admin/firestore";
import { runFfprobeJson, pickPrimaryStreams, parseDurationSeconds } from "../../services/video/ffprobe.js";
import {
  buildMjpegPosterFilterChain,
  downloadVideoSourceToFile
} from "../../services/video/video-post-encoding.pipeline.js";
import { runFfmpeg } from "../../services/video/ffmpeg-runner.js";
import { readWasabiConfigFromEnv } from "../../services/storage/wasabi-config.js";
import { uploadFileToWasabiKey } from "../../services/video/wasabi-upload-file.js";
import {
  assertFfmpegSupportsZscaleTonemap,
  classifySourceColorFromStream,
  COLOR_PRESET_IDS,
  DEFAULT_REELS_COLOR_PRESET_ID,
  posterSeekSeconds,
  resolveColorPipeline
} from "../../media/colorPipeline/index.js";

const PREVIEW_PRESETS = ["phone-hlg-sdr-v1-mobius", "phone-hlg-sdr-v1-hable", "phone-hlg-sdr-v1-soft"] as const;

export type ReelsColorPreviewRow = {
  presetId: string;
  clipUrl: string;
  posterUrl: string;
  filterHashSample: string;
  sourceClass: string;
};

/**
 * Builds short preview clips + poster JPEGs for side-by-side preset comparison (Wasabi debug prefix).
 * Does not mutate staged docs or posts.
 */
export async function runReelsColorPreviewPackage(input: {
  db: Firestore;
  stageId: string;
  ffmpegBin?: string;
}): Promise<{
  runId: string;
  sourceUrl: string;
  sourceClass: string;
  rows: ReelsColorPreviewRow[];
  debugPrefix: string;
}> {
  const row = await getStagedDoc({ db: input.db, stageId: input.stageId });
  if (!row) throw new Error("staged_doc_not_found");
  const { media } = pickEffectiveDraftAndMedia(row.data);
  const sourceUrl = String(media.originalUrl ?? "").trim();
  if (!sourceUrl.startsWith("http")) throw new Error("media_originalUrl_required");

  const cfg = readWasabiConfigFromEnv();
  if (!cfg) throw new Error("wasabi_unavailable");

  const ffmpeg = input.ffmpegBin ?? "ffmpeg";
  const ffprobe = process.env.FFPROBE_BIN?.trim() || "ffprobe";
  const runId = randomUUID();
  const workDir = path.join(os.tmpdir(), `reels-color-preview-${input.stageId}-${runId}`);
  await fs.mkdir(workDir, { recursive: true });
  const localIn = path.join(workDir, "source_in.mp4");
  try {
    await downloadVideoSourceToFile(sourceUrl, localIn);
    const probe = await runFfprobeJson(localIn, ffprobe);
    const { video } = pickPrimaryStreams(probe.streams);
    if (!video) throw new Error("ffprobe_missing_video_stream");
    const w = Number(video.width ?? 0);
    const h = Number(video.height ?? 0);
    if (!(w > 0) || !(h > 0)) throw new Error("ffprobe_invalid_dimensions");
    const durationSec = parseDurationSeconds(probe.format, probe.streams);
    const classified = classifySourceColorFromStream(video, probe);
    const sourceClass = classified.sourceClass;
    const seekT = posterSeekSeconds(durationSec);
    if (sourceClass === "HDR_HLG_BT2020" || sourceClass === "HDR_PQ_BT2020") {
      await assertFfmpegSupportsZscaleTonemap(ffmpeg);
    }

    const rows: ReelsColorPreviewRow[] = [];
    const debugPrefix = `videos-lab-debug/reels-color-preview/${encodeURIComponent(input.stageId)}/${runId}`;

    for (const presetId of PREVIEW_PRESETS) {
      const effective = resolveColorPipeline({ presetId, sourceClass });
      const vf720 = effective.buildVideoFilter(w, h, 720, 720);
      const outClip = path.join(workDir, `preview_${presetId.replace(/[^a-z0-9_-]/gi, "_")}.mp4`);
      const outPoster = path.join(workDir, `poster_${presetId.replace(/[^a-z0-9_-]/gi, "_")}.jpg`);

      await runFfmpeg(
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          localIn,
          "-t",
          "3",
          "-map",
          `0:${video.index}`,
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "24",
          "-pix_fmt",
          "yuv420p",
          ...effective.ffmpegOutputColorArgs,
          "-movflags",
          "+faststart",
          "-vf",
          vf720,
          outClip
        ],
        ffmpeg
      );

      const vfPoster = buildMjpegPosterFilterChain(vf720);
      await runFfmpeg(
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          String(seekT),
          "-i",
          localIn,
          "-an",
          "-frames:v",
          "1",
          "-vf",
          vfPoster,
          "-c:v",
          "mjpeg",
          "-strict",
          "unofficial",
          "-q:v",
          "3",
          "-color_primaries",
          "bt709",
          "-color_trc",
          "bt709",
          "-colorspace",
          "bt709",
          outPoster
        ],
        ffmpeg
      );

      const safePreset = presetId.replace(/[^a-z0-9_-]/gi, "_");
      const upClip = await uploadFileToWasabiKey({
        cfg,
        localPath: outClip,
        key: `${debugPrefix}/${safePreset}/preview_720p_3s.mp4`,
        contentType: "video/mp4"
      });
      const upPoster = await uploadFileToWasabiKey({
        cfg,
        localPath: outPoster,
        key: `${debugPrefix}/${safePreset}/poster.jpg`,
        contentType: "image/jpeg"
      });

      rows.push({
        presetId,
        clipUrl: upClip.publicUrl,
        posterUrl: upPoster.publicUrl,
        filterHashSample: effective.sampleFilterGraphForHash.slice(0, 120),
        sourceClass
      });
    }

    const meta = {
      stageId: input.stageId,
      runId,
      sourceUrl,
      sourceClass,
      validPresets: [...COLOR_PRESET_IDS],
      defaultPreset: DEFAULT_REELS_COLOR_PRESET_ID,
      rows
    };
    const metaPath = path.join(workDir, "metadata.json");
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
    await uploadFileToWasabiKey({
      cfg,
      localPath: metaPath,
      key: `${debugPrefix}/metadata.json`,
      contentType: "application/json"
    }).catch(() => {});

    return { runId, sourceUrl, sourceClass, rows, debugPrefix };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
