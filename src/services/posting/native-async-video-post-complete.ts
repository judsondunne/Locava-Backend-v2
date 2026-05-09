import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { DocumentReference } from "firebase-admin/firestore";
import { compactCanonicalPostForLiveWrite } from "../../lib/posts/master-post-v2/compactCanonicalPostV2.js";
import { encodeFirestoreTimestampsInPostWrite } from "../../lib/posts/master-post-v2/encodeFirestoreTimestampsInPostWrite.js";
import { normalizeMasterPostV2 } from "../../lib/posts/master-post-v2/normalizeMasterPostV2.js";
import { validateMasterPostV2 } from "../../lib/posts/master-post-v2/validateMasterPostV2.js";
import type { EncodedVideoAssetResult } from "../video/video-post-encoding.pipeline.js";

/**
 * Top-level keys that are dropped from the final compact `set(..., merge:false)` payload so the
 * full-document replacement implicitly removes them from /posts/{id}. This is the safe equivalent
 * of `FieldValue.delete()` for a non-merge `set` write — using `FieldValue.delete()` inside a
 * `set(..., merge: false)` payload throws:
 *   "FieldValue.delete() must appear at the top-level and can only be used in update() or set() with {merge:true}"
 * which previously poisoned successful video processing runs after all media was generated/verified.
 */
