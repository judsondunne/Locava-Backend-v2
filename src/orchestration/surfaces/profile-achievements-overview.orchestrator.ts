import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { ProfileAchievementsOverviewResponse } from "../../contracts/surfaces/profile-achievements-overview.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class ProfileAchievementsOverviewOrchestrator {
  constructor(private readonly achievementsService: AchievementsService) {}

  async run(input: { viewerId: string; profileUserId: string }): Promise<ProfileAchievementsOverviewResponse> {
    const { viewerId, profileUserId } = input;
    const cacheKey = buildCacheKey("bootstrap", [
      "profile-achievements-overview-v1",
      viewerId,
      profileUserId
    ]);
    const cached = await globalCache.get<ProfileAchievementsOverviewResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const snapshot = await this.achievementsService.loadPublicProfileSnapshot(profileUserId);
    const response: ProfileAchievementsOverviewResponse = {
      routeName: "profile.achievements_overview.get",
      profileUserId,
      snapshot,
      degraded: false,
      fallbacks: []
    };
    void globalCache.set(cacheKey, response, 8_000);
    return response;
  }
}
