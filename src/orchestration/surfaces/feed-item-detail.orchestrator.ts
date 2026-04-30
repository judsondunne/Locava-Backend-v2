import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { FeedItemDetailResponse } from "../../contracts/surfaces/feed-item-detail.contract.js";
import {
  recordCacheHit,
  recordCacheMiss,
  recordFallback,
  recordTimeout
} from "../../observability/request-context.js";
import type { FeedService } from "../../services/surfaces/feed.service.js";
import { TimeoutError, withTimeout } from "../timeouts.js";

export class FeedItemDetailOrchestrator {
  constructor(private readonly service: FeedService) {}

  async run(input: {
    viewerId: string;
    postId: string;
    debugSlowDeferredMs: number;
  }): Promise<FeedItemDetailResponse> {
    const { viewerId, postId } = input;
    const enableDetailCache = input.debugSlowDeferredMs === 0;
    const cacheKey = buildCacheKey("entity", ["feed-item-detail-v1", viewerId, postId]);
    if (enableDetailCache) {
      const cached = await globalCache.get<FeedItemDetailResponse>(cacheKey);
      if (cached) {
        recordCacheHit();
        return cached;
      }
    }
    recordCacheMiss();

    const [cardSummary, post] = await Promise.all([
      this.service.loadPostCardSummary(viewerId, postId),
      this.service.loadPostDetail(postId, viewerId)
    ]);
    const author = cardSummary.author;
    const social = cardSummary.social;
    const viewer = cardSummary.viewer;
    const fallbacks: string[] = [];
    let commentsPreview: Array<{ commentId: string; userId: string; text: string; createdAtMs: number }> | null = null;

    const embeddedPreview =
      Array.isArray((post as { commentsPreview?: unknown[] }).commentsPreview) &&
      ((post as { commentsPreview?: unknown[] }).commentsPreview?.length ?? 0) > 0
        ? ((post as { commentsPreview?: unknown[] }).commentsPreview as Array<{ commentId: string; userId: string; text: string; createdAtMs: number }>)
        : Array.isArray((post as { comments?: unknown[] }).comments) &&
            ((post as { comments?: unknown[] }).comments?.length ?? 0) > 0
          ? ((post as { comments?: unknown[] }).comments as Array<{ commentId: string; userId: string; text: string; createdAtMs: number }>)
          : null;
    const explicitCommentCount =
      typeof (post as { commentCount?: unknown }).commentCount === "number"
        ? ((post as { commentCount: number }).commentCount ?? 0)
        : typeof (post as { commentsCount?: unknown }).commentsCount === "number"
          ? ((post as { commentsCount: number }).commentsCount ?? 0)
          : null;
    const fallbackCommentCount = Array.isArray((post as { comments?: unknown[] }).comments)
      ? ((post as { comments?: unknown[] }).comments?.length ?? 0)
      : 0;
    const resolvedCommentCount = Math.max(
      0,
      Math.floor(explicitCommentCount ?? fallbackCommentCount),
    );

    if (embeddedPreview && embeddedPreview.length > 0) {
      commentsPreview = embeddedPreview;
    } else if (resolvedCommentCount > 0) {
      const commentsPreviewPromise = withTimeout(
        this.service.loadCommentsPreview(postId, input.debugSlowDeferredMs),
        90,
        "feed.item_detail.comments_preview"
      );
      void commentsPreviewPromise.catch(() => undefined);
      try {
        commentsPreview = await commentsPreviewPromise;
      } catch (error) {
        if (error instanceof TimeoutError) {
          fallbacks.push("comments_preview_timeout");
          recordTimeout("feed.item_detail.comments_preview");
          recordFallback("comments_preview_timeout");
        } else {
          fallbacks.push("comments_preview_failed");
          recordFallback("comments_preview_failed");
        }
      }
    }

    const response: FeedItemDetailResponse = {
      routeName: "feed.itemdetail.get",
      firstRender: {
        post: {
          postId: post.postId,
          userId: post.userId,
          caption: post.caption,
          createdAtMs: post.createdAtMs,
          mediaType: post.mediaType,
          thumbUrl: post.thumbUrl,
          assets: post.assets,
          comments: (post as { comments?: unknown[] }).comments ?? [],
          commentsPreview:
            (post as { commentsPreview?: unknown[] }).commentsPreview ??
            (post as { comments?: unknown[] }).comments ??
            [],
          cardSummary: {
            ...cardSummary,
            rankToken: `rank-${viewerId.slice(0, 6)}-detail-${postId}`,
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
        viewer
      },
      deferred: {
        commentsPreview
      },
      background: {
        prefetchHints: ["feed:item:comments:next", "feed:item:social:refresh"]
      },
      degraded: fallbacks.length > 0,
      fallbacks
    };

    if (enableDetailCache) {
      await globalCache.set(cacheKey, response, 8_000);
    }

    return response;
  }
}
