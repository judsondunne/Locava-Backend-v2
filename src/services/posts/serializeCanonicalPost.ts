import type { CanonicalPost, CanonicalPostEnvelope } from "../../contracts/posts/canonical-post.contract.js";
import type { PostEngagementSourceAuditV2 } from "../../contracts/master-post-v2.types.js";
import { toAppPostV2FromAny } from "../../lib/posts/app-post-v2/toAppPostV2.js";
import { resolveCanonicalPostMedia } from "./resolveCanonicalPostMedia.js";
import { resolveCanonicalPostSocial } from "./resolveCanonicalPostSocial.js";

export type SerializeCanonicalPostInput = {
  rawPost: Record<string, unknown>;
  postId?: string;
  viewerState?: {
    liked?: boolean;
    saved?: boolean;
    followsAuthor?: boolean;
    savedCollectionIds?: string[];
  };
  engagementSourceAudit?: PostEngagementSourceAuditV2 | null;
};

export function serializeCanonicalPost(input: SerializeCanonicalPostInput): CanonicalPost {
  const canonical = toAppPostV2FromAny(input.rawPost, {
    postId: input.postId,
    forceNormalize: true,
    engagementSourceAudit: input.engagementSourceAudit ?? null,
    viewerState: {
      liked: input.viewerState?.liked ?? false,
      saved: input.viewerState?.saved ?? false,
      followsAuthor: input.viewerState?.followsAuthor ?? false,
      savedCollectionIds: input.viewerState?.savedCollectionIds ?? []
    }
  }) as CanonicalPost;
  // Ensure centralized media/social resolution is always exercised.
  resolveCanonicalPostMedia(canonical);
  resolveCanonicalPostSocial(canonical, { viewerHasLiked: input.viewerState?.liked });
  return canonical;
}

export function buildCanonicalPostEnvelope(post: CanonicalPost): CanonicalPostEnvelope {
  return {
    postContractVersion: 3,
    post,
    canonicalPost: post,
    appPost: post,
    appPostV2: post
  };
}
