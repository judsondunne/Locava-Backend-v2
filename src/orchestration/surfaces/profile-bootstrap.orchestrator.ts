import type { ViewerContext } from "../../auth/viewer-context.js";
import { globalCache } from "../../cache/global-cache.js";
import { profileBootstrapCacheKey } from "../../cache/profile-follow-graph-cache.js";
import { registerRouteCacheKey } from "../../cache/route-cache-index.js";
import { buildCacheKey } from "../../cache/types.js";
import type { ProfileBootstrapResponse } from "../../contracts/surfaces/profile-bootstrap.contract.js";
import { finalizeProfileGridWireItem } from "../../dto/compact-wire-slim.js";
import { firestoreAssetsToCompactSeeds, toFeedCardDTO, toProfileHeaderDTO } from "../../dto/compact-surface-dto.js";
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
const BOOTSTRAP_GRID_PREVIEW_CAP = 6;

function compactGridPreviewItem<T extends Record<string, unknown>>(item: T): T {
  const raw = (item.rawFirestore as Record<string, unknown> | undefined) ?? undefined;
  if (!raw) {
    const { rawFirestore: _rawFirestore, ...rest } = item as T & { rawFirestore?: unknown };
    return rest as T;
  }
  const thumbUrl = typeof item.thumbUrl === "string" ? item.thumbUrl : "";
  const mediaType = item.mediaType === "video" ? "video" : "image";
  const compactCard = toFeedCardDTO({
    postId: typeof item.postId === "string" ? item.postId : "",
    rankToken: `profile_grid:${String(item.postId ?? "")}`,
    sourceRawPost: raw,
    canonicalAliasMode: "app_post_v2_only",
    author: {
      userId: typeof raw.userId === "string" ? raw.userId : "",
      handle: typeof raw.userHandle === "string" ? raw.userHandle : "",
      name: typeof raw.userName === "string" ? raw.userName : null,
      pic: typeof raw.userPic === "string" ? raw.userPic : null,
    },
    activities: Array.isArray(raw.activities) ? raw.activities.map((value) => String(value ?? "")) : [],
    address: typeof raw.address === "string" ? raw.address : null,
    assets: firestoreAssetsToCompactSeeds(Array.isArray(raw.assets) ? raw.assets : [], String(item.postId ?? ""), 1),
    compactAssetLimit: 1,
    title: typeof raw.title === "string" ? raw.title : null,
    captionPreview:
      typeof raw.caption === "string"
        ? raw.caption
        : typeof raw.text === "string"
          ? raw.text
          : typeof raw.description === "string"
            ? raw.description
            : null,
    firstAssetUrl: thumbUrl,
    media: {
      type: mediaType,
      posterUrl: thumbUrl,
      aspectRatio: typeof item.aspectRatio === "number" ? item.aspectRatio : 9 / 16,
      startupHint: mediaType === "video" ? "poster_then_preview" : "poster_only",
    },
    compactSurfaceWireMode: "profile_grid_tile",
    social: {
      likeCount: typeof raw.likesCount === "number" ? raw.likesCount : typeof raw.likeCount === "number" ? raw.likeCount : 0,
      commentCount:
        typeof raw.commentCount === "number" ? raw.commentCount : typeof raw.commentsCount === "number" ? raw.commentsCount : 0,
    },
    viewer: { liked: false, saved: false },
    createdAtMs: typeof item.updatedAtMs === "number" ? item.updatedAtMs : Date.now(),
    updatedAtMs: typeof item.updatedAtMs === "number" ? item.updatedAtMs : Date.now(),
  });
  const { rawFirestore: _rawFirestore, ...rest } = item as T & { rawFirestore?: unknown };
  return {
    ...rest,
    ...(compactCard.appPostV2 && typeof compactCard.appPostV2 === "object" ? { appPostV2: compactCard.appPostV2 } : {}),
    ...(compactCard.postContractVersion === 3 ? { postContractVersion: 3 as const } : {}),
  } as T;
}

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
    includeTabPreviews: boolean;
    debugSlowDeferredMs: number;
  }): Promise<ProfileBootstrapResponse> {
    const { viewer, userId, gridLimit, includeTabPreviews, debugSlowDeferredMs } = input;
    const localFallbacks = new Set<string>();
    const previewLimit = Math.min(gridLimit, BOOTSTRAP_GRID_PREVIEW_CAP);
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
    }).catch((error) => {
      if (error instanceof Error && error.message === "profile_header_not_found") {
        throw error;
      }
      recordFallback("profile_header_unavailable");
      localFallbacks.add("profile_header_unavailable");
      recordSurfaceTimings({ profile_bootstrap_header_ms: performance.now() - headerStartedAt });
      return {
        userId,
        handle: `user_${userId.slice(0, 8)}`,
        name: "Locava User",
        profilePic: null,
        bio: null,
        counts: { posts: 0, followers: 0, following: 0 },
        profilePicSource: null,
        profilePicSmallPath: null,
        profilePicLargePath: null,
        updatedAtMs: null,
        profileVersion: null,
      };
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
      buildCacheKey("list", ["profile-grid-preview-v5", userId, previewLimit]),
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
    const collectionsPromise = includeTabPreviews
      ? this.getCachedOrLoad(
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
          })
      : Promise.resolve().then(() => {
          recordSurfaceTimings({ profile_bootstrap_collections_preview_ms: 0 });
          return {
            items: [],
            nextCursor: null,
            emptyReason: "profile_collections_deferred",
          };
        });

    const achievementsStartedAt = performance.now();
    const achievementsPromise = includeTabPreviews
      ? this.getCachedOrLoad(
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
          })
      : Promise.resolve().then(() => {
          recordSurfaceTimings({ profile_bootstrap_achievements_preview_ms: 0 });
          return {
            items: [],
            nextCursor: null,
            emptyReason: "profile_achievements_deferred",
          };
        });

    const [headerRaw, relationshipRaw, gridPreviewLoaded, collectionsPreview, achievementsPreview, profileBadgeSummary] =
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
        (includeTabPreviews ? this.service.loadBadgeSummary(userId, debugSlowDeferredMs) : Promise.resolve(null)).catch(() => null),
      ]);

    const gridPreview = {
      ...gridPreviewLoaded,
      items: gridPreviewLoaded.items.map((item) =>
        finalizeProfileGridWireItem(compactGridPreviewItem(item as Record<string, unknown>) as Record<string, unknown>)
      ) as typeof gridPreviewLoaded.items
    };

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
        prefetchHints: includeTabPreviews
          ? ["profile:grid:next", "profile:collections:next", "profile:achievements:next"]
          : ["profile:grid:next"],
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
