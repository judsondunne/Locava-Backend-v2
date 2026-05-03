import type { ViewerContext } from "../../auth/viewer-context.js";
import { globalCache } from "../../cache/global-cache.js";
import { profileBootstrapCacheKey } from "../../cache/profile-follow-graph-cache.js";
import { registerRouteCacheKey } from "../../cache/route-cache-index.js";
import { buildCacheKey } from "../../cache/types.js";
import type { ProfileBootstrapResponse } from "../../contracts/surfaces/profile-bootstrap.contract.js";
import { toProfileHeaderDTO } from "../../dto/compact-surface-dto.js";
import {
  getRequestContext,
  recordCacheHit,
  recordCacheMiss,
  recordFallback,
  recordSurfaceTimings,
} from "../../observability/request-context.js";
import type { ProfileService } from "../../services/surfaces/profile.service.js";

const PROFILE_TABS = [
  { id: "grid", enabled: true },
  { id: "saved", enabled: true },
  { id: "likes", enabled: true },
  { id: "map", enabled: true },
] as const;

const COLLECTIONS_PREVIEW_LIMIT = 4;
const ACHIEVEMENTS_PREVIEW_LIMIT = 6;

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
    const localFallbacks = new Set<string>();
    const previewLimit = gridLimit;
    const enableBootstrapCache = debugSlowDeferredMs === 0;
    const bootstrapCacheKey = profileBootstrapCacheKey(viewer.viewerId, userId, previewLimit);
    let bootstrapCacheHit = false;

    if (enableBootstrapCache) {
      const cachedBootstrap = await globalCache.get<ProfileBootstrapResponse>(bootstrapCacheKey);
      if (cachedBootstrap) {
        const gridLen = cachedBootstrap.firstRender.gridPreview.items.length;
        const posts =
          cachedBootstrap.firstRender.counts.posts ?? cachedBootstrap.summary.postCount ?? 0;
        const staleBootstrap = gridLen > 0 && posts === 0;
        if (staleBootstrap) {
          void globalCache.del(bootstrapCacheKey).catch(() => undefined);
        } else {
          recordCacheHit();
          bootstrapCacheHit = true;
          if (process.env.NODE_ENV === "production") {
            return cachedBootstrap;
          }
          const prevDebug = cachedBootstrap.debug;
          return {
            ...cachedBootstrap,
            debug: {
              timingsMs: prevDebug?.timingsMs ?? {},
              counts: prevDebug?.counts ?? {
                grid: cachedBootstrap.firstRender.gridPreview.items.length,
                collections: cachedBootstrap.firstRender.collectionsPreview.items.length,
                achievements: cachedBootstrap.firstRender.achievementsPreview.items.length,
              },
              profilePicSource: prevDebug?.profilePicSource ?? null,
              emptyReasons: prevDebug?.emptyReasons,
              dbOps: prevDebug?.dbOps,
              socialCountsDiagnostics: {
                profileUserId: userId,
                viewerId: viewer.viewerId,
                finalFollowerCount: cachedBootstrap.summary.followerCount,
                finalFollowingCount: cachedBootstrap.summary.followingCount,
                bootstrapCacheHit: true,
                countSource: "bootstrap_response_cache",
              },
            },
          };
        }
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
    )
      .then((value) => {
        recordSurfaceTimings({ profile_bootstrap_grid_preview_ms: performance.now() - gridStartedAt });
        return value;
      })
      .catch(() => {
        recordFallback("profile_grid_preview_unavailable");
        localFallbacks.add("profile_grid_preview_unavailable");
        return { items: [], nextCursor: null };
      });

    const collectionsStartedAt = performance.now();
    const collectionsPromise = this.getCachedOrLoad(
      buildCacheKey("list", ["profile-collections-preview-v1", viewer.viewerId, userId, COLLECTIONS_PREVIEW_LIMIT]),
      () =>
        this.service.loadCollections({
          viewerId: viewer.viewerId,
          userId,
          cursor: null,
          limit: COLLECTIONS_PREVIEW_LIMIT,
        }),
      15_000
    )
      .then((value) => {
        recordSurfaceTimings({ profile_bootstrap_collections_preview_ms: performance.now() - collectionsStartedAt });
        return value;
      })
      .catch(() => {
        recordFallback("profile_collections_preview_unavailable");
        localFallbacks.add("profile_collections_preview_unavailable");
        return {
          items: [],
          nextCursor: null,
          emptyReason: "profile_collections_unavailable",
        };
      });

    const achievementsStartedAt = performance.now();
    const achievementsPromise = this.getCachedOrLoad(
      buildCacheKey("list", ["profile-achievements-preview-v1", userId, ACHIEVEMENTS_PREVIEW_LIMIT]),
      () =>
        this.service.loadAchievements({
          userId,
          cursor: null,
          limit: ACHIEVEMENTS_PREVIEW_LIMIT,
        }),
      15_000
    )
      .then((value) => {
        recordSurfaceTimings({ profile_bootstrap_achievements_preview_ms: performance.now() - achievementsStartedAt });
        return value;
      })
      .catch(() => {
        recordFallback("profile_achievements_preview_unavailable");
        localFallbacks.add("profile_achievements_preview_unavailable");
        return {
          items: [],
          nextCursor: null,
          emptyReason: "profile_achievements_unavailable",
        };
      });

    const [headerRaw, relationshipRaw, gridPreview, collectionsPreview, achievementsPreview, profileBadgeSummary] =
      await Promise.all([
        headerPromise,
        relationshipPromise.catch(() => {
          recordFallback("profile_relationship_unavailable");
          localFallbacks.add("profile_relationship_unavailable");
          return {
            isSelf: viewer.viewerId === userId,
            following: false,
            followedBy: false,
            canMessage: false,
          };
        }),
        gridPromise,
        collectionsPromise,
        achievementsPromise,
        this.service.loadBadgeSummary(userId, debugSlowDeferredMs).catch(() => null),
      ]);

    const header = toProfileHeaderDTO({
      userId: headerRaw.userId,
      handle: headerRaw.handle,
      name: headerRaw.name,
      profilePic: headerRaw.profilePic,
      profilePicSmallPath: headerRaw.profilePicSmallPath ?? null,
      profilePicLargePath: headerRaw.profilePicLargePath ?? null,
      bio: headerRaw.bio ?? null,
      updatedAtMs: headerRaw.updatedAtMs ?? null,
      profileVersion: headerRaw.profileVersion ?? null,
      counts: headerRaw.counts ?? null,
    });
    const relationship = {
      isSelf: Boolean(relationshipRaw.isSelf ?? viewer.viewerId === userId),
      following: Boolean(relationshipRaw.following),
      followedBy: Boolean(relationshipRaw.followedBy),
      canMessage: Boolean(relationshipRaw.canMessage),
    };
    const profilePic = header.profilePic;
    const followersCount = header.counts.followers;
    const followingCount = header.counts.following;
    const gridPreviewItemCount = gridPreview.items.length;
    let postsCountEffective = header.counts.posts;
    let postCountRepairApplied = false;
    let postCountLowerBoundUsed = false;
    let gridVsPostsInvariantViolated = false;
    if (gridPreviewItemCount > 0 && postsCountEffective === 0) {
      gridVsPostsInvariantViolated = true;
      postCountRepairApplied = true;
      postCountLowerBoundUsed = true;
      postsCountEffective = Math.max(postsCountEffective, gridPreviewItemCount);
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          JSON.stringify({
            event: "profile_header_count_invariant_violation",
            profileUserId: userId,
            viewerId: viewer.viewerId,
            gridItems: gridPreviewItemCount,
            postsCountBefore: header.counts.posts,
            postsCountAfter: postsCountEffective,
            cacheStatus: bootstrapCacheHit ? "bootstrap_response_cache" : "fresh_assembly",
            headerSources: { postsCount: "gridLowerBound" },
          })
        );
      }
    }
    const ctx = getRequestContext();
    const fallbacks = [...new Set([...(ctx?.fallbacks.slice() ?? []), ...localFallbacks])];

    const response: ProfileBootstrapResponse = {
      routeName: "profile.bootstrap.get",
      profileUserId: header.userId,
      summary: {
        userId: header.userId,
        handle: header.handle,
        name: header.name,
        displayName: header.name,
        profilePic,
        profilePicSmallPath: header.profilePicSmallPath ?? null,
        profilePicLargePath: header.profilePicLargePath ?? null,
        bio: header.bio ?? null,
        followerCount: followersCount,
        followingCount,
        postCount: postsCountEffective,
        isFollowingViewer: relationship.following,
        isViewer: relationship.isSelf,
        profileVersion: header.profileVersion ?? null,
        updatedAtMs: header.updatedAtMs ?? null,
      },
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
          bio: header.bio ?? undefined,
          isOwnProfile: relationship.isSelf,
        },
        counts: {
          posts: postsCountEffective,
          followers: followersCount,
          following: followingCount,
          followersCount,
          followingCount,
          numFollowers: followersCount,
          numFollowing: followingCount,
        },
        stats: {
          followersCount,
          followingCount,
          numFollowers: followersCount,
          numFollowing: followingCount,
        },
        relationship,
        tabs: [...PROFILE_TABS],
        gridPreview: {
          items: gridPreview.items,
          nextCursor: gridPreview.nextCursor,
        },
        collectionsPreview: {
          items: collectionsPreview.items,
          nextCursor: collectionsPreview.nextCursor,
        },
        achievementsPreview: {
          items: achievementsPreview.items,
          nextCursor: achievementsPreview.nextCursor,
        },
      },
      deferred: {
        profileBadgeSummary,
      },
      background: {
        cacheWarmScheduled: true,
        prefetchHints: ["profile:grid:next", "profile:collections:next", "profile:achievements:next"],
      },
      degraded: fallbacks.length > 0,
      fallbacks,
      debug:
        process.env.NODE_ENV === "production"
          ? undefined
          : {
              timingsMs: {
                header: Math.round(performance.now() - headerStartedAt),
                relationship: Math.round(performance.now() - relationshipStartedAt),
                grid: Math.round(performance.now() - gridStartedAt),
                collections: Math.round(performance.now() - collectionsStartedAt),
                achievements: Math.round(performance.now() - achievementsStartedAt),
              },
              counts: {
                grid: gridPreview.items.length,
                collections: collectionsPreview.items.length,
                achievements: achievementsPreview.items.length,
              },
              profilePicSource: headerRaw.profilePicSource ?? null,
              emptyReasons: {
                collections: collectionsPreview.emptyReason ?? null,
                achievements: achievementsPreview.emptyReason ?? null,
              },
              dbOps: ctx
                ? {
                    reads: ctx.dbOps.reads,
                    writes: ctx.dbOps.writes,
                    queries: ctx.dbOps.queries,
                  }
                : undefined,
              socialCountsDiagnostics: {
                profileUserId: userId,
                viewerId: viewer.viewerId,
                finalFollowerCount: followersCount,
                finalFollowingCount: followingCount,
                bootstrapCacheHit,
                countSource: bootstrapCacheHit ? "bootstrap_response_cache" : "fresh_assembly",
              },
              profileHeaderRepair: {
                postCountRepairApplied,
                postCountLowerBoundUsed,
                gridVsPostsInvariantViolated,
                postsCountBeforeRepair: header.counts.posts,
                postsCountAfterRepair: postsCountEffective,
              },
            },
    };

    if (enableBootstrapCache) {
      void globalCache.set(bootstrapCacheKey, response, 5_000);
      void registerRouteCacheKey(bootstrapCacheKey, [
        `route:profile.bootstrap:${userId}`,
        `route:profile.bootstrap:${userId}:${viewer.viewerId}`,
      ]).catch(() => undefined);
    }

    return response;
  }
}
