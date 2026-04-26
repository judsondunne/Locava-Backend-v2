import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { ProfilePostDetailResponse } from "../../contracts/surfaces/profile-post-detail.contract.js";
import {
  recordCacheHit,
  recordCacheMiss,
  recordFallback,
  recordTimeout
} from "../../observability/request-context.js";
import type { ProfilePostDetailService } from "../../services/surfaces/profile-post-detail.service.js";
import { TimeoutError, withTimeout } from "../timeouts.js";

export class ProfilePostDetailOrchestrator {
  constructor(private readonly service: ProfilePostDetailService) {}

  async run(input: {
    userId: string;
    postId: string;
    viewerId: string;
    debugSlowDeferredMs: number;
  }): Promise<ProfilePostDetailResponse> {
    const { userId, postId, viewerId, debugSlowDeferredMs } = input;

    const enableDetailCache = debugSlowDeferredMs === 0;
    const cacheKey = buildCacheKey("entity", ["profile-post-detail-v1", userId, postId, viewerId]);
    if (enableDetailCache) {
      const cached = await globalCache.get<ProfilePostDetailResponse>(cacheKey);
      if (cached) {
        recordCacheHit();
        return cached;
      }
    }
    recordCacheMiss();

    const detail = await this.service.loadPostDetail(userId, postId, viewerId);

    const fallbacks: string[] = [];
    let commentsPreview: Array<{ commentId: string; userId: string; text: string; createdAtMs: number }> | null = null;

    try {
      commentsPreview = await withTimeout(
        this.service.loadCommentsPreview(postId, debugSlowDeferredMs),
        90,
        "profile.post_detail.comments_preview"
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        fallbacks.push("comments_preview_timeout");
        recordTimeout("profile.post_detail.comments_preview");
        recordFallback("comments_preview_timeout");
      } else {
        fallbacks.push("comments_preview_failed");
        recordFallback("comments_preview_failed");
      }
    }

    const response: ProfilePostDetailResponse = {
      routeName: "profile.postdetail.get",
      firstRender: {
        profileUserId: userId,
        post: {
          postId: detail.postId,
          userId: detail.userId,
          caption: detail.caption,
          createdAtMs: detail.createdAtMs,
          mediaType: detail.mediaType,
          thumbUrl: detail.thumbUrl,
          assets: detail.assets
        },
        author: detail.author,
        social: detail.social,
        viewerActions: {
          canDelete: viewerId === userId,
          canReport: viewerId !== userId
        }
      },
      deferred: {
        commentsPreview
      },
      background: {
        prefetchHints: ["post:comments:next", "post:engagement:refresh"]
      },
      degraded: fallbacks.length > 0,
      fallbacks
    };

    if (enableDetailCache) {
      await globalCache.set(cacheKey, response, 10_000);
    }
    return response;
  }
}
