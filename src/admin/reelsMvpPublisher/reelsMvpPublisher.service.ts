import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { AppEnv } from "../../config/env.js";
import { encodeFirestoreTimestampsInPostWrite } from "../../lib/posts/master-post-v2/encodeFirestoreTimestampsInPostWrite.js";
import { compactCanonicalPostForLiveWrite } from "../../lib/posts/master-post-v2/compactCanonicalPostV2.js";
import { normalizeMasterPostV2 } from "../../lib/posts/master-post-v2/normalizeMasterPostV2.js";
import { validateMasterPostV2 } from "../../lib/posts/master-post-v2/validateMasterPostV2.js";
import { analyzeVideoFastStartNeeds } from "../../lib/posts/master-post-v2/videoFastStartRepair.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { writeCompactLivePostAfterNativeVideoProcessing } from "../../services/posting/native-async-video-post-complete.js";
import { loadAuthorSnapshotForPosterUid } from "./authorHydration.js";
import { buildReelsMvpNativeSkeleton, deterministicPostIdForStage } from "./buildReelsMvpNativeSkeleton.js";
import { resolveGeoForReelsPublisher } from "./geoResolve.js";
import { runReelsMvpFaststartPipeline } from "./mediaPipeline.js";
import { COLOR_PIPELINE_VERSION, DEFAULT_REELS_COLOR_PRESET_ID } from "../../media/colorPipeline/index.js";
import {
  applyReelsMvpPublisherFinalizePreWrite,
  extractReelsPublisherEncoderMetaFromGenerationResults,
  type ReelsPublisherEncoderMeta
} from "./reelsMvpPublisherFinalizePreWrite.js";
import {
  reelsMvpPublisherEnabledFromEnv,
  reelsMvpPublisherMaxBatchFromEnv,
  reelsMvpPublisherRequireReadyFromEnv,
  reelsMvpPublisherWriteEnabledFromEnv
} from "./reelsMvpPublisherEnv.js";
import { pickEffectiveDraftAndMedia, getStagedDoc, listStagedReelsMvpDocs, runPublishMetaTransaction } from "./stagingRepo.js";
import type { ReelsMvpPublishMeta, StagedReelsMvpDoc } from "./types.js";
import { validatePublishedReelPostDoc } from "./validatePublishedReelPost.js";

export class ReelsMvpPublisherDisabledError extends Error {
  readonly code = "reels_mvp_publisher_disabled";
}

export class ReelsMvpPublisherWriteDisabledError extends Error {
  readonly code = "reels_mvp_publisher_write_disabled";
}

function playbackLabDiagnosticsFromRaw(merged: Record<string, unknown>): Record<string, unknown> {
  const lab =
    merged.playbackLab && typeof merged.playbackLab === "object" ? (merged.playbackLab as Record<string, unknown>) : {};
  return {
    assets: lab.assets ?? {},
    lastVerifyResults: lab.lastVerifyResults ?? []
  };
}

export function validateStagedContract(input: {
  doc: StagedReelsMvpDoc;
  requireReady: boolean;
}): string[] {
  const errs: string[] = [];
  if (String(input.doc.type ?? "") !== "reelsMvpAsset") errs.push("type_must_be_reelsMvpAsset");
  if (String(input.doc.status ?? "") !== "staged") errs.push("status_must_be_staged");
  if (input.requireReady && String(input.doc.reviewState ?? "") !== "ready") errs.push("reviewState_must_be_ready");
  return errs;
}

export function validateDraftMedia(draft: Record<string, unknown>, media: Record<string, unknown>): string[] {
  const errs: string[] = [];
  if (!String(draft.title ?? "").trim()) errs.push("title_required");
  const acts = draft.activities;
  if (!Array.isArray(acts) || acts.length === 0) errs.push("activities_required");
  if (!String(draft.posterUid ?? "").trim()) errs.push("posterUid_required");
  const lat = Number(draft.lat);
  const lng = Number(draft.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) errs.push("lat_lng_required");
  if (!String(media.originalUrl ?? "").trim().startsWith("http")) errs.push("media_originalUrl_required");
  if (!String(media.posterUrl ?? "").trim().startsWith("http")) errs.push("media_posterUrl_required");
  return errs;
}

