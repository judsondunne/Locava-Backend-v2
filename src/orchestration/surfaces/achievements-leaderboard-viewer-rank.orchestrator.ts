import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { AchievementLeaderboardScope } from "../../contracts/entities/achievement-entities.contract.js";
import type { AchievementsLeaderboardViewerRankResponse } from "../../contracts/surfaces/achievements-leaderboard-viewer-rank.contract.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsLeaderboardViewerRankOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: {
    viewerId: string;
    leaderboardKey: AchievementLeaderboardScope;
    leagueId?: string | null;
  }): Promise<AchievementsLeaderboardViewerRankResponse> {
    const cacheKey = buildCacheKey("bootstrap", [
      "achievements-lb-viewer-rank-v1",
      input.viewerId,
      input.leaderboardKey,
      input.leagueId?.trim() ?? ""
    ]);
    const cached = await globalCache.get<AchievementsLeaderboardViewerRankResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    const leaderboard = await this.service.loadLeaderboardRead(input.viewerId, input.leaderboardKey, input.leagueId);
    const response: AchievementsLeaderboardViewerRankResponse = {
      routeName: "achievements.leaderboardviewerrank.get",
      leaderboardKey: input.leaderboardKey,
      viewerRank: leaderboard.viewerRank,
      leagueId: leaderboard.leagueId,
      leagueName: leaderboard.leagueName,
      degraded: false,
      fallbacks: []
    };
    await globalCache.set(cacheKey, response, 5_000);
    return response;
  }
}
