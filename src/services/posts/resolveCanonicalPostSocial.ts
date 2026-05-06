import type { CanonicalPost } from "../../contracts/posts/canonical-post.contract.js";

export type CanonicalPostSocialResolved = {
  likeCount: number;
  commentCount: number;
  viewerHasLiked: boolean;
  source: "engagement";
};

/**
 * Canonical social shape is sourced from canonical engagement fields.
 * Upstream canonicalization already resolves subcollection-vs-doc truth.
 */
export function resolveCanonicalPostSocial(
  post: CanonicalPost,
  opts?: { viewerHasLiked?: boolean | null }
): CanonicalPostSocialResolved {
  return {
    likeCount: Math.max(0, Math.floor(post.engagement?.likeCount ?? 0)),
    commentCount: Math.max(0, Math.floor(post.engagement?.commentCount ?? 0)),
    viewerHasLiked: opts?.viewerHasLiked === true || post.viewerState?.liked === true,
    source: "engagement"
  };
}
