import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { AchievementsBootstrapResponse } from "../../contracts/surfaces/achievements-bootstrap.contract.js";
import type { AchievementsClaimablesResponse } from "../../contracts/surfaces/achievements-claimables.contract.js";
import type { AchievementsLeaguesResponse } from "../../contracts/surfaces/achievements-leagues.contract.js";
import type { AchievementsSnapshotResponse } from "../../contracts/surfaces/achievements-snapshot.contract.js";
import type { AchievementsStatusResponse } from "../../contracts/surfaces/achievements-status.contract.js";
import { scheduleBackgroundWork } from "../../lib/background-work.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import { projectCanonicalStatusFromSnapshot } from "../../repositories/surfaces/achievements.repository.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsBootstrapOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: { viewerId: string }): Promise<AchievementsBootstrapResponse> {
    const cacheKey = buildCacheKey("bootstrap", ["achievements-bootstrap-v1", input.viewerId]);
    const cached = await globalCache.get<AchievementsBootstrapResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const payload = await this.service.loadBootstrapShell(input.viewerId);
    const response: AchievementsBootstrapResponse = {
      routeName: "achievements.bootstrap.get",
      hero: payload.hero,
      snapshot: payload.snapshot,
      leagues: payload.leagues,
      claimables: payload.claimables,
      degraded: payload.degraded,
      fallbacks: payload.fallbacks
    };
    const snapshotShell: AchievementsSnapshotResponse = {
      routeName: "achievements.snapshot.get",
      snapshot: payload.snapshot,
      degraded: payload.degraded,
      fallbacks: payload.fallbacks
    };
    const claimablesShell: AchievementsClaimablesResponse = {
      routeName: "achievements.claimables.get",
      claimables: payload.claimables,
      degraded: payload.degraded,
      fallbacks: payload.fallbacks
    };
    const leaguesResponse: AchievementsLeaguesResponse = {
      routeName: "achievements.leagues.get",
      leagues: payload.leagues,
      degraded: payload.degraded,
      fallbacks: payload.fallbacks
    };
    const statusResponse: AchievementsStatusResponse = {
      routeName: "achievements.status.get",
      status: projectCanonicalStatusFromSnapshot(payload.snapshot),
      degraded: payload.degraded,
      fallbacks: payload.fallbacks
    };
    const shellCacheKey = buildCacheKey("bootstrap", ["achievements-snapshot-shell-v1", input.viewerId]);
    const claimablesCacheKey = buildCacheKey("bootstrap", ["achievements-claimables-v1", input.viewerId]);
    const leaguesCacheKey = buildCacheKey("bootstrap", ["achievements-leagues-v1"]);
    const statusCacheKey = buildCacheKey("bootstrap", ["achievements-status-v1", input.viewerId]);
    const bootstrapTtlMs = payload.degraded ? 15_000 : 120_000;
    const leaguesTtlMs = payload.degraded ? 5_000 : 10 * 60_000;
    await Promise.all([
      globalCache.set(cacheKey, response, bootstrapTtlMs),
      globalCache.set(shellCacheKey, snapshotShell, bootstrapTtlMs),
      globalCache.set(statusCacheKey, statusResponse, bootstrapTtlMs),
      globalCache.set(claimablesCacheKey, claimablesShell, bootstrapTtlMs),
      globalCache.set(leaguesCacheKey, leaguesResponse, leaguesTtlMs)
    ]);
    scheduleBackgroundWork(async () => {
      if (!payload.degraded) {
        await globalCache.set(statusCacheKey, statusResponse, bootstrapTtlMs);
      }
    });
    return response;
  }
}
