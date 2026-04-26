import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { AchievementsPendingDeltaResponse } from "../../contracts/surfaces/achievements-pending-delta.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

const POLL_AFTER_MS = 4_000;
const BACKOFF_MS = 6_000;

export class AchievementsPendingDeltaOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: { viewerId: string }): Promise<AchievementsPendingDeltaResponse> {
    const cacheKey = buildCacheKey("bootstrap", ["achievements-pending-delta-v1", input.viewerId]);
    const cached = await globalCache.get<AchievementsPendingDeltaResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    const delta = await this.service.consumePendingDelta(input.viewerId);
    const response: AchievementsPendingDeltaResponse = {
      routeName: "achievements.pendingdelta.get",
      delta,
      pollAfterMs: POLL_AFTER_MS,
      serverSuggestedBackoffMs: BACKOFF_MS,
      degraded: false,
      fallbacks: []
    };
    // Tiny no-delta cache window to collapse frequent polling bursts.
    await globalCache.set(cacheKey, response, delta ? 600 : 900);
    return response;
  }
}
