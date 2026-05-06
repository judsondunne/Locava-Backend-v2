import type { CanonicalPost } from "../../contracts/posts/canonical-post.contract.js";

export type CanonicalPostMediaResolved = {
  kind: "image" | "video" | "none";
  assets: CanonicalPost["media"]["assets"];
  primary: CanonicalPost["media"]["assets"][number] | null;
  poster: string | null;
  thumbnail: string | null;
  gradient: { top: string | null; bottom: string | null } | null;
};

export function resolveCanonicalPostMedia(post: CanonicalPost): CanonicalPostMediaResolved {
  const assets = Array.isArray(post.media?.assets) ? post.media.assets : [];
  const primary = assets[0] ?? null;
  const mediaKind = post.classification?.mediaKind;
  const kind: CanonicalPostMediaResolved["kind"] =
    mediaKind === "video" || mediaKind === "mixed"
      ? "video"
      : mediaKind === "image"
        ? "image"
        : assets.length > 0
          ? "image"
          : "none";
  return {
    kind,
    assets,
    primary,
    poster: post.media?.cover?.posterUrl ?? post.media?.cover?.url ?? null,
    thumbnail: post.media?.cover?.thumbUrl ?? null,
    gradient: post.media?.cover?.gradient ?? null
  };
}
