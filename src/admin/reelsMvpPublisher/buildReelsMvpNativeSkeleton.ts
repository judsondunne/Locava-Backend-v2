import { Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { assemblePostAssetsFromStagedItems } from "../../services/posting/assemblePostAssets.js";
import {
  buildNativePostDocument,
  validateNativePostDocumentForWrite,
  type NativePostGeoBlock,
  type NativePostUserSnapshot
} from "../../services/posting/buildPostDocument.js";
import {
  applyPublishPresentationToAssembledAssets,
  selectPublishLetterboxGradients
} from "../../services/posting/select-publish-letterbox-gradients.js";
import type { StagedReelsMvpDoc } from "./types.js";

export function deterministicPostIdForStage(stageId: string): string {
  const h = createHash("sha1").update(`reels_mvp_publish:${stageId}`).digest("hex").slice(0, 16);
  return `post_${h}`;
}

export function defaultVideoAssetId(stageId: string): string {
  const prefix = stageId.split("_")[0] ?? "";
  const n = Number(prefix);
  if (Number.isFinite(n) && n > 0) return `video_${n}_0`;
  return `video_${Date.now()}_0`;
}

function timestampFromStaged(doc: StagedReelsMvpDoc, fallbackMs: number): Timestamp {
  const candidates = [doc.readyCommittedAt, doc.createdAt];
  for (const x of candidates) {
    if (x instanceof Timestamp) return x;
    if (x && typeof x === "object" && "toMillis" in x && typeof (x as { toMillis: () => number }).toMillis === "function") {
      const ms = (x as { toMillis: () => number }).toMillis();
      if (Number.isFinite(ms)) return Timestamp.fromMillis(ms);
    }
  }
  return Timestamp.fromMillis(fallbackMs);
}

export type BuildSkeletonResult = {
  postId: string;
  assetId: string;
  nativePost: Record<string, unknown>;
  snapshotRaw: Record<string, unknown>;
};

export function buildReelsMvpNativeSkeleton(input: {
  stageId: string;
  doc: StagedReelsMvpDoc;
  draft: Record<string, unknown>;
  media: Record<string, unknown>;
  moderatorTier: number | null;
  author: NativePostUserSnapshot;
  geo: NativePostGeoBlock;
  /** When reusing a prior manifest asset id */
  assetIdOverride?: string | null;
}): BuildSkeletonResult {
  const postId = deterministicPostIdForStage(input.stageId);
  const assetId = (input.assetIdOverride && String(input.assetIdOverride).trim()) || defaultVideoAssetId(input.stageId);
  const originalUrl = String(input.media.originalUrl ?? "").trim();
  const posterUrl = String(input.media.posterUrl ?? "").trim();
  if (!originalUrl.startsWith("http")) {
    throw new Error("staged_media_missing_original_url");
  }
  if (!posterUrl.startsWith("http")) {
    throw new Error("staged_media_missing_poster_url");
  }

  const title = String(input.draft.title ?? "").trim();
  const activitiesRaw = input.draft.activities;
  const activities = Array.isArray(activitiesRaw)
    ? activitiesRaw.map((a) => String(a ?? "").trim()).filter(Boolean)
    : [];
  const posterUid = String(input.draft.posterUid ?? "").trim();
  if (!posterUid) throw new Error("staged_draft_missing_poster_uid");

  const lat = Number(input.draft.lat);
  const lng = Number(input.draft.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("staged_draft_invalid_lat_lng");

  const nowMs = Date.now();
  const nowTs = timestampFromStaged(input.doc, nowMs);

  const assembled = assemblePostAssetsFromStagedItems(postId, [
    {
      index: 0,
      assetType: "video",
      assetId,
      originalUrl,
      posterUrl
    }
  ]);

  const gradientPick = selectPublishLetterboxGradients({
    assetCount: assembled.assets.length,
    bodyLetterboxGradients: undefined,
    bodyCarouselFitWidth: undefined,
    bodyAssetPresentations: undefined,
    stagingLetterboxGradients: undefined,
    stagingCarouselFitWidth: undefined,
    stagingAssetPresentations: undefined,
    assetBlurhashes: [],
    fallbackAllowed: true
  });
  applyPublishPresentationToAssembledAssets(assembled.assets, gradientPick.perAssetPresentation);

  const nativePost = buildNativePostDocument({
    postId,
    effectiveUserId: posterUid,
    viewerId: posterUid,
    sessionId: `reelsMvpPublisher:${input.stageId}`,
    stagedSessionId: `reelsMvpPublisher:${input.stageId}`,
    idempotencyKey: `reelsMvpPublisher:${input.stageId}`,
    nowMs: nowTs.toMillis(),
    nowTs,
    user: input.author,
    title,
    content: "",
    activities: activities.length ? activities : ["misc"],
    lat,
    lng,
    address: input.geo.addressDisplayName ?? "",
    privacy: "Public Spot",
    tags: [],
    texts: [],
    recordings: [],
    assembled,
    geo: input.geo,
    carouselFitWidth: gradientPick.carouselFitWidth,
    letterboxGradients: gradientPick.letterboxGradients
  });

  nativePost.reel = true;
  nativePost.moderatorTier =
    input.moderatorTier != null && Number.isFinite(input.moderatorTier) ? input.moderatorTier : 0;

  validateNativePostDocumentForWrite(nativePost);

  const snapshotRaw = JSON.parse(JSON.stringify(nativePost)) as Record<string, unknown>;
  return { postId, assetId, nativePost, snapshotRaw };
}
