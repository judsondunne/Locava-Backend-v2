import { registerRouteCacheKey } from "../../cache/route-cache-index.js";
import { buildCacheKey } from "../../cache/types.js";
import { globalCache } from "../../cache/global-cache.js";
import type { ProfileRelationshipResponse } from "../../contracts/surfaces/profile-relationship.contract.js";
import {
  getRequestContext,
  recordCacheHit,
  recordCacheMiss,
} from "../../observability/request-context.js";
import type { ProfileService } from "../../services/surfaces/profile.service.js";

export class ProfileRelationshipOrchestrator {
  constructor(private readonly service: ProfileService) {}

  async run(input: {
    viewerId: string;
    userId: string;
  }): Promise<ProfileRelationshipResponse> {
    const { viewerId, userId } = input;
    const cacheKey = buildCacheKey("entity", ["profile-relationship-v2", viewerId, userId]);
    const cached = await globalCache.get<ProfileRelationshipResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    const [relationship, header] = await Promise.all([
      this.service.loadRelationship(viewerId, userId),
      this.service.loadHeader(userId),
    ]);
    const ctx = getRequestContext();
    const response: ProfileRelationshipResponse = {
      routeName: "profile.relationship.get",
      profileUserId: userId,
      relationship,
      counts: {
        posts: header.counts.posts,
        followers: header.counts.followers,
        following: header.counts.following,
      },
      debug:
        process.env.NODE_ENV === "production"
          ? undefined
          : {
              timingsMs: {},
              counts: {
                grid: 0,
                collections: 0,
                achievements: 0,
              },
              profilePicSource: header.profilePicSource ?? null,
              dbOps: ctx
                ? {
                    reads: ctx.dbOps.reads,
                    writes: ctx.dbOps.writes,
                    queries: ctx.dbOps.queries,
                  }
                : undefined,
            },
    };
    void globalCache.set(cacheKey, response, 10_000).catch(() => undefined);
    void registerRouteCacheKey(cacheKey, [
      `route:profile.relationship:${userId}`,
      `route:profile.relationship:${userId}:${viewerId}`,
      `route:profile.bootstrap:${userId}`,
    ]).catch(() => undefined);
    return response;
  }
}
