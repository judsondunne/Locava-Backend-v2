export type MixCover = {
  coverImageUrl: string | null;
  coverPostId: string | null;
};

function asHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const u = value.trim();
  if (!/^https?:\/\//i.test(u)) return null;
  return u;
}

function isProcessingPlaceholderCdnUrl(u: string): boolean {
  return /_pending\.(jpe?g|webp)(\?|#|$)/i.test(u);
}

function isVideoPlaybackUrl(u: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u);
}

/** `photoLink` is often comma-separated in Locava — match liftable `getHeroUri` behavior. */
function firstHttpFromCommaField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  for (const part of value.split(",")) {
    const u = asHttpUrl(part.trim());
    if (u && !isProcessingPlaceholderCdnUrl(u)) return u;
  }
  return null;
}

function tierWebpOrJpg(tier: unknown): string | null {
  if (!tier || typeof tier !== "object") return null;
  const o = tier as Record<string, unknown>;
  for (const key of ["webp", "jpg"] as const) {
    const u = asHttpUrl(o[key]);
    if (u && !isProcessingPlaceholderCdnUrl(u)) return u;
  }
  return null;
}

/**
 * First hero still URL aligned with native `getHeroUri`: displayPhotoLink / photoLink / thumbUrl,
 * then assets[0] with image tier order sm→md→thumb→lg and video posters (never raw MP4 previews for tiles).
 */
function readFromAssets(obj: Record<string, unknown>): string | null {
  const assets = obj.assets;
  if (!Array.isArray(assets) || assets.length === 0 || typeof assets[0] !== "object" || !assets[0]) {
    return null;
  }
  const a0 = assets[0] as Record<string, unknown>;
  const type = String(a0.type ?? "").toLowerCase();
  const variants = (a0.variants ?? {}) as Record<string, unknown>;

  if (type === "video") {
    const posterCandidates: unknown[] = [a0.poster, a0.thumbnail, variants.poster];
    for (const c of posterCandidates) {
      const u = asHttpUrl(c);
      if (u && !isProcessingPlaceholderCdnUrl(u)) return u;
    }
    for (const key of ["preview360", "preview360Avc"] as const) {
      const u = asHttpUrl(variants[key]);
      if (u && !isVideoPlaybackUrl(u) && !isProcessingPlaceholderCdnUrl(u)) return u;
    }
    return null;
  }

  for (const tierKey of ["sm", "md", "thumb", "lg"] as const) {
    const u = tierWebpOrJpg(variants[tierKey]);
    if (u) return u;
  }
  const fallbackJpg = tierWebpOrJpg((variants as { fallbackJpg?: unknown }).fallbackJpg);
  if (fallbackJpg) return fallbackJpg;

  const tail: unknown[] = [a0.original, a0.url, a0.downloadURL];
  for (const c of tail) {
    const u = asHttpUrl(c);
    if (u && !isProcessingPlaceholderCdnUrl(u)) return u;
  }
  return null;
}

/**
 * Lightweight best-effort cover selection.
 * Intentionally does not require full post hydration.
 */
export function getBestPostCover(post: unknown): MixCover {
  if (!post || typeof post !== "object") return { coverImageUrl: null, coverPostId: null };
  const obj = post as Record<string, unknown>;
  const postId = String(obj.postId ?? obj.id ?? "").trim() || null;

  const media = (obj.media ?? {}) as Record<string, unknown>;
  const directCandidates: unknown[] = [
    obj.displayPhotoLink,
    obj.photoLink,
    obj.thumbUrl,
    obj.thumbnail,
    obj.previewImageUrl,
    obj.previewUrl,
    obj.displayPhotoUrl,
    obj.imageUrl,
    media.posterUrl,
    (media as { thumbnailUrl?: unknown }).thumbnailUrl,
  ];
  for (const c of directCandidates) {
    if (typeof c !== "string") continue;
    const u = c.includes(",") ? firstHttpFromCommaField(c) : asHttpUrl(c);
    if (u && !isProcessingPlaceholderCdnUrl(u)) return { coverImageUrl: u, coverPostId: postId };
  }

  const fromAssets = readFromAssets(obj);
  if (fromAssets) return { coverImageUrl: fromAssets, coverPostId: postId };

  return { coverImageUrl: null, coverPostId: postId };
}

/**
 * Progressive MP4 (or similar) for small muted previews (e.g. search story rail).
 * Prefers lighter tiers when the mix post row includes `assets[0].variants`.
 */
export function pickPostVideoProgressivePreviewUrl(post: unknown): string | null {
  if (!post || typeof post !== "object") return null;
  const obj = post as Record<string, unknown>;
  const assets = obj.assets;
  if (!Array.isArray(assets) || assets.length === 0 || typeof assets[0] !== "object" || !assets[0]) {
    return null;
  }
  const a0 = assets[0] as Record<string, unknown>;
  if (String(a0.type ?? "").toLowerCase() !== "video") return null;
  const variants = (a0.variants ?? {}) as Record<string, unknown>;
  const tierKeys = [
    "preview360Avc",
    "preview360",
    "startup",
    "main720Avc",
    "main720",
    "main1080Avc",
    "main1080",
  ] as const;
  for (const k of tierKeys) {
    const u = asHttpUrl(variants[k]);
    if (u && isVideoPlaybackUrl(u) && !isProcessingPlaceholderCdnUrl(u)) return u;
  }
  return null;
}
