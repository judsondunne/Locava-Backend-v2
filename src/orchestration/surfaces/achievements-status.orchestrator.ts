import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { AchievementsBootstrapResponse } from "../../contracts/surfaces/achievements-bootstrap.contract.js";
import type { AchievementsSnapshotResponse } from "../../contracts/surfaces/achievements-snapshot.contract.js";
import type { AchievementsStatusResponse } from "../../contracts/surfaces/achievements-status.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import { projectCanonicalStatusFromSnapshot } from "../../repositories/surfaces/achievements.repository.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsStatusOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: { viewerId: string }): Promise<AchievementsStatusResponse> {
    const cacheKey = buildCacheKey("bootstrap", ["achievements-status-v1", input.viewerId]);
    const cached = await globalCache.get<AchievementsStatusResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    const bootstrapCacheKey = buildCacheKey("bootstrap", ["achievements-bootstrap-v1", input.viewerId]);
    const cachedBootstrap = await globalCache.get<AchievementsBootstrapResponse>(bootstrapCacheKey);
    if (cachedBootstrap) {
      recordCacheHit();
      const response: AchievementsStatusResponse = {
        routeName: "achievements.status.get",
        status: projectCanonicalStatusFromSnapshot(cachedBootstrap.snapshot),
        degraded: cachedBootstrap.degraded,
        fallbacks: cachedBootstrap.fallbacks
      };
      void globalCache.set(cacheKey, response, 8_000);
      return response;
    }

    const snapshotCacheKey = buildCacheKey("bootstrap", ["achievements-snapshot-v1", input.viewerId]);
    const cachedSnapshot = await globalCache.get<AchievementsSnapshotResponse>(snapshotCacheKey);
    if (cachedSnapshot) {
      recordCacheHit();
      const response: AchievementsStatusResponse = {
        routeName: "achievements.status.get",
        status: projectCanonicalStatusFromSnapshot(cachedSnapshot.snapshot),
        degraded: cachedSnapshot.degraded,
        fallbacks: cachedSnapshot.fallbacks
      };
      void globalCache.set(cacheKey, response, 8_000);
      return response;
    }
    const snapshotShellCacheKey = buildCacheKey("bootstrap", ["achievements-snapshot-shell-v1", input.viewerId]);
    const cachedSnapshotShell = await globalCache.get<AchievementsSnapshotResponse>(snapshotShellCacheKey);
    if (cachedSnapshotShell) {
      recordCacheHit();
      const response: AchievementsStatusResponse = {
        routeName: "achievements.status.get",
        status: projectCanonicalStatusFromSnapshot(cachedSnapshotShell.snapshot),
        degraded: cachedSnapshotShell.degraded,
        fallbacks: cachedSnapshotShell.fallbacks
      };
      void globalCache.set(cacheKey, response, 8_000);
      return response;
    }

    recordCacheMiss();
    const bootstrapShell = await this.service.loadBootstrapShell(input.viewerId);
    const response: AchievementsStatusResponse = {
      routeName: "achievements.status.get",
      status: projectCanonicalStatusFromSnapshot(bootstrapShell.snapshot),
      degraded: bootstrapShell.degraded,
      fallbacks: bootstrapShell.fallbacks
    };
    void globalCache.set(cacheKey, response, 8_000);
    return response;
  }
}
