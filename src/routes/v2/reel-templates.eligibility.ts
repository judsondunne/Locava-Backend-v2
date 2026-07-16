/**
 * Quality / lifecycle gates for the published-reel template library.
 * Keeps processing, failed, and poster-less reels out of Inspiration.
 */

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return "";
}

function firstVideoAsset(
  doc: Record<string, unknown>
): { original?: string; poster?: string } | null {
  const assets = Array.isArray(doc.assets) ? (doc.assets as Record<string, unknown>[]) : [];
  const video = assets.find((asset) => String(asset.type ?? "").toLowerCase() === "video");
  if (!video) return null;
  return {
    original: typeof video.original === "string" ? video.original : undefined,
    poster: typeof video.poster === "string" ? video.poster : undefined
  };
}

function lifecycleStatus(doc: Record<string, unknown>): string {
  const lifecycle =
    doc.lifecycle && typeof doc.lifecycle === "object" && !Array.isArray(doc.lifecycle)
      ? (doc.lifecycle as Record<string, unknown>)
      : null;
  return String(lifecycle?.status ?? "").toLowerCase().trim();
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/**
 * Returns true when a public reel post is safe to expose as a remixable template:
 * not processing/failed/deleted, has a usable http(s) poster, and is not explicitly
 * assets-not-ready.
 */
export function isEligibleReelTemplateSource(doc: Record<string, unknown>): boolean {
  const mediaStatus = String(doc.mediaStatus ?? "").toLowerCase().trim();
  if (mediaStatus === "processing" || mediaStatus === "failed") return false;
  if (mediaStatus && mediaStatus !== "ready") return false;

  const videoProcessingStatus = String(doc.videoProcessingStatus ?? "").toLowerCase().trim();
  if (
    videoProcessingStatus === "pending" ||
    videoProcessingStatus === "processing" ||
    videoProcessingStatus === "failed"
  ) {
    return false;
  }

  if (doc.assetsReady === false) return false;
  if (doc.posterReady === false || doc.posterPresent === false) return false;

  const life = lifecycleStatus(doc);
  if (life === "failed" || life === "deleted") return false;
  // Stale lifecycle.metadata: finalize sets lifecycle.status=processing while media fields
  // can already be ready (profile/map playback). Trust media gates when they say completed.
  if (
    life === "processing" &&
    (mediaStatus !== "ready" || videoProcessingStatus !== "completed")
  ) {
    return false;
  }

  const video = firstVideoAsset(doc);
  const posterUrl = firstString(
    doc.posterUrl,
    doc.displayPhotoLink,
    doc.thumbUrl,
    video?.poster
  );
  if (!posterUrl || !isHttpUrl(posterUrl)) return false;

  return true;
}
