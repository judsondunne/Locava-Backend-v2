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

type DeferredCommentPreview = NonNullable<FeedItemDetailResponse["deferred"]["commentsPreview"]>;
type EmbeddedCommentRecord = {
  commentId?: string;
  id?: string;
  userId?: string | null;
  text?: string | null;
  content?: string | null;
  createdAtMs?: number | null;
  userName?: string | null;
  userHandle?: string | null;
  userPic?: string | null;
};

function normalizeCommentsPreview(value: unknown): DeferredCommentPreview {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const wire = entry as EmbeddedCommentRecord;
    const commentId = String(wire.commentId ?? wire.id ?? "").trim();
    const userId = String(wire.userId ?? "").trim();
    const text = String(wire.text ?? wire.content ?? "").trim();
    const createdAtMs = typeof wire.createdAtMs === "number" && Number.isFinite(wire.createdAtMs)
      ? Math.max(0, Math.floor(wire.createdAtMs))
      : 0;
    if (!commentId || !userId || !text) return [];
    return [{
      commentId,
      userId,
      text,
      createdAtMs,
      userName: wire.userName ?? null,
      userHandle: wire.userHandle ?? null,
      userPic: wire.userPic ?? null
    }];
  });
}

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
        ? normalizeCommentsPreview((post as { commentsPreview?: unknown[] }).commentsPreview)
        : Array.isArray((post as { comments?: unknown[] }).comments) &&
            ((post as { comments?: unknown[] }).comments?.length ?? 0) > 0
          ? normalizeCommentsPreview((post as { comments?: unknown[] }).comments)
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
          comments: Array.isArray((post as { comments?: unknown[] }).comments)
            ? (post as { comments?: unknown[] }).comments as Array<Record<string, unknown>>
            : [],
          commentsPreview:
            Array.isArray((post as { commentsPreview?: unknown[] }).commentsPreview)
              ? (post as { commentsPreview?: unknown[] }).commentsPreview as Array<Record<string, unknown>>
              : Array.isArray((post as { comments?: unknown[] }).comments)
                ? (post as { comments?: unknown[] }).comments as Array<Record<string, unknown>>
                : [],
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
