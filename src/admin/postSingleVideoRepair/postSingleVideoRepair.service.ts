import { Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import type { AppEnv } from "../../config/env.js";
import { getFastStartRawAssetRows } from "../../lib/posts/master-post-v2/videoFastStartRepair.js";
import { normalizeMasterPostV2 } from "../../lib/posts/master-post-v2/normalizeMasterPostV2.js";
import { validateMasterPostV2 } from "../../lib/posts/master-post-v2/validateMasterPostV2.js";
import { analyzeVideoFastStartNeeds } from "../../lib/posts/master-post-v2/videoFastStartRepair.js";
import { compactCanonicalPostForLiveWrite } from "../../lib/posts/master-post-v2/compactCanonicalPostV2.js";
import {
  getFirestoreAdminIdentity,
  getFirestoreSourceClient
} from "../../repositories/source-of-truth/firestore-client.js";
import { assemblePostAssetsFromStagedItems } from "../../services/posting/assemblePostAssets.js";
import {
  buildNativePostDocument,
  validateNativePostDocumentForWrite,
  type NativePostGeoBlock,
  type NativePostUserSnapshot
} from "../../services/posting/buildPostDocument.js";
import { writeCompactLivePostAfterNativeVideoProcessing } from "../../services/posting/native-async-video-post-complete.js";
import {
  applyPublishPresentationToAssembledAssets,
  selectPublishLetterboxGradients
} from "../../services/posting/select-publish-letterbox-gradients.js";
import { loadAuthorSnapshotForPosterUid } from "../reelsMvpPublisher/authorHydration.js";
import { resolveGeoForReelsPublisher } from "../reelsMvpPublisher/geoResolve.js";
import { runReelsMvpFaststartPipeline } from "../reelsMvpPublisher/mediaPipeline.js";
import { COLOR_PIPELINE_VERSION, DEFAULT_REELS_COLOR_PRESET_ID } from "../../media/colorPipeline/index.js";
import {
  applyReelsMvpPublisherFinalizePreWrite,
  extractReelsPublisherEncoderMetaFromGenerationResults,
  type ReelsPublisherEncoderMeta
} from "../reelsMvpPublisher/reelsMvpPublisherFinalizePreWrite.js";
import { reelsMvpPublisherEnabledFromEnv } from "../reelsMvpPublisher/reelsMvpPublisherEnv.js";
import { ReelsMvpPublisherDisabledError, ReelsMvpPublisherWriteDisabledError } from "../reelsMvpPublisher/reelsMvpPublisher.service.js";
import { validatePublishedReelPostDoc } from "../reelsMvpPublisher/validatePublishedReelPost.js";
import { isValidFirestorePostDocId, normalizeFirestorePostDocId } from "./aidenBrossWorkbench.constants.js";

export { isValidFirestorePostDocId, normalizeFirestorePostDocId };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function assertTrustedOriginalVideoUrl(url: string): void {
  const t = String(url ?? "").trim();
  if (!/^https:\/\//i.test(t)) {
    throw new Error("newOriginalUrl_must_be_https");
  }
  if (/postSessionStaging\//i.test(t)) {
    throw new Error("newOriginalUrl_must_not_be_staging_path");
  }
  let host = "";
  try {
    host = new URL(t).hostname.toLowerCase();
  } catch {
    throw new Error("newOriginalUrl_invalid_url");
  }
  const ok =
    host.endsWith("wasabisys.com") ||
    host.endsWith("locava.app") ||
    host.endsWith("amazonaws.com");
  if (!ok) {
    throw new Error("newOriginalUrl_host_not_allowed");
  }
}

export type PostSingleVideoRepairPlan = {
  postId: string;
  userId: string;
  title: string;
  content: string;
  activities: string[];
  lat: number;
  lng: number;
  privacy: string;
  moderatorTier: number;
  reel: boolean;
  assetId: string;
  posterUrl: string;
  tags: Array<Record<string, unknown>>;
  texts: unknown[];
  recordings: unknown[];
  carouselFitWidth: boolean | undefined;
  letterboxGradients: Array<{ top: string; bottom: string }> | undefined;
};

function pickPosterUrlFromAssetRow(raw: Record<string, unknown>, row: Record<string, unknown>): string {
  const v = asRecord(row.video) ?? {};
  const pb = asRecord(v.playback) ?? {};
  const lab = asRecord(row.playbackLab) ?? {};
  const gen = asRecord(lab.generated) ?? {};
  const variants = { ...asRecord(row.variants), ...asRecord(v.variants) };
  const candidates = [
    row.poster,
    row.thumbnail,
    row.posterHigh,
    v.posterUrl,
    v.posterHighUrl,
    gen.posterHigh,
    variants.posterHigh,
    raw.displayPhotoLink,
    raw.photoLink,
    raw.thumbUrl,
    raw.posterUrl,
    asRecord(raw.media)?.cover && (asRecord(asRecord(raw.media)?.cover)?.url as string),
    asRecord(raw.media)?.cover && (asRecord(asRecord(raw.media)?.cover)?.thumbUrl as string)
  ];
  for (const c of candidates) {
    const s = typeof c === "string" ? c.trim() : "";
    if (s.startsWith("http")) return s;
  }
  return "";
}

/**
 * Read a live `/posts/{id}` document (compact or legacy) and derive inputs for rebuilding a single-video native skeleton.
 */
export function buildPostSingleVideoRepairPlan(
  raw: Record<string, unknown>,
  postIdInput: string,
  newOriginalUrl: string
): { ok: true; plan: PostSingleVideoRepairPlan } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  assertTrustedOriginalVideoUrl(newOriginalUrl);

  const postId = normalizeFirestorePostDocId(postIdInput);
  if (!isValidFirestorePostDocId(postId)) errors.push("postId_format_invalid");

  const docIdRaw = String(raw.id ?? raw.postId ?? "").trim();
  const docId = docIdRaw ? normalizeFirestorePostDocId(docIdRaw) : "";
  if (docId && docId !== postId) errors.push("post_doc_id_mismatch");

  const rows = getFastStartRawAssetRows(raw as Record<string, unknown>);
  if (rows.length !== 1) errors.push("expected_exactly_one_asset_row");
  const row = rows[0] ? asRecord(rows[0]) : null;
  if (!row) errors.push("no_asset_row");
  const rowType = String(row?.type ?? row?.mediaType ?? "").toLowerCase();
  if (row && rowType !== "video") errors.push("first_asset_must_be_video");

  const reel =
    raw.reel === true ||
    (asRecord(raw.classification)?.reel === true) ||
    String(raw.mediaType ?? "").toLowerCase() === "video";
  if (!reel) errors.push("post_must_be_reel_or_video_media");

  const userId = String(raw.userId ?? raw.ownerId ?? raw.authorId ?? "").trim();
  if (!userId) errors.push("userId_missing");

  const title = String(raw.title ?? "").trim();
  if (!title) errors.push("title_missing");

  let activities: string[] = [];
  if (Array.isArray(raw.activities)) {
    activities = raw.activities.map((a) => String(a ?? "").trim()).filter(Boolean);
  }
  if (activities.length === 0) errors.push("activities_missing");

  const lat = Number(raw.lat);
  const lng = Number(raw.lng ?? raw.long);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) errors.push("lat_lng_invalid");

  const assetId = String(row?.id ?? "").trim();
  if (!assetId) errors.push("video_asset_id_missing");

  const posterUrl = row ? pickPosterUrlFromAssetRow(raw, row) : "";
  if (!posterUrl) errors.push("poster_url_missing_use_existing_cover_or_thumb");

  const moderatorTierRaw = raw.moderatorTier;
  const moderatorTier =
    typeof moderatorTierRaw === "number" && Number.isFinite(moderatorTierRaw)
      ? Math.min(5, Math.max(0, Math.trunc(moderatorTierRaw)))
      : 0;

  const content = String(raw.caption ?? raw.content ?? "").trim();
  const privacy = String(raw.privacy ?? "Public Spot").trim() || "Public Spot";
  const tags = Array.isArray(raw.tags) ? (raw.tags as Array<Record<string, unknown>>) : [];
  const texts = Array.isArray(raw.texts) ? raw.texts : [];
  const recordings = Array.isArray(raw.recordings) ? raw.recordings : [];
  const carouselFitWidth = typeof raw.carouselFitWidth === "boolean" ? raw.carouselFitWidth : undefined;
  const letterboxGradients = Array.isArray(raw.letterboxGradients)
    ? (raw.letterboxGradients as Array<{ top: string; bottom: string }>)
    : undefined;

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    plan: {
      postId,
      userId,
      title,
      content,
      activities,
      lat,
      lng,
      privacy,
      moderatorTier,
      reel: true,
      assetId,
      posterUrl,
      tags,
      texts,
      recordings,
      carouselFitWidth,
      letterboxGradients
    }
  };
}

