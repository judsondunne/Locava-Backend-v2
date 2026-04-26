import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { AchievementLeaderboardScope } from "../../contracts/entities/achievement-entities.contract.js";
import type { AchievementsLeaderboardResponse } from "../../contracts/surfaces/achievements-leaderboard.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsLeaderboardOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: {
    viewerId: string;
    scope: AchievementLeaderboardScope;
    leagueId?: string | null;
  }): Promise<AchievementsLeaderboardResponse> {
    const leagueKey = input.leagueId?.trim() ?? "";
    const cacheKey = buildCacheKey("bootstrap", ["achievements-lb-v1", input.viewerId, input.scope, leagueKey]);
    const cached = await globalCache.get<AchievementsLeaderboardResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const model = await this.service.loadLeaderboardRead(input.viewerId, input.scope, input.leagueId);
    const response: AchievementsLeaderboardResponse = {
      routeName: "achievements.leaderboard.get",
      scope: model.scope,
      leaderboard: model.entries,
      viewerRank: model.viewerRank,
      cityName: model.cityName,
      groupName: model.groupName,
      leagueId: model.leagueId,
      leagueName: model.leagueName,
      leagueIconUrl: model.leagueIconUrl,
      leagueColor: model.leagueColor,
      leagueBgColor: model.leagueBgColor,
      degraded: false,
      fallbacks: []
    };
    await globalCache.set(cacheKey, response, 12_000);
    return response;
  }
}
