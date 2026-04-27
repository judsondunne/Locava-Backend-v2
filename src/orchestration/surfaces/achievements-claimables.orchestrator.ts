import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { AchievementsClaimablesResponse } from "../../contracts/surfaces/achievements-claimables.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsClaimablesOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: { viewerId: string }): Promise<AchievementsClaimablesResponse> {
    const cacheKey = buildCacheKey("bootstrap", ["achievements-claimables-v1", input.viewerId]);
    const cached = await globalCache.get<AchievementsClaimablesResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const surface = await this.service.loadClaimablesSurface(input.viewerId);
    const response: AchievementsClaimablesResponse = {
      routeName: "achievements.claimables.get",
      claimables: surface.claimables,
      degraded: surface.degraded,
      fallbacks: surface.fallbacks
    };
    await globalCache.set(cacheKey, response, response.degraded ? 5_000 : 60_000);
    return response;
  }
}
