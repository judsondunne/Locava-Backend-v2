import { globalCache } from "../../cache/global-cache.js";
import { setRouteCacheEntry } from "../../cache/route-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { UsersLastActiveResponse } from "../../contracts/surfaces/users-last-active.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { UserActivityService } from "../../services/surfaces/user-activity.service.js";

export class UsersLastActiveOrchestrator {
  constructor(private readonly service: UserActivityService) {}

  async run(input: { viewerId: string; userId: string }): Promise<UsersLastActiveResponse> {
    const cacheKey = buildCacheKey("entity", ["users-last-active-v1", input.viewerId, input.userId]);
    const cached = await globalCache.get<UsersLastActiveResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    const lastActiveMs = await this.service.getLastActiveMs({ userId: input.userId });
    const response: UsersLastActiveResponse = {
      routeName: "users.lastactive.get",
      requestKey: `${input.viewerId}:${input.userId}`,
      userId: input.userId,
      lastActiveMs
    };

    await setRouteCacheEntry(cacheKey, response, 10_000, [`route:users.lastactive:${input.viewerId}`, `entity:user:${input.userId}`]);
    return response;
  }
}

