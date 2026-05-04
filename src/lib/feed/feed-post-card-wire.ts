import type { FeedBootstrapCandidateRecord } from "../../repositories/surfaces/feed.repository.js";

export type FeedCardWireInput = FeedBootstrapCandidateRecord & {
  appPost?: unknown;
  postContractVersion?: 2;
  appPostBuildError?: string;
};

function logFeedAppPostMediaIntegrity(payload: Record<string, unknown>): void {
  if (process.env.FEED_APP_POST_MEDIA_INTEGRITY_LOG !== "1" && process.env.NODE_ENV === "production") return;
  try {
    // eslint-disable-next-line no-console
    console.info("[FeedAppPostMediaIntegrity]", JSON.stringify(payload));
  } catch {
    // best-effort only
  }
}

/**
 * Maps a feed candidate (from {@link buildPostEnvelope}) to the wire JSON for
 * {@link PostCardSummarySchema} without dropping `appPost` / `postContractVersion`.
 */
export function wireFeedCandidateToPostCardSummary(
  item: FeedCardWireInput,
  rankToken: string,
  ctx: { route: "feed.bootstrap.get" | "feed.page.get" }
): Record<string, unknown> {
  const rec = item as Record<string, unknown>;
  const appPost = rec.appPost as Record<string, unknown> | undefined;
  const appMedia = appPost?.media as Record<string, unknown> | undefined;
  const appAssets = Array.isArray(appMedia?.assets) ? (appMedia.assets as unknown[]) : [];
  const declared =
    typeof appMedia?.assetCount === "number" && Number.isFinite(appMedia.assetCount as number)
      ? Math.floor(appMedia.assetCount as number)
      : appAssets.length;
  const rawLen =
    typeof item.rawFirestoreAssetCount === "number" && Number.isFinite(item.rawFirestoreAssetCount)
      ? Math.floor(item.rawFirestoreAssetCount)
      : Array.isArray(item.assets)
        ? item.assets.length
        : 0;
  const repaired = false;
  logFeedAppPostMediaIntegrity({
    route: ctx.route,
    postId: item.postId,
    sourceShape: "feed_bootstrap_candidate",
    rawAssetCount: rawLen,
    appPostAssetCount: declared,
    embeddedAppPostAssets: appAssets.length,
    returnedAssetLength: Array.isArray(item.assets) ? item.assets.length : 0,
    hasMultipleAssets: item.hasMultipleAssets === true,
    mediaCompleteness: item.mediaCompleteness ?? "full",
    repaired,
    appPostAttached: Boolean(appPost)
  });

  const out: Record<string, unknown> = {
    postId: item.postId,
    rankToken,
    author: item.author,
    activities: item.activities,
    address: item.address ?? undefined,
    carouselFitWidth: item.carouselFitWidth,
    layoutLetterbox: item.layoutLetterbox,
    letterboxGradientTop: item.letterboxGradientTop,
    letterboxGradientBottom: item.letterboxGradientBottom,
    letterboxGradients: item.letterboxGradients,
    geo: item.geo,
    assets: item.assets,
    title: item.title ?? null,
    description: item.description ?? null,
    captionPreview: item.captionPreview,
    firstAssetUrl: item.firstAssetUrl,
    media: item.media,
    social: item.social,
    viewer: item.viewer,
    createdAtMs: item.createdAtMs,
    updatedAtMs: item.updatedAtMs,
    comments: item.comments,
    commentsPreview: item.commentsPreview,
    ...(rec.appPost !== undefined ? { appPost: rec.appPost } : {}),
    ...(rec.postContractVersion === 2 ? { postContractVersion: 2 as const } : {}),
    ...(typeof item.assetCount === "number" && Number.isFinite(item.assetCount) ? { assetCount: item.assetCount } : {}),
    ...(typeof item.hasMultipleAssets === "boolean" ? { hasMultipleAssets: item.hasMultipleAssets } : {}),
    ...(typeof item.rawFirestoreAssetCount === "number" && Number.isFinite(item.rawFirestoreAssetCount)
      ? { rawFirestoreAssetCount: item.rawFirestoreAssetCount }
      : {}),
    ...(item.mediaCompleteness ? { mediaCompleteness: item.mediaCompleteness } : {}),
    ...(item.requiresAssetHydration === true ? { requiresAssetHydration: true } : {}),
    ...(typeof item.assetsReady === "boolean" ? { assetsReady: item.assetsReady } : {}),
    ...(item.mediaStatus ? { mediaStatus: item.mediaStatus } : {}),
    ...(item.photoLink != null ? { photoLink: item.photoLink } : {}),
    ...(item.displayPhotoLink != null ? { displayPhotoLink: item.displayPhotoLink } : {}),
    ...(item.assetLocations ? { assetLocations: item.assetLocations } : {}),
    ...(typeof rec.appPostBuildError === "string" && process.env.NODE_ENV !== "production"
      ? { appPostBuildError: rec.appPostBuildError }
      : {}),
    appPostAttached: Boolean(appPost),
    appPostWireAssetCount: appAssets.length,
    wireDeclaredMediaAssetCount: declared
  };
  return out;
}
