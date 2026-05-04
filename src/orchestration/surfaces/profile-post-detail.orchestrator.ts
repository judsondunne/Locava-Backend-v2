import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { ProfilePostDetailResponse } from "../../contracts/surfaces/profile-post-detail.contract.js";
import {
  attachAppPostV2ToRecord,
  batchHydrateAppPostsOnRecords
} from "../../lib/posts/app-post-v2/enrichAppPostV2Response.js";
import { buildPostMediaReadiness } from "../../lib/posts/media-readiness.js";
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

    const commentsPreviewPromise = withTimeout(
      this.service.loadCommentsPreview(postId, debugSlowDeferredMs),
      90,
      "profile.post_detail.comments_preview"
    );
    void commentsPreviewPromise.catch(() => undefined);
    const detail = await this.service.loadPostDetail(userId, postId, viewerId);

    const fallbacks: string[] = [];
    let commentsPreview: Array<{ commentId: string; userId: string; text: string; createdAtMs: number }> | null = null;

    try {
      commentsPreview = await commentsPreviewPromise;
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
    const mediaReadiness = buildPostMediaReadiness(detail as Record<string, unknown>);

    const response: ProfilePostDetailResponse = {
      routeName: "profile.postdetail.get",
      firstRender: {
        profileUserId: userId,
        post: {
          postId: detail.postId,
          userId: detail.userId,
          caption: detail.caption,
          title: (detail as { title?: string | null }).title ?? null,
          description: (detail as { description?: string | null }).description ?? null,
          activities: (detail as { activities?: string[] }).activities ?? [],
          address: (detail as { address?: string | null }).address ?? null,
          lat: (detail as { lat?: number | null }).lat ?? null,
          lng: (detail as { lng?: number | null }).lng ?? null,
          geoData: (detail as { geoData?: Record<string, unknown> }).geoData,
          coordinates: (detail as { coordinates?: Record<string, unknown> }).coordinates,
          createdAtMs: detail.createdAtMs,
          updatedAtMs: (detail as { updatedAtMs?: number }).updatedAtMs ?? detail.createdAtMs,
          mediaType: detail.mediaType,
          thumbUrl: detail.thumbUrl,
          assetsReady: (detail as { assetsReady?: boolean }).assetsReady,
          mediaReadiness,
          mediaStatus: mediaReadiness.mediaStatus,
          videoProcessingStatus: mediaReadiness.videoProcessingStatus,
          posterReady: mediaReadiness.posterReady,
          posterPresent: mediaReadiness.posterPresent,
          posterUrl: mediaReadiness.posterUrl,
          playbackReady: mediaReadiness.playbackReady,
          playbackUrlPresent: mediaReadiness.playbackUrlPresent,
          playbackUrl: mediaReadiness.playbackUrl,
          fallbackVideoUrl: mediaReadiness.fallbackVideoUrl,
          instantPlaybackReady: mediaReadiness.instantPlaybackReady,
          playbackLab: (detail as { playbackLab?: Record<string, unknown> }).playbackLab,
          assetLocations: (detail as { assetLocations?: Array<Record<string, unknown>> }).assetLocations,
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

    const postPayload = response.firstRender.post as Record<string, unknown>;
    const rawForApp =
      detail.sourceRawPost ??
      ({
        id: detail.postId,
        postId: detail.postId,
        userId: detail.userId,
        caption: detail.caption,
        title: detail.title,
        description: detail.description,
        activities: detail.activities,
        address: detail.address,
        lat: detail.lat,
        lng: detail.lng,
        long: detail.lng,
        geoData: detail.geoData,
        coordinates: detail.coordinates,
        createdAtMs: detail.createdAtMs,
        updatedAtMs: (detail as { updatedAtMs?: number }).updatedAtMs,
        mediaType: detail.mediaType,
        thumbUrl: detail.thumbUrl,
        assets: detail.assets.map((a) => ({
          id: a.id,
          type: a.type,
          original: a.original,
          poster: a.poster,
          thumbnail: a.thumbnail,
          aspectRatio: a.aspectRatio,
          durationSec: a.durationSec,
          width: a.width,
          height: a.height,
          orientation: a.orientation,
          variants: a.variants
        })),
        likesCount: detail.social.likeCount,
        commentCount: detail.social.commentCount
      } satisfies Record<string, unknown>);
    attachAppPostV2ToRecord(postPayload, rawForApp, {
      postId: detail.postId,
      viewerStatePartial: {
        liked: detail.social.viewerHasLiked,
        saved: false,
        savedCollectionIds: [],
        followsAuthor: false
      }
    });
    await batchHydrateAppPostsOnRecords([postPayload], viewerId);

    console.info("[post.detail.media_readiness]", {
      surface: "profile.postdetail",
      postId,
      ...mediaReadiness
    });

    if (enableDetailCache) {
      await globalCache.set(cacheKey, response, 10_000);
    }
    return response;
  }
}
