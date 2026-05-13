import type { ViewerContext } from "../../auth/viewer-context.js";
import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { FeedBootstrapResponse } from "../../contracts/surfaces/feed-bootstrap.contract.js";
import { recordCacheHit, recordCacheMiss, recordFallback, recordTimeout } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { SuggestedFriendsService } from "../../services/surfaces/suggested-friends.service.js";
import type { UserSuggestionSummary } from "../../repositories/surfaces/suggested-friends.repository.js";
import type { FeedService } from "../../services/surfaces/feed.service.js";
import { wireFeedCandidateToPostCardSummary } from "../../lib/feed/feed-post-card-wire.js";
import { getFollowingFeedCacheGeneration } from "../../lib/feed/following-feed-cache-generation.js";
import { TimeoutError, withTimeout } from "../timeouts.js";

export class FeedBootstrapOrchestrator {
  constructor(private readonly service: FeedService) {}
  private readonly suggestedFriends = new SuggestedFriendsService();

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

    const followingFeedCacheGen =
      tab === "following" && viewer.viewerId !== "anonymous"
        ? await getFollowingFeedCacheGeneration(viewer.viewerId)
        : 0;

    const enableBootstrapCache = debugSlowDeferredMs === 0;
    const bootstrapCacheKey = buildCacheKey("bootstrap", [
      "feed-bootstrap-v1",
      viewer.viewerId,
      tab,
      String(lat ?? "_"),
      String(lng ?? "_"),
      String(radiusKm ?? "_"),
      String(limit),
      tab === "following" ? String(followingFeedCacheGen) : "_"
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
        String(limit),
        tab === "following" ? String(followingFeedCacheGen) : "0"
      ]),
      () => this.service.loadBootstrapCandidates(viewer.viewerId, limit, { tab, lat, lng, radiusKm }),
      8_000
    );

    const fallbacks: string[] = [];
    let sessionHints: { recommendationPath: "for_you_light"; staleAfterMs: number } | null = null;
    let followNudge:
      | {
          shouldShow: boolean;
          followingCount: number;
          cooldownMs: number;
          suggestedUsers: UserSuggestionSummary[];
        }
      | null = null;

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

    if (tab === "following" && viewer.viewerId !== "anonymous") {
      try {
        followNudge = await this.buildFollowNudge(viewer.viewerId);
      } catch (error) {
        fallbacks.push("follow_nudge_failed");
        recordFallback("follow_nudge_failed");
        if (error instanceof TimeoutError) {
          recordTimeout("feed.bootstrap.follow_nudge");
        }
      }
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
          items: candidates.map((item, idx) =>
            wireFeedCandidateToPostCardSummary(item, `rank-${viewer.viewerId.slice(0, 6)}-${idx + 1}`, {
              route: "feed.bootstrap.get"
            })
          ) as FeedBootstrapResponse["firstRender"]["feed"]["items"]
        }
      },
      deferred: {
        sessionHints,
        followNudge
      },
      background: {
        cacheWarmScheduled: true,
        prefetchHints: ["feed:grid:next", "feed:social:batch"]
      },
      degraded: fallbacks.length > 0,
      fallbacks
    };

    if (enableBootstrapCache) {
      void globalCache.set(bootstrapCacheKey, response, 30_000);
    }

    return response;
  }

  private cooldownMsForFollowingCount(followingCount: number): number {
    if (followingCount <= 2) return 12 * 60_000; // ~12 min
    if (followingCount <= 5) return 35 * 60_000; // ~35 min
    if (followingCount <= 15) return 2 * 60 * 60_000; // 2h
    if (followingCount <= 50) return 6 * 60 * 60_000; // 6h
    return 24 * 60 * 60_000; // 24h
  }

  private async loadFollowingCount(viewerId: string): Promise<number> {
    const db = getFirestoreSourceClient();
    if (!db) return 0;
    const cacheKey = buildCacheKey("entity", ["following-count-v1", viewerId]);
    const cached = await globalCache.get<number>(cacheKey);
    if (typeof cached === "number" && Number.isFinite(cached) && cached >= 0) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const agg = await withTimeout(db.collection("users").doc(viewerId).collection("following").count().get(), 220, "feed.bootstrap.follow_count");
    const count = Number(agg.data().count ?? 0);
    const safe = Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
    void globalCache.set(cacheKey, safe, 25_000);
    return safe;
  }

  private async buildFollowNudge(viewerId: string): Promise<NonNullable<FeedBootstrapResponse["deferred"]["followNudge"]>> {
    const followingCount = await this.loadFollowingCount(viewerId);
    const cooldownMs = this.cooldownMsForFollowingCount(followingCount);
    const now = Date.now();
    const lastKey = buildCacheKey("entity", ["follow-nudge-last-shown-v1", viewerId]);
    const lastShownAt = await globalCache.get<number>(lastKey);
    const eligible = typeof lastShownAt !== "number" || !Number.isFinite(lastShownAt) || now - lastShownAt >= cooldownMs;
    if (!eligible) {
      return { shouldShow: false, followingCount, cooldownMs, suggestedUsers: [] };
    }

    const suggestionLimit = 4;
    const suggestions = await withTimeout(
      this.suggestedFriends.getSuggestionsForUser(viewerId, {
        limit: suggestionLimit,
        surface: "home",
        includeContacts: true,
        includeMutuals: true,
        includePopular: true,
        includeNearby: false,
        excludeAlreadyFollowing: true,
        excludeBlocked: true
      }),
      500,
      "feed.bootstrap.follow_nudge"
    );
    const users = (suggestions.users ?? []).slice(0, suggestionLimit);
    void globalCache.set(lastKey, now, cooldownMs);
    return {
      shouldShow: followingCount < 50 && users.length > 0,
      followingCount,
      cooldownMs,
      suggestedUsers: users
    };
  }
}
