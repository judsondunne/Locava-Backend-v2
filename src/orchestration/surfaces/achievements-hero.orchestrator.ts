import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { AchievementsBootstrapResponse } from "../../contracts/surfaces/achievements-bootstrap.contract.js";
import type { AchievementsHeroResponse } from "../../contracts/surfaces/achievements-hero.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsHeroOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: { viewerId: string }): Promise<AchievementsHeroResponse> {
    const cacheKey = buildCacheKey("bootstrap", ["achievements-hero-v1", input.viewerId]);
    const cached = await globalCache.get<AchievementsHeroResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    const bootstrapCacheKey = buildCacheKey("bootstrap", ["achievements-bootstrap-v1", input.viewerId]);
    const cachedBootstrap = await globalCache.get<AchievementsBootstrapResponse>(bootstrapCacheKey);
    if (cachedBootstrap) {
      recordCacheHit();
      const response: AchievementsHeroResponse = {
        routeName: "achievements.hero.get",
        hero: cachedBootstrap.hero,
        degraded: cachedBootstrap.degraded,
        fallbacks: cachedBootstrap.fallbacks
      };
      await globalCache.set(cacheKey, response, 60_000);
      return response;
    }
    recordCacheMiss();
    const bootstrapShell = await this.service.loadBootstrapShell(input.viewerId);
    const response: AchievementsHeroResponse = {
      routeName: "achievements.hero.get",
      hero: bootstrapShell.hero,
      degraded: bootstrapShell.degraded,
      fallbacks: bootstrapShell.fallbacks
    };
    await globalCache.set(cacheKey, response, 60_000);
    return response;
  }
}
