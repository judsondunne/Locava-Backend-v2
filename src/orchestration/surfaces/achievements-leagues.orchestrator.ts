import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { AchievementsLeaguesResponse } from "../../contracts/surfaces/achievements-leagues.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsLeaguesOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(): Promise<AchievementsLeaguesResponse> {
    const cacheKey = buildCacheKey("bootstrap", ["achievements-leagues-v1"]);
    const cached = await globalCache.get<AchievementsLeaguesResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const leagues = await this.service.loadLeagues();
    const response: AchievementsLeaguesResponse = {
      routeName: "achievements.leagues.get",
      leagues,
      degraded: false,
      fallbacks: []
    };
    await globalCache.set(cacheKey, response, 60_000);
    return response;
  }
}