export type DryRunOneResult = {
  stageId: string;
  stagedErrors: string[];
  author: { ok: boolean; snapshot?: unknown };
  geo?: unknown;
  analyze?: unknown;
  postId: string;
  assetId: string;
  nativeSkeleton?: Record<string, unknown>;
  normalizePreview?: {
    blockingErrors: Array<{ code?: string; message?: string }>;
    warnings: Array<{ code?: string; message?: string }>;
  };
  compactPreview?: Record<string, unknown> | null;
  compactPreviewError?: string | null;
};

export async function dryRunOne(input: {
  env: AppEnv;
  stageId: string;
  allowFallbackAuthor?: boolean;
}): Promise<DryRunOneResult> {
  if (!reelsMvpPublisherEnabledFromEnv(input.env)) {
    throw new ReelsMvpPublisherDisabledError();
  }
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  const row = await getStagedDoc({ db, stageId: input.stageId });
  if (!row) {
    return {
      stageId: input.stageId,
      stagedErrors: ["staged_doc_not_found"],
      author: { ok: false },
      postId: deterministicPostIdForStage(input.stageId),
      assetId: ""
    };
  }
  const requireReady = reelsMvpPublisherRequireReadyFromEnv(input.env);
  const stagedErrors = validateStagedContract({ doc: row.data, requireReady });
  const { draft, media, moderatorTier } = pickEffectiveDraftAndMedia(row.data);
  stagedErrors.push(...validateDraftMedia(draft, media));
  const posterUid = String(draft.posterUid ?? "").trim();
  let author = await loadAuthorSnapshotForPosterUid({ db, posterUid });
  const allowFb = input.allowFallbackAuthor === true;
  if (!author && allowFb) {
    author = { handle: posterUid, name: posterUid, profilePic: "" };
  }
  if (!author) {
    stagedErrors.push("author_missing");
  }
  const lat = Number(draft.lat);
  const lng = Number(draft.lng);
  const address = "";
  const geo = Number.isFinite(lat) && Number.isFinite(lng) ? resolveGeoForReelsPublisher({ lat, lng, address }) : undefined;

  let nativeSkeleton: Record<string, unknown> | undefined;
  let assetId = "";
  let normalizePreview: DryRunOneResult["normalizePreview"];
  let compactPreview: Record<string, unknown> | null = null;
  let compactPreviewError: string | null = null;
  const postId = deterministicPostIdForStage(input.stageId);

  if (author && geo && stagedErrors.length === 0) {
    try {
      const sk = buildReelsMvpNativeSkeleton({
        stageId: input.stageId,
        doc: row.data,
        draft,
        media,
        moderatorTier,
        author,
        geo
      });
      nativeSkeleton = sk.nativePost;
      assetId = sk.assetId;
      const normalized = normalizeMasterPostV2(sk.nativePost, {
        postId: sk.postId,
        postingFinalizeV2: true,
        postingFinalizeCanonicalizedBy: "backend_v2_reels_mvp_publisher",
        now: new Date()
      });
      const validation = validateMasterPostV2(normalized.canonical);
      normalizePreview = {
        blockingErrors: validation.blockingErrors.map((e) => ({ code: e.code, message: e.message })),
        warnings: validation.warnings.map((w) => ({ code: w.code, message: w.message }))
      };
      try {
        const compact = compactCanonicalPostForLiveWrite({
          canonical: normalized.canonical,
          rawBefore: sk.snapshotRaw,
          postId: sk.postId
        });
        compactPreview = compact.livePost as Record<string, unknown>;
      } catch (e) {
        compactPreviewError = e instanceof Error ? e.message : String(e);
      }
    } catch (e) {
      stagedErrors.push(`skeleton_failed:${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const analyze = nativeSkeleton ? analyzeVideoFastStartNeeds(nativeSkeleton, { postId }) : undefined;

  return {
    stageId: input.stageId,
    stagedErrors,
    author: { ok: Boolean(author), snapshot: author ?? null },
    geo,
    analyze,
    postId,
    assetId,
    nativeSkeleton,
    normalizePreview,
    compactPreview,
    compactPreviewError
  };
}

function isoNow(): string {
  return new Date().toISOString();
}

function firestoreTimeToIso(v: unknown): string | null {
  if (v == null) return null;
  if (typeof (v as { toDate?: () => Date }).toDate === "function") {
    try {
      const d = (v as { toDate: () => Date }).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function publishOne(input: {
  env: AppEnv;
  stageId: string;
  confirmWrite: boolean;
  forceRebuild?: boolean;
  allowFallbackAuthor?: boolean;
  /** Overrides staged `publish.colorPipelinePreset` when set. */
  colorPipelinePreset?: string;
  onLog?: (line: string) => void;
}): Promise<Record<string, unknown>> {
  if (!reelsMvpPublisherEnabledFromEnv(input.env)) {
    throw new ReelsMvpPublisherDisabledError();
  }
  if (!reelsMvpPublisherWriteEnabledFromEnv(input.env) || !input.confirmWrite) {
    throw new ReelsMvpPublisherWriteDisabledError();
  }
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");

  const trace: string[] = [];
  const log = (m: string) => {
    const line = `${isoNow()}  ${m}`;
    trace.push(line);
    input.onLog?.(line);
  };

  const deterministicPostId = deterministicPostIdForStage(input.stageId);
  log(`publish begin stageId=${input.stageId} deterministicPostId=${deterministicPostId} path=posts/${deterministicPostId}`);

  const row = await getStagedDoc({ db, stageId: input.stageId });
  if (!row) {
    log("staged doc not found (getStagedDoc empty)");
    return { ok: false, code: "not_found", stageId: input.stageId, postId: deterministicPostId, trace };
  }

  const requireReady = reelsMvpPublisherRequireReadyFromEnv(input.env);
  const stagedErrors = validateStagedContract({ doc: row.data, requireReady });
  const { draft, media, moderatorTier } = pickEffectiveDraftAndMedia(row.data);
  stagedErrors.push(...validateDraftMedia(draft, media));
  if (stagedErrors.length) {
    log(`staged_invalid: ${stagedErrors.join("; ")}`);
    await runPublishMetaTransaction({
      db,
      stageId: input.stageId,
      mutate: (prev) => ({
        ...(prev ?? { status: "not_started" }),
        status: "failed",
        error: stagedErrors.join(";")
      })
    });
    return { ok: false, code: "staged_invalid", errors: stagedErrors, stageId: input.stageId, postId: deterministicPostId, trace };
  }

  const posterUid = String(draft.posterUid ?? "").trim();
  let author = await loadAuthorSnapshotForPosterUid({ db, posterUid });
  if (!author && input.allowFallbackAuthor === true) {
    author = { handle: posterUid, name: posterUid, profilePic: "" };
  }
  if (!author) {
    log("author_missing for posterUid");
    await runPublishMetaTransaction({
      db,
      stageId: input.stageId,
      mutate: (prev) => ({
        ...(prev ?? { status: "not_started" }),
        status: "failed",
        error: "author_missing"
      })
    });
    return { ok: false, code: "author_missing", stageId: input.stageId, postId: deterministicPostId, trace };
  }

  const lat = Number(draft.lat);
  const lng = Number(draft.lng);
  const geo = resolveGeoForReelsPublisher({ lat, lng, address: "" });
  const postId = deterministicPostId;
  const manifestAssetId = row.data.publish?.mediaManifest?.assetId ?? null;

  const postSnap = await db.collection("posts").doc(postId).get();
  const prevPublish = row.data.publish;
  const colorPreset =
    String(input.colorPipelinePreset ?? "").trim() ||
    String(prevPublish?.colorPipelinePreset ?? "").trim() ||
    DEFAULT_REELS_COLOR_PRESET_ID;
  if (!input.forceRebuild && postSnap.exists && prevPublish?.status === "published" && prevPublish.postId === postId) {
    log(
      `short_circuit already_published (posts/${postId} exists, staging publish.status=published); use forceRebuild to redo`
    );
    return {
      ok: true,
      code: "already_published",
      postId,
      stageId: input.stageId,
      trace,
      readBack: {
        exists: postSnap.exists,
        updateTime: firestoreTimeToIso(postSnap.updateTime),
        createTime: firestoreTimeToIso(postSnap.createTime)
      }
    };
  }

  const runId = randomUUID();
  log(`mark staging publish meta → processing runId=${runId}`);
  await runPublishMetaTransaction({
    db,
    stageId: input.stageId,
    mutate: (prev) => ({
      ...(prev ?? { status: "not_started" }),
      status: "processing",
      postId,
      runId,
      processingStartedAt: new Date().toISOString(),
      error: null
    })
  });
  log("staging meta transaction committed");

  try {
    const sk = buildReelsMvpNativeSkeleton({
      stageId: input.stageId,
      doc: row.data,
      draft,
      media,
      moderatorTier,
      author,
      geo,
      assetIdOverride: manifestAssetId
    });
    log(`built native skeleton postId=${sk.postId} assetId=${sk.assetId} (doc id must match postId for /posts/{id})`);

    log("starting faststart / encode pipeline (this can take a while)…");
    const pipe = await runReelsMvpFaststartPipeline({
      postId: sk.postId,
      nativePost: sk.nativePost,
      colorPipelinePresetId: colorPreset,
      onProgress: (e) => log(`pipeline ${e.phase}${e.detail ? `: ${e.detail}` : ""}`)
    });
    log("pipeline finished merging working post");

    const genErrs = (pipe.generationResults as Array<{ errors?: string[] }>).flatMap((r) => r.errors ?? []);
    if (genErrs.length) {
      throw new Error(`encode_or_verify_failed:${genErrs.join(";")}`);
    }

    log(`firestore write: posts/${sk.postId} set(merge:false) via writeCompactLivePostAfterNativeVideoProcessing`);
    const encoderMeta = extractReelsPublisherEncoderMetaFromGenerationResults(
      (pipe.generationResults ?? []) as Array<Record<string, unknown>>
    );
    const encoderMetaFull: ReelsPublisherEncoderMeta = {
      ...encoderMeta,
      colorPipelinePreset: colorPreset,
      colorPipelineVersion: COLOR_PIPELINE_VERSION
    };
    const workingPost = applyReelsMvpPublisherFinalizePreWrite(
      pipe.mergedRaw as Record<string, unknown>,
      encoderMetaFull
    );
    log("reels finalize pre-write: lifecycle→active, mediaStatus→ready, readiness.processingStatus when flags true, encoder meta merged");
    const writeRes = await writeCompactLivePostAfterNativeVideoProcessing({
      db,
      postRef: db.collection("posts").doc(sk.postId),
      postId: sk.postId,
      snapshotRaw: sk.snapshotRaw,
      workingPost,
      playbackLabDiagnosticsAssets: playbackLabDiagnosticsFromRaw(pipe.mergedRaw),
      diagnosticsExtra: { stageId: input.stageId, runId, pipeline: "reels_mvp_publisher" },
      normalizeMasterPostV2Extras: { postingFinalizeCanonicalizedBy: "backend_v2_reels_mvp_publisher" },
      processingCompletedSource: "reels_mvp_publisher",
      diagnosticsDocSource: "reels_mvp_publisher"
    });
    if (!writeRes.ok) {
      throw new Error(writeRes.error);
    }
    log("firestore set() completed OK (compact live post)");

    const saved = await db.collection("posts").doc(sk.postId).get();
    const savedData = (saved.data() ?? {}) as Record<string, unknown>;
    const normalizedSaved = normalizeMasterPostV2(savedData, {
      postId: sk.postId,
      now: new Date()
    });
    const val2 = validatePublishedReelPostDoc({
      postId: sk.postId,
      compactLive: savedData,
      canonical: normalizedSaved.canonical
    });
    if (!val2.ok) {
      throw new Error(`saved_post_validation_failed:${val2.errors.join(";")}`);
    }

    const topPostId = savedData.postId != null ? String(savedData.postId) : "";
    const topId = savedData.id != null ? String(savedData.id) : "";
    log(
      `read-back posts/${sk.postId}: exists=${saved.exists} updateTime=${firestoreTimeToIso(saved.updateTime) ?? "?"} topLevel.postId=${topPostId || "?"} topLevel.id=${topId || "?"}`
    );
    if (topPostId && topPostId !== sk.postId) {
      log(`WARN top-level postId field (${topPostId}) differs from doc id (${sk.postId})`);
    }
    if (topId && topId !== sk.postId) {
      log(`WARN top-level id field (${topId}) differs from doc id (${sk.postId})`);
    }

    log("mark staging publish meta → published");
    await runPublishMetaTransaction({
      db,
      stageId: input.stageId,
      mutate: (prev) => ({
        ...(prev ?? {}),
        status: "published",
        postId: sk.postId,
        runId,
        publishedAt: new Date().toISOString(),
        error: null,
        mediaManifest: {
          assetId: sk.assetId,
          videosLabKeyPrefix: pipe.videosLabKeyPrefix ?? "",
          colorPipelinePreset: colorPreset,
          colorPipelineVersion: COLOR_PIPELINE_VERSION
        },
        colorPipelinePreset: colorPreset,
        colorPipelineVersion: COLOR_PIPELINE_VERSION
      })
    });
    log("done");

    return {
      ok: true,
      code: "published",
      postId: sk.postId,
      stageId: input.stageId,
      validationWarnings: val2.warnings,
      trace,
      readBack: {
        exists: saved.exists,
        updateTime: firestoreTimeToIso(saved.updateTime),
        createTime: firestoreTimeToIso(saved.createTime),
        topLevelPostId: topPostId || null,
        topLevelId: topId || null
      }
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`ERROR ${msg}`);
    await runPublishMetaTransaction({
      db,
      stageId: input.stageId,
      mutate: (prev) => ({
        ...(prev ?? {}),
        status: "failed",
        postId,
        runId,
        error: msg
      })
    });
    return { ok: false, code: "publish_failed", error: msg, postId, stageId: input.stageId, trace };
  }
}

/**
 * Re-encode media for an existing published post using staged original + color-v2 ladder.
 * Thin wrapper over `publishOne` with `forceRebuild: true` and a color preset; validates `postId`
 * matches `deterministicPostIdForStage(stageId)`.
 */
export async function regenerateReelMediaFromStage(input: {
  env: AppEnv;
  stageId: string;
  postId: string;
  colorPipelinePreset: string;
  confirmWrite: boolean;
  onLog?: (line: string) => void;
}): Promise<Record<string, unknown>> {
  if (!reelsMvpPublisherEnabledFromEnv(input.env)) {
    throw new ReelsMvpPublisherDisabledError();
  }
  if (!reelsMvpPublisherWriteEnabledFromEnv(input.env) || !input.confirmWrite) {
    throw new ReelsMvpPublisherWriteDisabledError();
  }
  const expected = deterministicPostIdForStage(input.stageId);
  if (expected !== String(input.postId).trim()) {
    throw new Error(`postId_mismatch:expected_${expected}`);
  }
  return publishOne({
    env: input.env,
    stageId: input.stageId,
    confirmWrite: true,
    forceRebuild: true,
    colorPipelinePreset: input.colorPipelinePreset,
    onLog: input.onLog
  });
}

export async function listStagedForPublisher(input: {
  env: AppEnv;
  limit: number;
  readyOnly: boolean;
}): Promise<
  Array<{
    id: string;
    row: StagedReelsMvpDoc;
    authorPreview: unknown;
    publish: ReelsMvpPublishMeta | null;
  }>
> {
  if (!reelsMvpPublisherEnabledFromEnv(input.env)) {
    throw new ReelsMvpPublisherDisabledError();
  }
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  const rows = await listStagedReelsMvpDocs({ db, limit: input.limit, readyOnly: input.readyOnly });
  const out: Array<{
    id: string;
    expectedPostId: string;
    row: StagedReelsMvpDoc;
    authorPreview: unknown;
    publish: ReelsMvpPublishMeta | null;
  }> = [];
  for (const r of rows) {
    const { draft } = pickEffectiveDraftAndMedia(r.data);
    const uid = String(draft.posterUid ?? "").trim();
    const ap = uid ? await loadAuthorSnapshotForPosterUid({ db, posterUid: uid }) : null;
    out.push({
      id: r.id,
      expectedPostId: deterministicPostIdForStage(r.id),
      row: r.data,
      authorPreview: ap,
      publish: (r.data.publish ?? null) as ReelsMvpPublishMeta | null
    });
  }
  return out;
}

export async function batchDryRun(input: {
  env: AppEnv;
  limit: number;
}): Promise<Array<{ stageId: string; result: DryRunOneResult }>> {
  const cap = Math.min(10, Math.max(1, input.limit));
  const rows = await listStagedForPublisher({ env: input.env, limit: cap, readyOnly: true });
  const results: Array<{ stageId: string; result: DryRunOneResult }> = [];
  for (const r of rows) {
    const result = await dryRunOne({ env: input.env, stageId: r.id });
    results.push({ stageId: r.id, result });
  }
  return results;
}

export async function batchPublish(input: {
  env: AppEnv;
  limit: number;
  confirmWrite: boolean;
  stopOnError?: boolean;
  onLog?: (line: string) => void;
}): Promise<Array<Record<string, unknown>>> {
  if (!reelsMvpPublisherEnabledFromEnv(input.env)) {
    throw new ReelsMvpPublisherDisabledError();
  }
  if (!reelsMvpPublisherWriteEnabledFromEnv(input.env) || !input.confirmWrite) {
    throw new ReelsMvpPublisherWriteDisabledError();
  }
  const max = Math.min(reelsMvpPublisherMaxBatchFromEnv(input.env), Math.max(1, input.limit));
  const rows = await listStagedForPublisher({ env: input.env, limit: max, readyOnly: true });
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const one = await publishOne({
      env: input.env,
      stageId: r.id,
      confirmWrite: true,
      onLog: input.onLog
    });
    out.push(one);
    if (input.stopOnError === true && one.ok === false) break;
  }
  return out;
}

export async function verifyPostById(input: { env: AppEnv; postId: string }): Promise<Record<string, unknown>> {
  if (!reelsMvpPublisherEnabledFromEnv(input.env)) {
    throw new ReelsMvpPublisherDisabledError();
  }
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  const snap = await db.collection("posts").doc(input.postId).get();
  if (!snap.exists) return { ok: false, code: "not_found", postId: input.postId };
  const raw = (snap.data() ?? {}) as Record<string, unknown>;
  const normalized = normalizeMasterPostV2(raw, { postId: input.postId, now: new Date() });
  const compact = compactCanonicalPostForLiveWrite({
    canonical: normalized.canonical,
    rawBefore: raw,
    postId: input.postId
  });
  const val = validatePublishedReelPostDoc({
    postId: input.postId,
    compactLive: compact.livePost as Record<string, unknown>,
    canonical: normalized.canonical
  });
  try {
    JSON.stringify(encodeFirestoreTimestampsInPostWrite(compact.livePost as Record<string, unknown>));
  } catch (e) {
    val.errors.push(`firestore_encode:${e instanceof Error ? e.message : String(e)}`);
  }
  return { ok: val.ok, postId: input.postId, errors: val.errors, warnings: val.warnings };
}