function playbackLabDiagnosticsFromRaw(merged: Record<string, unknown>): Record<string, unknown> {
  const lab =
    merged.playbackLab && typeof merged.playbackLab === "object" ? (merged.playbackLab as Record<string, unknown>) : {};
  return {
    assets: lab.assets ?? {},
    lastVerifyResults: lab.lastVerifyResults ?? []
  };
}

function extraLiveTopLevelFromSnapshot(snapshotRaw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const copyKeys = ["createdAt", "createdAtMs", "time-created", "time", "lastUpdated", "updatedAtMs"] as const;
  for (const k of copyKeys) {
    const v = snapshotRaw[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function isoNow(): string {
  return new Date().toISOString();
}

export async function dryRunPostSingleVideoRepair(input: {
  env: AppEnv;
  db: Firestore;
  postId: string;
  newOriginalUrl: string;
}): Promise<Record<string, unknown>> {
  if (!reelsMvpPublisherEnabledFromEnv(input.env)) {
    throw new ReelsMvpPublisherDisabledError();
  }
  const postId = normalizeFirestorePostDocId(String(input.postId ?? "").trim());
  if (!isValidFirestorePostDocId(postId)) {
    return { ok: false, code: "plan_invalid", postId, errors: ["postId_format_invalid"] };
  }
  const snap = await input.db.collection("posts").doc(postId).get();
  if (!snap.exists) {
    return { ok: false, code: "not_found", postId };
  }
  const raw = (snap.data() ?? {}) as Record<string, unknown>;
  const planRes = buildPostSingleVideoRepairPlan(raw, postId, input.newOriginalUrl);
  if (!planRes.ok) {
    return { ok: false, code: "plan_invalid", postId, errors: planRes.errors };
  }
  const plan = planRes.plan;

  const author = await loadAuthorSnapshotForPosterUid({ db: input.db, posterUid: plan.userId });
  if (!author) {
    return { ok: false, code: "author_missing", postId, userId: plan.userId };
  }

  const geo = resolveGeoForReelsPublisher({
    lat: plan.lat,
    lng: plan.lng,
    address: String(raw.address ?? raw.placeName ?? "").trim()
  });

  const nowMs = Date.now();
  const nowTs = Timestamp.fromMillis(nowMs);
  const assembled = assemblePostAssetsFromStagedItems(plan.postId, [
    {
      index: 0,
      assetType: "video",
      assetId: plan.assetId,
      originalUrl: input.newOriginalUrl.trim(),
      posterUrl: plan.posterUrl
    }
  ]);
  const gradientPick = selectPublishLetterboxGradients({
    assetCount: assembled.assets.length,
    bodyLetterboxGradients: plan.letterboxGradients,
    bodyCarouselFitWidth: plan.carouselFitWidth,
    bodyAssetPresentations: undefined,
    stagingLetterboxGradients: undefined,
    stagingCarouselFitWidth: undefined,
    stagingAssetPresentations: undefined,
    assetBlurhashes: [],
    fallbackAllowed: true
  });
  applyPublishPresentationToAssembledAssets(assembled.assets, gradientPick.perAssetPresentation);

  const nativePost = buildNativePostDocument({
    postId: plan.postId,
    effectiveUserId: plan.userId,
    viewerId: plan.userId,
    sessionId: `postSingleVideoRepair:${plan.postId}`,
    stagedSessionId: `postSingleVideoRepair:${plan.postId}`,
    idempotencyKey: `postSingleVideoRepair:${plan.postId}:${nowMs}`,
    nowMs,
    nowTs,
    user: author as NativePostUserSnapshot,
    title: plan.title,
    content: plan.content,
    activities: plan.activities.length ? plan.activities : ["misc"],
    lat: plan.lat,
    lng: plan.lng,
    address: geo.addressDisplayName ?? "",
    privacy: plan.privacy,
    tags: plan.tags,
    texts: plan.texts,
    recordings: plan.recordings,
    assembled,
    geo: geo as NativePostGeoBlock,
    carouselFitWidth: plan.carouselFitWidth ?? gradientPick.carouselFitWidth,
    letterboxGradients: plan.letterboxGradients ?? gradientPick.letterboxGradients
  });
  nativePost.reel = true;
  nativePost.moderatorTier = plan.moderatorTier;

  let validateErr: string | null = null;
  try {
    validateNativePostDocumentForWrite(nativePost);
  } catch (e) {
    validateErr = e instanceof Error ? e.message : String(e);
  }

  const normalized = normalizeMasterPostV2(nativePost, {
    postId: plan.postId,
    postingFinalizeV2: true,
    postingFinalizeCanonicalizedBy: "backend_v2_post_single_video_repair",
    now: new Date(nowMs)
  });
  const validation = validateMasterPostV2(normalized.canonical);
  let compactPreview: Record<string, unknown> | null = null;
  let compactPreviewError: string | null = null;
  try {
    const compact = compactCanonicalPostForLiveWrite({
      canonical: normalized.canonical,
      rawBefore: raw,
      postId: plan.postId
    });
    compactPreview = compact.livePost as Record<string, unknown>;
  } catch (e) {
    compactPreviewError = e instanceof Error ? e.message : String(e);
  }

  const analyze = analyzeVideoFastStartNeeds(nativePost, { postId: plan.postId });

  return {
    ok: validateErr === null && validation.blockingErrors.length === 0,
    postId: plan.postId,
    preserved: {
      title: plan.title,
      activities: plan.activities,
      lat: plan.lat,
      lng: plan.lng,
      userId: plan.userId,
      assetId: plan.assetId,
      posterUrlUsedAsBridge: plan.posterUrl,
      newOriginalUrl: input.newOriginalUrl.trim()
    },
    nativeValidateError: validateErr,
    canonicalBlockingErrors: validation.blockingErrors.map((e) => ({ code: e.code, message: e.message })),
    canonicalWarnings: validation.warnings.map((w) => ({ code: w.code, message: w.message })),
    analyze,
    compactPreviewBytesEstimate: compactPreview ? JSON.stringify(compactPreview).length : null,
    compactPreviewError
  };
}

export async function executePostSingleVideoRepair(input: {
  env: AppEnv;
  postId: string;
  newOriginalUrl: string;
  confirmWrite: boolean;
  colorPipelinePreset?: string;
  onLog?: (line: string) => void;
}): Promise<Record<string, unknown>> {
  if (!reelsMvpPublisherEnabledFromEnv(input.env)) {
    throw new ReelsMvpPublisherDisabledError();
  }
  if (input.confirmWrite !== true) {
    throw new ReelsMvpPublisherWriteDisabledError("confirmWrite must be true in the request body");
  }
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");

  const trace: string[] = [];
  const log = (m: string) => {
    const line = `${isoNow()}  ${m}`;
    trace.push(line);
    input.onLog?.(line);
  };

  const postId = normalizeFirestorePostDocId(String(input.postId ?? "").trim());
  if (!isValidFirestorePostDocId(postId)) {
    log("postId_format_invalid");
    return { ok: false, code: "plan_invalid", errors: ["postId_format_invalid"], postId, trace };
  }
  log(`repair begin postId=${postId}`);

  const snap = await db.collection("posts").doc(postId).get();
  if (!snap.exists) {
    const fsId = getFirestoreAdminIdentity();
    const proj = fsId.projectId ?? "unknown";
    log(`post not found (firestore projectId=${proj}, path posts/${postId})`);
    return {
      ok: false,
      code: "not_found",
      postId,
      firestoreProjectId: fsId.projectId,
      trace
    };
  }
  const snapshotRaw = { ...(snap.data() as Record<string, unknown>) };

  const planRes = buildPostSingleVideoRepairPlan(snapshotRaw, postId, input.newOriginalUrl);
  if (!planRes.ok) {
    log(`plan_invalid: ${planRes.errors.join("; ")}`);
    return { ok: false, code: "plan_invalid", errors: planRes.errors, postId, trace };
  }
  const plan = planRes.plan;

  const author = await loadAuthorSnapshotForPosterUid({ db, posterUid: plan.userId });
  if (!author) {
    log("author_missing");
    return { ok: false, code: "author_missing", postId, userId: plan.userId, trace };
  }

  const geo = resolveGeoForReelsPublisher({
    lat: plan.lat,
    lng: plan.lng,
    address: String(snapshotRaw.address ?? snapshotRaw.placeName ?? "").trim()
  });

  const colorPreset =
    String(input.colorPipelinePreset ?? "").trim() || DEFAULT_REELS_COLOR_PRESET_ID;

  const nowMs = Date.now();
  const nowTs = Timestamp.fromMillis(nowMs);
  const assembled = assemblePostAssetsFromStagedItems(plan.postId, [
    {
      index: 0,
      assetType: "video",
      assetId: plan.assetId,
      originalUrl: input.newOriginalUrl.trim(),
      posterUrl: plan.posterUrl
    }
  ]);
  const gradientPick = selectPublishLetterboxGradients({
    assetCount: assembled.assets.length,
    bodyLetterboxGradients: plan.letterboxGradients,
    bodyCarouselFitWidth: plan.carouselFitWidth,
    bodyAssetPresentations: undefined,
    stagingLetterboxGradients: undefined,
    stagingCarouselFitWidth: undefined,
    stagingAssetPresentations: undefined,
    assetBlurhashes: [],
    fallbackAllowed: true
  });
  applyPublishPresentationToAssembledAssets(assembled.assets, gradientPick.perAssetPresentation);

  const nativePost = buildNativePostDocument({
    postId: plan.postId,
    effectiveUserId: plan.userId,
    viewerId: plan.userId,
    sessionId: `postSingleVideoRepair:${plan.postId}`,
    stagedSessionId: `postSingleVideoRepair:${plan.postId}`,
    idempotencyKey: `postSingleVideoRepair:${plan.postId}:${nowMs}`,
    nowMs,
    nowTs,
    user: author as NativePostUserSnapshot,
    title: plan.title,
    content: plan.content,
    activities: plan.activities.length ? plan.activities : ["misc"],
    lat: plan.lat,
    lng: plan.lng,
    address: geo.addressDisplayName ?? "",
    privacy: plan.privacy,
    tags: plan.tags,
    texts: plan.texts,
    recordings: plan.recordings,
    assembled,
    geo: geo as NativePostGeoBlock,
    carouselFitWidth: plan.carouselFitWidth ?? gradientPick.carouselFitWidth,
    letterboxGradients: plan.letterboxGradients ?? gradientPick.letterboxGradients
  });
  nativePost.reel = true;
  nativePost.moderatorTier = plan.moderatorTier;
  validateNativePostDocumentForWrite(nativePost);

  log("starting faststart / encode pipeline (full ladder + color v2)…");
  const pipe = await runReelsMvpFaststartPipeline({
    postId: plan.postId,
    nativePost,
    colorPipelinePresetId: colorPreset,
    onProgress: (e) => log(`pipeline ${e.phase}${e.detail ? `: ${e.detail}` : ""}`)
  });
  log("pipeline finished merging working post");

  const genErrs = (pipe.generationResults as Array<{ errors?: string[] }>).flatMap((r) => r.errors ?? []);
  if (genErrs.length) {
    log(`encode_or_verify_failed: ${genErrs.join(";")}`);
    return { ok: false, code: "encode_failed", errors: genErrs, postId, trace };
  }

  const encoderMeta = extractReelsPublisherEncoderMetaFromGenerationResults(
    (pipe.generationResults ?? []) as Array<Record<string, unknown>>
  );
  const encoderMetaFull: ReelsPublisherEncoderMeta = {
    ...encoderMeta,
    colorPipelinePreset: colorPreset,
    colorPipelineVersion: COLOR_PIPELINE_VERSION
  };
  const workingPost = applyReelsMvpPublisherFinalizePreWrite(pipe.mergedRaw as Record<string, unknown>, encoderMetaFull);
  log(`firestore write: posts/${postId} set(merge:false) via writeCompactLivePostAfterNativeVideoProcessing`);

  const writeRes = await writeCompactLivePostAfterNativeVideoProcessing({
    db,
    postRef: db.collection("posts").doc(postId),
    postId,
    snapshotRaw,
    workingPost,
    playbackLabDiagnosticsAssets: playbackLabDiagnosticsFromRaw(pipe.mergedRaw as Record<string, unknown>),
    diagnosticsExtra: { pipeline: "post_single_video_repair", newOriginalUrlHost: (() => {
      try {
        return new URL(input.newOriginalUrl.trim()).hostname;
      } catch {
        return "";
      }
    })() },
    extraLiveTopLevel: extraLiveTopLevelFromSnapshot(snapshotRaw),
    normalizeMasterPostV2Extras: { postingFinalizeCanonicalizedBy: "backend_v2_post_single_video_repair" },
    processingCompletedSource: "post_single_video_repair",
    diagnosticsDocSource: "post_single_video_repair"
  });

  if (!writeRes.ok) {
    log(`firestore write failed: ${writeRes.error}`);
    return { ok: false, code: "write_failed", error: writeRes.error, postId, trace };
  }
  log("firestore set() completed OK");

  const saved = await db.collection("posts").doc(postId).get();
  const savedData = (saved.data() ?? {}) as Record<string, unknown>;
  const normalizedSaved = normalizeMasterPostV2(savedData, {
    postId,
    now: new Date()
  });
  const val2 = validatePublishedReelPostDoc({
    postId,
    compactLive: savedData,
    canonical: normalizedSaved.canonical
  });
  if (!val2.ok) {
    log(`saved_post_validation_failed:${val2.errors.join(";")}`);
    return {
      ok: false,
      code: "saved_post_validation_failed",
      errors: val2.errors,
      postId,
      trace,
      warnings: val2.warnings
    };
  }

  log("read-back validation OK");
  return {
    ok: true,
    code: "repaired",
    postId,
    trace,
    validationWarnings: val2.warnings
  };
}
