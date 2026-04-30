import type { ViewerContext } from "../../auth/viewer-context.js";
import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { ProfileBootstrapResponse } from "../../contracts/surfaces/profile-bootstrap.contract.js";
import {
  recordCacheHit,
  recordCacheMiss,
  recordSurfaceTimings
} from "../../observability/request-context.js";
import type { ProfileService } from "../../services/surfaces/profile.service.js";

const PROFILE_TABS = [
  { id: "grid", enabled: true },
  { id: "saved", enabled: true },
  { id: "likes", enabled: true },
  { id: "map", enabled: true }
] as const;

export class ProfileBootstrapOrchestrator {
  constructor(private readonly service: ProfileService) {}

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
    userId: string;
    gridLimit: number;
    debugSlowDeferredMs: number;
  }): Promise<ProfileBootstrapResponse> {
    const { viewer, userId, gridLimit, debugSlowDeferredMs } = input;
    // Native expects `gridLimit` items on first render so the grid is scrollable
    // and can deterministically trigger pagination. Keep bootstrap payload lean
    // by limiting each item to preview fields (handled in repository adapter).
    const previewLimit = gridLimit;

    const enableBootstrapCache = debugSlowDeferredMs === 0;
    const bootstrapCacheKey = buildCacheKey("bootstrap", ["profile-bootstrap-v1", viewer.viewerId, userId, previewLimit]);
    if (enableBootstrapCache) {
      const cachedBootstrap = await globalCache.get<ProfileBootstrapResponse>(bootstrapCacheKey);
      if (cachedBootstrap) {
        recordCacheHit();
        return cachedBootstrap;
      }
    }
    recordCacheMiss();

    const headerStartedAt = performance.now();
    const headerPromise = this.getCachedOrLoad(
      buildCacheKey("entity", ["profile-header-v1", userId]),
      () => this.service.loadHeader(userId),
      30_000
    ).then((value) => {
      recordSurfaceTimings({ profile_bootstrap_header_ms: performance.now() - headerStartedAt });
      return value;
    });
    const relationshipStartedAt = performance.now();
    const relationshipPromise = this.getCachedOrLoad(
      buildCacheKey("entity", ["profile-relationship-v1", viewer.viewerId, userId]),
      () => this.service.loadRelationship(viewer.viewerId, userId),
      10_000
    ).then((value) => {
      recordSurfaceTimings({ profile_bootstrap_relationship_ms: performance.now() - relationshipStartedAt });
      return value;
    });
    const gridStartedAt = performance.now();
    const gridPromise = this.getCachedOrLoad(
      buildCacheKey("list", ["profile-grid-preview-v1", userId, previewLimit]),
      () => this.service.loadGridPreview(userId, previewLimit),
      15_000
    ).then((value) => {
      recordSurfaceTimings({ profile_bootstrap_grid_preview_ms: performance.now() - gridStartedAt });
      return value;
    });

    const [header, relationship, gridPreview, profileBadgeSummary] = await Promise.all([
      headerPromise,
      relationshipPromise,
      gridPromise,
      this.service.loadBadgeSummary(userId, debugSlowDeferredMs).catch(() => null)
    ]);

    const profilePic = header.profilePic;
    const followersCount = header.counts.followers;
    const followingCount = header.counts.following;
    const response: ProfileBootstrapResponse = {
      routeName: "profile.bootstrap.get",
      firstRender: {
        profile: {
          userId: header.userId,
          handle: header.handle,
          name: header.name,
          profilePic,
          followersCount,
          followingCount,
          numFollowers: followersCount,
          numFollowing: followingCount,
          bio: header.bio,
          isOwnProfile: viewer.viewerId === header.userId
        },
        counts: {
          ...header.counts,
          followersCount,
          followingCount,
          numFollowers: followersCount,
          numFollowing: followingCount
        },
        stats: {
          followersCount,
          followingCount,
          numFollowers: followersCount,
          numFollowing: followingCount
        },
        relationship,
        tabs: [...PROFILE_TABS],
        gridPreview: {
          items: gridPreview.items,
          nextCursor: gridPreview.nextCursor
        }
      },
      deferred: {
        profileBadgeSummary
      },
      background: {
        cacheWarmScheduled: true,
        prefetchHints: ["profile:grid:next", "profile:tabs:saved"]
      },
      degraded: false,
      fallbacks: []
    };

    if (enableBootstrapCache) {
      void globalCache.set(bootstrapCacheKey, response, 5_000);
    }
    return response;
  }
}
