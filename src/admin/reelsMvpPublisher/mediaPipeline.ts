import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  generateMissingFastStartVariantsForPost,
  mergePlaybackLabResultsIntoRawPost,
  type VerifyOutput
} from "../../lib/posts/master-post-v2/videoFastStartRepair.js";
import { DEFAULT_REELS_COLOR_PRESET_ID } from "../../media/colorPipeline/index.js";
import { normalizeVideoLabPostFolder } from "../../services/video/normalizeVideoLabPostFolder.js";
import {
  encodeAndUploadVideoAsset,
  videosLabKeyPrefix,
  type VideoEncodeOnlySelection
} from "../../services/video/video-post-encoding.pipeline.js";
import { runFfprobeJson, pickPrimaryStreams } from "../../services/video/ffprobe.js";
import { shouldGenerate1080Ladder } from "../../services/video/video-source-policy.js";
import { readWasabiConfigFromEnv } from "../../services/storage/wasabi-config.js";
import { verifyRemoteImage, verifyRemoteMp4Faststart } from "../../services/video/remote-url-verify.js";

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

async function verifyGeneratedVideoUrl(input: {
  label: string;
  url: string;
  originalUrl: string | null;
}): Promise<VerifyOutput> {
  const isPoster = input.label === "posterHigh" || input.label === "poster";
  if (isPoster) {
    const img = await verifyRemoteImage(input.url);
    return {
      label: input.label,
      url: input.url,
      ok: img.ok,
      moovHint: img.ok ? img.moovHint : undefined,
      probe: img.ok
        ? {
            head: { ok: true, status: 200, contentType: img.contentType, acceptRanges: "" },
            moovHint: img.moovHint
          }
        : undefined
    };
  }
  const headRes = await fetch(input.url, { method: "HEAD" }).catch(() => null);
  const contentType = (String(headRes?.headers.get("content-type") ?? "")
    .split(";")
    .at(0) ?? "")
    .trim()
    .toLowerCase();
  const acceptRanges = String(headRes?.headers.get("accept-ranges") ?? "").trim().toLowerCase();
  const verify = await verifyRemoteMp4Faststart(input.url, input.originalUrl ?? "", { requireMoovBeforeMdat: true });
  return {
    label: input.label,
    url: input.url,
    ok: verify.ok,
    moovHint: verify.ok ? verify.moovHint : undefined,
    probe: {
      head: {
        ok: Boolean(headRes?.ok),
        status: headRes?.status ?? 0,
        contentType,
        acceptRanges
      },
      moovHint: verify.ok ? verify.moovHint : undefined
    }
  };
}

