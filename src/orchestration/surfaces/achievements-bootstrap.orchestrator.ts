import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { AchievementsBootstrapResponse } from "../../contracts/surfaces/achievements-bootstrap.contract.js";
import type { AchievementsClaimablesResponse } from "../../contracts/surfaces/achievements-claimables.contract.js";
import type { AchievementsLeaguesResponse } from "../../contracts/surfaces/achievements-leagues.contract.js";
import type { AchievementsSnapshotResponse } from "../../contracts/surfaces/achievements-snapshot.contract.js";
import type { AchievementsStatusResponse } from "../../contracts/surfaces/achievements-status.contract.js";
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
    const writes: Array<Promise<void>> = [
      globalCache.set(cacheKey, response, 5_000),
      globalCache.set(shellCacheKey, snapshotShell, 5_000),
      globalCache.set(claimablesCacheKey, claimablesShell, 5_000),
      globalCache.set(leaguesCacheKey, leaguesResponse, 60_000)
    ];
    if (!payload.degraded) {
      writes.push(globalCache.set(statusCacheKey, statusResponse, 8_000));
    }
    await Promise.all(writes);
    return response;
  }
}
