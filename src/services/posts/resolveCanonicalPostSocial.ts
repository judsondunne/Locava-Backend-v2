import type { CanonicalPost } from "../../contracts/posts/canonical-post.contract.js";

export type CanonicalPostSocialResolved = {
  likeCount: number;
  commentCount: number;
  viewerHasLiked: boolean;
  commentsPreview: unknown[];
  recentLikers: unknown[];
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
  const resolved = {
    likeCount: Math.max(0, Math.floor(post.engagement?.likeCount ?? 0)),
    commentCount: Math.max(0, Math.floor(post.engagement?.commentCount ?? 0)),
    viewerHasLiked: opts?.viewerHasLiked === true || post.viewerState?.liked === true,
    commentsPreview: Array.isArray(post.engagementPreview?.recentComments) ? post.engagementPreview.recentComments : [],
    recentLikers: Array.isArray(post.engagementPreview?.recentLikers) ? post.engagementPreview.recentLikers : [],
    source: "engagement"
  };
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.info("[POST_SOCIAL_RESOLVED]", {
      postId: post.id ?? null,
      source: resolved.source,
      likeCount: resolved.likeCount,
      commentCount: resolved.commentCount,
      viewerHasLiked: resolved.viewerHasLiked,
      commentsPreviewCount: resolved.commentsPreview.length,
      recentLikersCount: resolved.recentLikers.length,
      usedEngagementFields: true,
      usedSubcollectionCounts: false,
      usedSubcollectionPreview: false,
    });
  }
  return resolved;
}
