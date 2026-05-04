import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { AchievementsSnapshotResponse } from "../../contracts/surfaces/achievements-snapshot.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsSnapshotOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: { viewerId: string }): Promise<AchievementsSnapshotResponse> {
    const cacheKey = buildCacheKey("bootstrap", ["achievements-snapshot-v1", input.viewerId]);
    const cached = await globalCache.get<AchievementsSnapshotResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    const shellCacheKey = buildCacheKey("bootstrap", ["achievements-snapshot-shell-v1", input.viewerId]);
    const cachedShell = await globalCache.get<AchievementsSnapshotResponse>(shellCacheKey);
    if (cachedShell) {
      recordCacheHit();
      return cachedShell;
    }
    recordCacheMiss();
    const bootstrapShell = await this.service.loadBootstrapShell(input.viewerId);
    const response: AchievementsSnapshotResponse = {
      routeName: "achievements.snapshot.get",
      snapshot: bootstrapShell.snapshot,
      degraded: bootstrapShell.degraded,
      fallbacks: bootstrapShell.fallbacks
    };
    await globalCache.set(cacheKey, response, 60_000);
    return response;
  }
}
