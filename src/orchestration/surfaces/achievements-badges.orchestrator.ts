import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { AchievementsBadgesResponse } from "../../contracts/surfaces/achievements-badges.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsBadgesOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: { viewerId: string }): Promise<AchievementsBadgesResponse> {
    const cacheKey = buildCacheKey("bootstrap", ["achievements-badges-v1", input.viewerId]);
    const cached = await globalCache.get<AchievementsBadgesResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const badges = await this.service.loadBadgeRows(input.viewerId);
    const response: AchievementsBadgesResponse = {
      routeName: "achievements.badges.get",
      badges,
      degraded: false,
      fallbacks: []
    };
    await globalCache.set(cacheKey, response, 8_000);
    return response;
  }
}
