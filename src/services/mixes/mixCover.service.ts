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

function readFromAssets(obj: Record<string, unknown>): string | null {
  const assets = obj.assets;
  if (!Array.isArray(assets) || assets.length === 0 || typeof assets[0] !== "object" || !assets[0]) {
    return null;
  }
  const a0 = assets[0] as Record<string, unknown>;
  const variants = (a0.variants ?? {}) as Record<string, unknown>;
  const sm = (variants.sm ?? {}) as Record<string, unknown>;
  const md = (variants.md ?? {}) as Record<string, unknown>;
  const lg = (variants.lg ?? {}) as Record<string, unknown>;
  const thumb = (variants.thumb ?? {}) as Record<string, unknown>;
  const candidates: unknown[] = [
    sm.webp,
    md.webp,
    lg.webp,
    thumb.webp,
    a0.poster,
    a0.thumbnail,
    a0.original,
    a0.url,
    a0.downloadURL,
    (variants as any)?.poster,
  ];
  for (const c of candidates) {
    const u = asHttpUrl(c);
    if (u) return u;
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
    obj.thumbnail,
    obj.thumbUrl,
    obj.previewImageUrl,
    obj.previewUrl,
    obj.displayPhotoUrl,
    obj.displayPhotoLink,
    obj.imageUrl,
    obj.photoLink,
    media.posterUrl,
    (media as any)?.thumbnailUrl,
  ];
  for (const c of directCandidates) {
    const u = asHttpUrl(c);
    if (u) return { coverImageUrl: u, coverPostId: postId };
  }

  const fromAssets = readFromAssets(obj);
  if (fromAssets) return { coverImageUrl: fromAssets, coverPostId: postId };

  return { coverImageUrl: null, coverPostId: postId };
}

