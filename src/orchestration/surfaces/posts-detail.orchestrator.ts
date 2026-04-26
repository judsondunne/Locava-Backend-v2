import { PostsDetailResponseSchema } from "../../contracts/surfaces/posts-detail.contract.js";
import type { FeedService } from "../../services/surfaces/feed.service.js";
import { SourceOfTruthRequiredError } from "../../repositories/source-of-truth/strict-mode.js";
import { z } from "zod";

type PostsDetailResponse = z.infer<typeof PostsDetailResponseSchema>;

export class PostsDetailOrchestrator {
  constructor(private readonly service: FeedService) {}

  async run(input: { viewerId: string; postId: string }): Promise<PostsDetailResponse> {
    const startedAt = Date.now();
    const { viewerId, postId } = input;
    const cardSummary = await this.service.loadPostCardSummary(viewerId, postId);
    const post = await this.service.loadPostDetail(postId, viewerId);
    const author = cardSummary.author;
    const social = cardSummary.social;
    const viewer = cardSummary.viewer;
    void this.service.loadCommentsPreview(postId, 0).catch(() => undefined);
    return {
      routeName: "posts.detail.get",
      firstRender: {
        post: {
          postId: post.postId,
          userId: post.userId,
          caption: post.caption,
          title: post.title ?? null,
          description: post.description ?? null,
          activities: post.activities ?? [],
          address: post.address ?? null,
          lat: post.lat ?? null,
          lng: post.lng ?? null,
          location: {
            address: post.address ?? null,
            lat: post.lat ?? null,
            lng: post.lng ?? null
          },
          mentions: post.mentions ?? [],
          tags: post.tags ?? [],
          visibility: post.visibility,
          deleted: post.deleted,
          blocked: post.blocked,
          createdAtMs: post.createdAtMs,
          mediaType: post.mediaType,
          thumbUrl: post.thumbUrl,
          assets: post.assets,
          cardSummary: {
            ...cardSummary,
            rankToken: `rank-${viewerId.slice(0, 6)}-post-detail-${postId}`,
            captionPreview: post.caption,
            media: {
              type: post.mediaType,
              posterUrl: post.thumbUrl,
              aspectRatio: 9 / 16,
              startupHint: post.mediaType === "video" ? "poster_then_preview" : "poster_only"
            },
            author,
            social,
            viewer,
            updatedAtMs: post.createdAtMs
          }
        },
        author,
        social,
        viewer: {
          ...viewer,
          viewerFollowsCreator:
            "viewerFollowsCreator" in viewer
              ? Boolean((viewer as { viewerFollowsCreator?: unknown }).viewerFollowsCreator)
              : undefined
        }
      },
      deferred: { commentsPreview: null },
      degraded: false,
      fallbacks: [],
      debugHydrationSource: "mixed",
      debugReads: 0,
      debugPostIds: [postId],
      debugMissingIds: [],
      debugDurationMs: Date.now() - startedAt
    };
  }

  async runBatch(input: {
    viewerId: string;
    postIds: string[];
    reason: "prefetch" | "open" | "surface_bootstrap";
  }): Promise<{
    routeName: "posts.detail.batch";
    reason: "prefetch" | "open" | "surface_bootstrap";
    found: Array<{ postId: string; detail: PostsDetailResponse }>;
    missing: string[];
    forbidden: string[];
    debugHydrationSource: "cache" | "firestore" | "mixed";
    debugReads: number;
    debugPostIds: string[];
    debugMissingIds: string[];
    debugDurationMs: number;
  }> {
    const startedAt = Date.now();
    const ordered = input.postIds.map((id) => id.trim()).filter(Boolean);
    const unique = [...new Set(ordered)];
    const found: Array<{ postId: string; detail: PostsDetailResponse }> = [];
    const missing: string[] = [];
    for (const postId of unique) {
      try {
        const detail = await this.run({ viewerId: input.viewerId, postId });
        found.push({ postId, detail });
      } catch (error) {
        if (error instanceof Error && error.message === "feed_post_not_found") {
          missing.push(postId);
          continue;
        }
        if (error instanceof SourceOfTruthRequiredError) {
          missing.push(postId);
          continue;
        }
        throw error;
      }
    }
    return {
      routeName: "posts.detail.batch",
      reason: input.reason,
      found,
      missing,
      forbidden: [],
      debugHydrationSource: "mixed",
      debugReads: 0,
      debugPostIds: unique,
      debugMissingIds: missing,
      debugDurationMs: Date.now() - startedAt
    };
  }
}