async function generateMissingForAsset(input: {
  postId: string;
  asset: Record<string, unknown>;
  colorPipelinePresetId?: string;
  needs: {
    posterHigh: boolean;
    preview360Avc: boolean;
    main720Avc: boolean;
    startup540FaststartAvc: boolean;
    startup720FaststartAvc: boolean;
    startup1080FaststartAvc: boolean;
    upgrade1080FaststartAvc: boolean;
  };
  onEncoderProgress?: (evt: { phase: string; detail?: string }) => void;
}) {
  const cfg = readWasabiConfigFromEnv();
  if (!cfg) throw new Error("wasabi_unavailable");
  const assetId = firstNonEmptyString(input.asset.id) ?? `video_${Date.now()}`;
  const video = input.asset.video && typeof input.asset.video === "object" ? (input.asset.video as Record<string, unknown>) : null;
  const playback = video?.playback && typeof video.playback === "object" ? (video.playback as Record<string, unknown>) : null;
  const original = firstNonEmptyString(
    input.asset.original,
    input.asset.url,
    video?.originalUrl,
    playback?.defaultUrl,
    playback?.primaryUrl
  );
  if (!original) throw new Error("source_missing");
  const workDir = path.join(os.tmpdir(), `reels-mvp-publisher-${input.postId}-${assetId}-${randomUUID()}`);
  await fs.mkdir(workDir, { recursive: true });
  try {
    const ffprobeBin = process.env.FFPROBE_BIN?.trim() || "ffprobe";
    let probedW = 0;
    let probedH = 0;
    try {
      const probeJson = await runFfprobeJson(original, ffprobeBin);
      const { video: vStream } = pickPrimaryStreams(probeJson.streams);
      probedW = Number(vStream?.width ?? 0);
      probedH = Number(vStream?.height ?? 0);
      input.onEncoderProgress?.({
        phase: "encoder_preflight_probe",
        detail: `${probedW}x${probedH}`
      });
    } catch {
      // Encoder download+ffprobe will still validate the source.
    }

    const topVariants =
      input.asset.variants && typeof input.asset.variants === "object"
        ? (input.asset.variants as Record<string, unknown>)
        : {};
    const videoVariants =
      video?.variants && typeof video.variants === "object" ? (video.variants as Record<string, unknown>) : {};
    const variants = { ...videoVariants, ...topVariants };
    const playbackLab =
      input.asset.playbackLab && typeof input.asset.playbackLab === "object"
        ? (input.asset.playbackLab as Record<string, unknown>)
        : null;
    const generatedHints =
      playbackLab?.generated && typeof playbackLab.generated === "object"
        ? (playbackLab.generated as Record<string, unknown>)
        : {};
    const startup1080Url = firstNonEmptyString(
      input.asset.startup1080FaststartAvc,
      variants.startup1080FaststartAvc,
      generatedHints.startup1080FaststartAvc,
      variants.startup1080Faststart
    );
    const upgrade1080Url = firstNonEmptyString(
      input.asset.upgrade1080FaststartAvc,
      variants.upgrade1080FaststartAvc,
      generatedHints.upgrade1080FaststartAvc,
      variants.upgrade1080Faststart
    );
    const ladder1080 = shouldGenerate1080Ladder(probedW, probedH);

    const encodeOnly: VideoEncodeOnlySelection = {};
    if (input.needs.posterHigh) encodeOnly.posterHigh = true;
    if (input.needs.preview360Avc) encodeOnly.preview360Avc = true;
    if (input.needs.main720Avc) encodeOnly.main720Avc = true;
    if (input.needs.startup540FaststartAvc) encodeOnly.startup540FaststartAvc = true;
    if (input.needs.startup720FaststartAvc) encodeOnly.startup720FaststartAvc = true;
    if (ladder1080) {
      if (input.needs.startup1080FaststartAvc || !startup1080Url) encodeOnly.startup1080FaststartAvc = true;
      if (input.needs.upgrade1080FaststartAvc || !upgrade1080Url) encodeOnly.upgrade1080FaststartAvc = true;
    }

    const wantsAnyEncode = Object.keys(encodeOnly).length > 0 && Object.values(encodeOnly).some(Boolean);
    if (!wantsAnyEncode) {
      return {
        generated: {},
        generationMetadata: undefined,
        diagnosticsJson: undefined,
        sourceWidth: probedW > 0 ? probedW : undefined,
        sourceHeight: probedH > 0 ? probedH : undefined,
        durationSec: undefined,
        hasAudio: undefined,
        bitrateKbps: undefined,
        sizeBytes: undefined,
        sourceVideoCodec: undefined,
        sourceAudioCodec: undefined,
        videosLabKeyPrefix: undefined,
        colorPipelineMeta: undefined
      };
    }

    const encoded = await encodeAndUploadVideoAsset({
      cfg,
      postId: normalizeVideoLabPostFolder(input.postId),
      asset: { id: assetId, original },
      workDir,
      encodeOnly,
      onProgress: input.onEncoderProgress,
      colorPipeline: {
        enabled: true,
        presetId: String(input.colorPipelinePresetId ?? "").trim() || DEFAULT_REELS_COLOR_PRESET_ID,
        labSubfolder: "color-v2"
      }
    });
    const generated: Record<string, string> = {};
    if (encodeOnly.posterHigh && encoded.playbackLabGenerated.posterHigh) generated.posterHigh = encoded.playbackLabGenerated.posterHigh;
    if (encodeOnly.preview360Avc && encoded.variants.preview360Avc) generated.preview360Avc = encoded.variants.preview360Avc;
    if (encodeOnly.main720Avc && encoded.variants.main720Avc) generated.main720Avc = encoded.variants.main720Avc;
    if (encodeOnly.startup540FaststartAvc && encoded.playbackLabGenerated.startup540FaststartAvc) {
      generated.startup540FaststartAvc = encoded.playbackLabGenerated.startup540FaststartAvc;
    }
    if (encodeOnly.startup720FaststartAvc && encoded.playbackLabGenerated.startup720FaststartAvc) {
      generated.startup720FaststartAvc = encoded.playbackLabGenerated.startup720FaststartAvc;
    }
    if (encodeOnly.startup1080FaststartAvc && encoded.playbackLabGenerated.startup1080FaststartAvc) {
      generated.startup1080FaststartAvc = encoded.playbackLabGenerated.startup1080FaststartAvc;
    }
    if (encodeOnly.upgrade1080FaststartAvc && encoded.playbackLabGenerated.upgrade1080FaststartAvc) {
      generated.upgrade1080FaststartAvc = encoded.playbackLabGenerated.upgrade1080FaststartAvc;
    }
    return {
      generated,
      generationMetadata: encoded.generationMetadata,
      diagnosticsJson: encoded.diagnosticsJson,
      sourceWidth: encoded.sourceWidth,
      sourceHeight: encoded.sourceHeight,
      durationSec: encoded.durationSec,
      hasAudio: encoded.hasAudio,
      bitrateKbps: encoded.sourceBitrateKbps,
      sizeBytes: encoded.sourceSizeBytes,
      sourceVideoCodec: encoded.sourceVideoCodec,
      sourceAudioCodec: encoded.sourceAudioCodec,
      videosLabKeyPrefix: encoded.videosLabKeyPrefix,
      colorPipelineMeta: encoded.colorPipelineMeta
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runReelsMvpFaststartPipeline(input: {
  postId: string;
  nativePost: Record<string, unknown>;
  /** Defaults to `phone-hlg-sdr-v1-mobius` when unset. */
  colorPipelinePresetId?: string;
  onProgress?: (evt: { phase: string; detail?: string; assetId?: string }) => void;
}): Promise<{
  mergedRaw: Record<string, unknown>;
  analyze: unknown;
  generationResults: unknown[];
  diagnosticsJson: string | null;
  videosLabKeyPrefix: string | null;
}> {
  const run = await generateMissingFastStartVariantsForPost(input.postId, input.nativePost, {
    generateMissingForAsset: async (genInput) =>
      generateMissingForAsset({
        postId: genInput.postId,
        asset: genInput.asset as Record<string, unknown>,
        needs: genInput.needs,
        colorPipelinePresetId: input.colorPipelinePresetId,
        onEncoderProgress: genInput.onEncoderProgress
      }),
    verifyGeneratedUrl: verifyGeneratedVideoUrl,
    onProgress: (evt) => input.onProgress?.(evt)
  });
  const mergedRaw = mergePlaybackLabResultsIntoRawPost(
    input.nativePost,
    run.generationResults.map((r) => ({
      assetId: r.assetId,
      generated: r.generated,
      verifyResults: r.verifyResults,
      errors: r.errors,
      skipped: r.skipped,
      colorPipelineMeta: (r as { colorPipelineMeta?: Record<string, unknown> }).colorPipelineMeta
    })),
  ) as Record<string, unknown>;

  const assets = Array.isArray(mergedRaw.assets) ? (mergedRaw.assets as Array<{ id?: string }>) : [];
  const aid = String(assets[0]?.id ?? "").trim();
  const firstGen = run.generationResults[0] as { videosLabKeyPrefix?: string } | undefined;
  const prefix =
    firstGen?.videosLabKeyPrefix?.trim() ||
    (aid ? `${videosLabKeyPrefix(input.postId, aid)}/color-v2` : null);

  return {
    mergedRaw,
    analyze: run.analyze,
    generationResults: run.generationResults,
    diagnosticsJson: null,
    videosLabKeyPrefix: prefix
  };
}
