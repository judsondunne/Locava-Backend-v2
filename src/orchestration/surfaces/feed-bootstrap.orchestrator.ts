import type { ViewerContext } from "../../auth/viewer-context.js";
import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { FeedBootstrapResponse } from "../../contracts/surfaces/feed-bootstrap.contract.js";
import { recordCacheHit, recordCacheMiss, recordFallback, recordTimeout } from "../../observability/request-context.js";
import type { FeedService } from "../../services/surfaces/feed.service.js";
import { TimeoutError, withTimeout } from "../timeouts.js";

export class FeedBootstrapOrchestrator {
  constructor(private readonly service: FeedService) {}

  private async getCachedOrLoad<T>(key: string, loader: () => Promise<T>, ttlMs: number): Promise<T> {
    const cached = await globalCache.get<T>(key);
    if (cached !== undefined) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const loaded = await loader();
    void globalCache.set(key, loaded, ttlMs);
    return loaded;
  }

  async run(input: {
    viewer: ViewerContext;
    limit: number;
    tab: "explore" | "following";
    lat?: number;
    lng?: number;
    radiusKm?: number;
    debugSlowDeferredMs: number;
  }): Promise<FeedBootstrapResponse> {
    const { viewer, limit, tab, lat, lng, radiusKm, debugSlowDeferredMs } = input;

    const enableBootstrapCache = debugSlowDeferredMs === 0;
    const bootstrapCacheKey = buildCacheKey("bootstrap", [
      "feed-bootstrap-v1",
      viewer.viewerId,
      tab,
      String(lat ?? "_"),
      String(lng ?? "_"),
      String(radiusKm ?? "_"),
      String(limit)
    ]);
    if (enableBootstrapCache) {
      const cachedBootstrap = await globalCache.get<FeedBootstrapResponse>(bootstrapCacheKey);
      if (cachedBootstrap) {
        recordCacheHit();
        return cachedBootstrap;
      }
    }
    recordCacheMiss();

    const candidates = await this.getCachedOrLoad(
      buildCacheKey("list", [
        "feed-candidates-v1",
        viewer.viewerId,
        tab,
        String(lat ?? "_"),
        String(lng ?? "_"),
        String(radiusKm ?? "_"),
        String(limit)
      ]),
      () => this.service.loadBootstrapCandidates(viewer.viewerId, limit, { tab, lat, lng, radiusKm }),
      8_000
    );

    const fallbacks: string[] = [];
    let sessionHints: { recommendationPath: "for_you_light"; staleAfterMs: number } | null = null;

    if (debugSlowDeferredMs > 0) {
      try {
        sessionHints = await withTimeout(
          this.service.loadSessionHints(viewer.viewerId, debugSlowDeferredMs),
          90,
          "feed.bootstrap.session_hints"
        );
      } catch (error) {
        if (error instanceof TimeoutError) {
          fallbacks.push("session_hints_timeout");
          recordTimeout("feed.bootstrap.session_hints");
          recordFallback("session_hints_timeout");
        } else {
          fallbacks.push("session_hints_failed");
          recordFallback("session_hints_failed");
        }
      }
    } else {
      void this.service.loadSessionHints(viewer.viewerId, debugSlowDeferredMs).catch((error) => {
        if (error instanceof TimeoutError) {
          recordTimeout("feed.bootstrap.session_hints");
          recordFallback("session_hints_timeout");
          return;
        }
        recordFallback("session_hints_failed");
      });
    }

    const response: FeedBootstrapResponse = {
      routeName: "feed.bootstrap.get",
      firstRender: {
        viewer: {
          viewerId: viewer.viewerId,
          authenticated: viewer.viewerId !== "anonymous"
        },
        feed: {
          page: {
            limit,
            count: candidates.length,
            nextCursor: candidates.length >= limit ? `cursor:${limit}` : null,
            sort: "ranked_session"
          },
          items: candidates.map((item, idx) => ({
            postId: item.postId,
            rankToken: `rank-${viewer.viewerId.slice(0, 6)}-${idx + 1}`,
            author: item.author,
            activities: item.activities,
            address: item.address,
            carouselFitWidth: item.carouselFitWidth,
            layoutLetterbox: item.layoutLetterbox,
            letterboxGradientTop: item.letterboxGradientTop,
            letterboxGradientBottom: item.letterboxGradientBottom,
            letterboxGradients: item.letterboxGradients,
            geo: item.geo,
            assets: item.assets,
            title: item.title,
            captionPreview: item.captionPreview,
            firstAssetUrl: item.firstAssetUrl,
            media: item.media,
            social: item.social,
            viewer: item.viewer,
            createdAtMs: item.createdAtMs,
            updatedAtMs: item.updatedAtMs
          }))
        }
      },
      deferred: {
        sessionHints
      },
      background: {
        cacheWarmScheduled: true,
        prefetchHints: ["feed:grid:next", "feed:social:batch"]
      },
      degraded: fallbacks.length > 0,
      fallbacks
    };

    if (enableBootstrapCache) {
      void globalCache.set(bootstrapCacheKey, response, 3_000);
    }

    return response;
  }
}
