/**
 * Reels MVP publisher: patches native/merged raw post immediately before
 * `writeCompactLivePostAfterNativeVideoProcessing` so `normalizeMasterPostV2` does not keep
 * `lifecycle.status = "processing"` from `buildNativePostDocument` while media is already ready.
 */

export type ReelsPublisherEncoderMeta = {
  durationSec?: number;
  hasAudio?: boolean;
  bitrateKbps?: number;
  sizeBytes?: number;
  sourceVideoCodec?: string | null;
  sourceAudioCodec?: string | null;
  colorPipeline?: Record<string, unknown> | null;
  colorPipelinePreset?: string | null;
  colorPipelineVersion?: number | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function patchOneAssetRow(
  asset: Record<string, unknown>,
  encoderMeta: ReelsPublisherEncoderMeta | null | undefined
): Record<string, unknown> {
  const out = { ...asset };
  const videoShell = asRecord(out.video) ?? {};
  const rd = { ...(asRecord(videoShell.readiness) ?? {}) };
  if (rd.assetsReady === true && rd.instantPlaybackReady === true && rd.faststartVerified === true) {
    rd.processingStatus = "completed";
  }
  out.video = {
    ...videoShell,
    readiness: rd,
    ...(encoderMeta?.colorPipeline && typeof encoderMeta.colorPipeline === "object"
      ? { colorPipeline: encoderMeta.colorPipeline }
      : {})
  };

  if (encoderMeta?.durationSec != null && Number.isFinite(encoderMeta.durationSec)) {
    out.durationSec = encoderMeta.durationSec;
  }
  if (typeof encoderMeta?.hasAudio === "boolean") {
    out.hasAudio = encoderMeta.hasAudio;
  }
  if (encoderMeta?.bitrateKbps != null && Number.isFinite(encoderMeta.bitrateKbps)) {
    out.bitrateKbps = encoderMeta.bitrateKbps;
  }
  if (encoderMeta?.sizeBytes != null && Number.isFinite(encoderMeta.sizeBytes)) {
    out.sizeBytes = encoderMeta.sizeBytes;
  }
  if (encoderMeta) {
    const prev = asRecord(out.codecs) ?? {};
    if (encoderMeta.sourceVideoCodec != null && String(encoderMeta.sourceVideoCodec).trim()) {
      prev.video = String(encoderMeta.sourceVideoCodec).trim();
    }
    if (encoderMeta.hasAudio === false) {
      prev.audio = "none";
    } else if (encoderMeta.hasAudio === true) {
      const a =
        encoderMeta.sourceAudioCodec != null && String(encoderMeta.sourceAudioCodec).trim()
          ? String(encoderMeta.sourceAudioCodec).trim()
          : typeof prev.audio === "string" && prev.audio.trim()
            ? String(prev.audio).trim()
            : "aac";
      prev.audio = a;
    }
    if (Object.keys(prev).length > 0) out.codecs = prev;
  }
  return out;
}

/**
 * Shallow-merge fixes onto merged raw post before compact write. Does not touch playback URL
 * selection (startup720 / startup540 / poster_high) — only status mirrors and encoder metadata.
 */
export function applyReelsMvpPublisherFinalizePreWrite(
  mergedRaw: Record<string, unknown>,
  encoderMeta?: ReelsPublisherEncoderMeta | null
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...mergedRaw };

  const prevLc = asRecord(next.lifecycle) ?? {};
  next.lifecycle = {
    ...prevLc,
    status: "active"
  };
  next.mediaStatus = "ready";
  next.videoProcessingStatus = "completed";
  next.assetsReady = true;
  next.instantPlaybackReady = true;
  next.playbackReady = true;
  next.playbackUrlPresent = true;

  const pl = asRecord(next.playbackLab);
  if (pl) {
    next.playbackLab = { ...pl, status: "ready", lastVerifyAllOk: pl.lastVerifyAllOk !== false };
  }

  const patchAssetsArray = (arr: unknown[]): unknown[] => {
    if (arr.length === 0) return arr;
    const first = arr[0];
    if (!first || typeof first !== "object") return arr;
    const copy = [...arr];
    copy[0] = patchOneAssetRow(first as Record<string, unknown>, encoderMeta);
    return copy;
  };

  if (Array.isArray(next.assets)) {
    next.assets = patchAssetsArray(next.assets as unknown[]);
  }

  const media = asRecord(next.media);
  if (media && Array.isArray(media.assets)) {
    next.media = {
      ...media,
      assets: patchAssetsArray(media.assets as unknown[]),
      status: "ready",
      assetsReady: true,
      instantPlaybackReady: true
    };
  }

  const prevProc = asRecord(next.processing) ?? {};
  if (encoderMeta?.colorPipelinePreset != null || encoderMeta?.colorPipelineVersion != null) {
    next.processing = {
      ...prevProc,
      ...(encoderMeta.colorPipelinePreset != null
        ? { colorPipelinePreset: encoderMeta.colorPipelinePreset }
        : {}),
      ...(encoderMeta.colorPipelineVersion != null
        ? { colorPipelineVersion: encoderMeta.colorPipelineVersion }
        : {})
    };
  }

  return next;
}

export function extractReelsPublisherEncoderMetaFromGenerationResults(
  generationResults: Array<Record<string, unknown>>
): ReelsPublisherEncoderMeta | undefined {
  for (const row of generationResults) {
    const errs = row.errors;
    if (Array.isArray(errs) && errs.length > 0) continue;
    const ds = row.durationSec;
    if (typeof ds !== "number" || !Number.isFinite(ds)) continue;
    return {
      durationSec: ds,
      hasAudio: typeof row.hasAudio === "boolean" ? (row.hasAudio as boolean) : undefined,
      bitrateKbps: typeof row.bitrateKbps === "number" ? (row.bitrateKbps as number) : undefined,
      sizeBytes: typeof row.sizeBytes === "number" ? (row.sizeBytes as number) : undefined,
      sourceVideoCodec: typeof row.sourceVideoCodec === "string" ? (row.sourceVideoCodec as string) : null,
      sourceAudioCodec:
        typeof row.sourceAudioCodec === "string" || row.sourceAudioCodec === null
          ? (row.sourceAudioCodec as string | null)
          : undefined,
      colorPipeline:
        row.colorPipelineMeta && typeof row.colorPipelineMeta === "object"
          ? (row.colorPipelineMeta as Record<string, unknown>)
          : undefined
    };
  }
  return undefined;
}