const DROPPED_ON_LIVE_WRITE_KEYS = new Set(["videoProcessingProgress"]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/** Keys trusted as moov-at-start for normalizeMasterPostV2 / selectCanonicalVideoPlaybackAsset. */
export function playbackLabVerificationFromUrls(urls: string[]): Record<string, unknown> {
  const byUrl: Record<string, boolean> = {};
  for (const u of urls) {
    const t = String(u ?? "").trim();
    if (t.startsWith("http")) byUrl[t] = true;
  }
  return { byUrl };
}

/** Strip heavy encoder blobs before merging onto the post (full blobs go to mediaProcessingDiagnostics). */
export function slimPlaybackLabAssetNode(lab: Record<string, unknown>): Record<string, unknown> {
  const gen = asRecord(lab.generated) ?? {};
  const slimGen: Record<string, unknown> = {};
  for (const k of [
    "startup540FaststartAvc",
    "startup720FaststartAvc",
    "startup1080FaststartAvc",
    "upgrade1080FaststartAvc",
    "preview360Avc",
    "main720Avc",
    "posterHigh"
  ]) {
    const v = gen[k];
    if (typeof v === "string" && v.trim()) slimGen[k] = v.trim();
  }
  return {
    status: "ready",
    generated: slimGen,
    lastVerifyAllOk: lab.lastVerifyAllOk === true,
    generationMetadata: typeof lab.generationMetadata === "object" ? lab.generationMetadata : undefined
  };
}

const PRESERVE_TOP_LEVEL_KEYS = new Set([
  "sessionId",
  "stagedSessionId",
  "tags",
  "texts",
  "recordings",
  "postId",
  "createdAtMs",
  "carouselFitWidth",
  "letterboxGradients",
  "caption",
  "description",
  "likes",
  "comments",
  "likesCount",
  "likeCount",
  "commentsCount",
  "commentCount",
  "likedBy",
  "likesVersion",
  "commentsVersion",
  "saveCount",
  "shareCount",
  "viewCount",
  "savesVersion",
  "moderatorTier",
  "place",
  "geoData",
  "idempotencyKey",
  "settingType",
  "reel",
  "isBoosted",
  "showLikes",
  "showComments",
  "privacy",
  "time-created",
  "rankingRollup",
  "rankingAggregates"
]);

/**
 * Normalize → validate → compact live doc, persist diagnostics, replace `/posts/{id}` with compact shape.
 */
export async function writeCompactLivePostAfterNativeVideoProcessing(input: {
  db: Firestore;
  postRef: DocumentReference;
  postId: string;
  /** Firestore snapshot at job start (backups / diagnostics). */
  snapshotRaw: Record<string, unknown>;
  /** Working post-shaped doc (assets + playbackLab verification + top-level status fields). */
  workingPost: Record<string, unknown>;
  /** Full-fat playbackLab.assets map for diagnostics collection only. */
  playbackLabDiagnosticsAssets: Record<string, unknown>;
  diagnosticsExtra?: Record<string, unknown>;
  /** Merged onto the final live write after compaction (e.g. `deferred1080Upgrade`). */
  extraLiveTopLevel?: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    db,
    postRef,
    postId,
    snapshotRaw,
    workingPost,
    playbackLabDiagnosticsAssets,
    diagnosticsExtra,
    extraLiveTopLevel
  } = input;
  const nowMs = Date.now();
  const nowTs = Timestamp.fromMillis(nowMs);

  try {
    const normalized = normalizeMasterPostV2(workingPost, {
      postId,
      postingFinalizeV2: true,
      now: new Date(nowMs)
    });
    const validation = validateMasterPostV2(normalized.canonical);
    if (validation.blockingErrors.length > 0) {
      const first = validation.blockingErrors[0];
      return { ok: false, error: `canonical_validation_failed:${first?.code ?? "unknown"}:${first?.message ?? ""}` };
    }

    const compact = compactCanonicalPostForLiveWrite({
      canonical: normalized.canonical,
      rawBefore: snapshotRaw,
      postId
    });

    const live = { ...compact.livePost } as Record<string, unknown>;
    for (const k of PRESERVE_TOP_LEVEL_KEYS) {
      if (k in snapshotRaw && snapshotRaw[k] !== undefined) {
        live[k] = snapshotRaw[k];
      }
    }
    live.postId = postId;
    live.id = postId;

    if (extraLiveTopLevel) {
      for (const [k, v] of Object.entries(extraLiveTopLevel)) {
        if (v !== undefined) (live as Record<string, unknown>)[k] = v;
      }
    }

    const mediaObj = asRecord(workingPost.media);
    const assetCount = Array.isArray(workingPost.assets)
      ? (workingPost.assets as unknown[]).length
      : Array.isArray(mediaObj?.assets)
        ? (mediaObj.assets as unknown[]).length
        : 0;
    live.processing = {
      status: "completed",
      phase: "ready",
      updatedAt: nowTs,
      updatedAtMs: nowMs,
      assetCount,
      source: "native_v2_finalize"
    };

    const diagId = `${postId}_${nowMs}`;
    await db
      .collection("mediaProcessingDiagnostics")
      .doc(diagId)
      .set({
        postId,
        createdAt: new Date().toISOString(),
        source: "native_v2_finalize",
        playbackLabAssets: playbackLabDiagnosticsAssets,
        compaction: {
          byteEstimateBefore: compact.byteEstimateBefore,
          byteEstimateAfter: compact.byteEstimateAfter,
          removedPaths: compact.removedPaths
        },
        ...(diagnosticsExtra ?? {})
      })
      .catch(() => {});

    const firePayload = encodeFirestoreTimestampsInPostWrite(live as Record<string, unknown>);
    /**
     * `set(..., { merge: false })` REPLACES the document, so any field absent from `firePayload` is
     * implicitly removed. That makes it both incorrect AND unnecessary to embed `FieldValue.delete()`
     * here. Strip the keys we want gone; do NOT inject sentinels into a non-merge set payload.
     */
    for (const k of DROPPED_ON_LIVE_WRITE_KEYS) {
      if (k in (firePayload as Record<string, unknown>)) {
        delete (firePayload as Record<string, unknown>)[k];
      }
    }
    await postRef.set(firePayload, { merge: false });

    /**
     * Best-effort metadata cleanup AFTER the canonical replacement succeeds. If a stale
     * `videoProcessingProgress` somehow lands on the doc through a concurrent partial writer,
     * a follow-up `update()` is the legal place to use `FieldValue.delete()`. Failure here must
     * NOT poison the post — the canonical media is already live.
     */
    try {
      await postRef.update({ videoProcessingProgress: FieldValue.delete() });
    } catch {
      /* metadata cleanup is best-effort and never fails the success path */
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Pure helper for tests: returns the firestore payload that would be written, minus keys that are
 * dropped on full-replace. Used by regression tests to assert no `FieldValue.delete()` sentinel is
 * left embedded inside a non-merge set payload (which throws against real Firestore).
 */
export function buildLivePostFirestorePayloadForTests(live: Record<string, unknown>): Record<string, unknown> {
  const firePayload = encodeFirestoreTimestampsInPostWrite({ ...live });
  for (const k of DROPPED_ON_LIVE_WRITE_KEYS) {
    if (k in firePayload) delete (firePayload as Record<string, unknown>)[k];
  }
  return firePayload;
}

/** Exposed for tests: the keys that are stripped from the live full-replace payload. */
export function getDroppedKeysOnLiveWriteForTests(): string[] {
  return [...DROPPED_ON_LIVE_WRITE_KEYS];
}

/** Merge encoder output into a legacy `assets[]` row for normalizeMasterPostV2. */
export function mergeEncodedIntoVideoAssetRow(input: {
  assetRow: Record<string, unknown>;
  encoded: EncodedVideoAssetResult | null;
  existingStartup540: string;
  existingStartup720: string;
}): Record<string, unknown> {
  const { assetRow, encoded, existingStartup540, existingStartup720 } = input;
  const vPrev = asRecord(assetRow.variants) ?? {};
  const mergedVariants: Record<string, unknown> = { ...vPrev };
  if (encoded) {
    Object.assign(mergedVariants, encoded.variants);
    if (encoded.playbackLabGenerated.startup540FaststartAvc) {
      mergedVariants.startup540FaststartAvc = encoded.playbackLabGenerated.startup540FaststartAvc;
    }
    if (encoded.playbackLabGenerated.startup720FaststartAvc) {
      mergedVariants.startup720FaststartAvc = encoded.playbackLabGenerated.startup720FaststartAvc;
    }
    if (encoded.playbackLabGenerated.posterHigh) {
      mergedVariants.posterHigh = encoded.playbackLabGenerated.posterHigh;
    }
    if (encoded.playbackLabGenerated.startup1080FaststartAvc) {
      mergedVariants.startup1080FaststartAvc = encoded.playbackLabGenerated.startup1080FaststartAvc;
    }
    if (encoded.playbackLabGenerated.upgrade1080FaststartAvc) {
      mergedVariants.upgrade1080FaststartAvc = encoded.playbackLabGenerated.upgrade1080FaststartAvc;
    }
  }
  if (existingStartup540) mergedVariants.startup540FaststartAvc = existingStartup540;
  if (existingStartup720) mergedVariants.startup720FaststartAvc = existingStartup720;

  const poster =
    String(mergedVariants.poster ?? assetRow.poster ?? "").trim() ||
    String((asRecord(assetRow.variants)?.poster as string | undefined) ?? "").trim();
  if (poster) mergedVariants.poster = poster;

  const nextMeta = encoded
    ? { ...(asRecord(assetRow.variantMetadata) ?? {}), ...encoded.variantMetadata }
    : { ...(asRecord(assetRow.variantMetadata) ?? {}) };
  delete (nextMeta as { processing?: unknown }).processing;

  return {
    ...assetRow,
    ...(encoded
      ? {
          width: encoded.sourceWidth,
          height: encoded.sourceHeight,
          durationSec: encoded.durationSec,
          aspectRatio: encoded.sourceHeight > 0 ? encoded.sourceWidth / encoded.sourceHeight : assetRow.aspectRatio
        }
      : {}),
    variants: mergedVariants,
    variantMetadata: nextMeta,
    instantPlaybackReady: true
  };
}

export function collectTrustedStartupUrlsForNativeComplete(input: {
  remoteChecks: Array<Record<string, unknown>>;
  encoded: EncodedVideoAssetResult | null;
  existingStartup540: string;
  existingStartup720: string;
}): string[] {
  const out: string[] = [];
  const push = (u: unknown) => {
    const s = typeof u === "string" ? u.trim() : "";
    if (s.startsWith("http")) out.push(s);
  };
  for (const row of input.remoteChecks) {
    if (row.ok === true || row.skipped === true) {
      push(row.url);
    }
  }
  if (input.encoded) {
    push(input.encoded.playbackLabGenerated.startup540FaststartAvc);
    push(input.encoded.playbackLabGenerated.startup720FaststartAvc);
    push(input.encoded.playbackLabGenerated.preview360Avc);
    push(input.encoded.variants.main720Avc);
  }
  push(input.existingStartup540);
  push(input.existingStartup720);
  return [...new Set(out.filter(Boolean))];
}
