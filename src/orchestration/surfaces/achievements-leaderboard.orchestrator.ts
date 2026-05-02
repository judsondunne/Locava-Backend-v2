import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { AchievementLeaderboardScope } from "../../contracts/entities/achievement-entities.contract.js";
import type { AchievementsLeaderboardResponse } from "../../contracts/surfaces/achievements-leaderboard.contract.js";
import { scheduleBackgroundWork } from "../../lib/background-work.js";
import {
  recordCacheHit,
  recordCacheMiss,
  recordFallback,
  setOrchestrationMetadata
} from "../../observability/request-context.js";
import { isStartupGracePeriod } from "../../runtime/server-boot.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

const SOFT_TTL_MS = 120_000;
const HARD_TTL_MS = 600_000;

type LeaderboardCacheEnvelope = { body: AchievementsLeaderboardResponse; storedAtMs: number };

export class AchievementsLeaderboardOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: {
    viewerId: string;
    scope: AchievementLeaderboardScope;
    leagueId?: string | null;
  }): Promise<AchievementsLeaderboardResponse> {
    const leagueKey = input.leagueId?.trim() ?? "";
    const cacheKey = buildCacheKey("bootstrap", ["achievements-lb-v1", input.viewerId, input.scope, leagueKey]);

    if (input.scope === "xp_friends" && isStartupGracePeriod()) {
      const cachedFriends = await globalCache.get<LeaderboardCacheEnvelope>(cacheKey);
      if (cachedFriends && Date.now() - cachedFriends.storedAtMs < HARD_TTL_MS) {
        recordCacheHit();
        const age = Date.now() - cachedFriends.storedAtMs;
        if (age >= SOFT_TTL_MS) {
          setOrchestrationMetadata({ servedStale: true, optionalWorkSkipped: true });
          return {
            ...cachedFriends.body,
            servedStale: true,
            fallbacks: [...cachedFriends.body.fallbacks, "served_stale_startup_grace"]
          };
        }
        return cachedFriends.body;
      }
      recordCacheMiss();
      recordFallback("achievements_lb_xp_friends_skipped_cold_startup_grace");
      setOrchestrationMetadata({ optionalWorkSkipped: true });
      return {
        routeName: "achievements.leaderboard.get",
        scope: input.scope,
        leaderboard: [],
        viewerRank: null,
        cityName: null,
        groupName: null,
        leagueId: null,
        leagueName: null,
        leagueIconUrl: null,
        leagueColor: null,
        leagueBgColor: null,
        degraded: true,
        fallbacks: ["skipped_cold_during_startup_grace"],
        optionalWorkSkipped: true
      };
    }

    const wrapped = await globalCache.get<LeaderboardCacheEnvelope>(cacheKey);
    if (wrapped && Date.now() - wrapped.storedAtMs < HARD_TTL_MS) {
      recordCacheHit();
      const age = Date.now() - wrapped.storedAtMs;
      if (age < SOFT_TTL_MS) {
        return wrapped.body;
      }
      setOrchestrationMetadata({ servedStale: true });
      scheduleBackgroundWork(
        async () => {
          try {
            const model = await this.service.loadLeaderboardRead(input.viewerId, input.scope, input.leagueId);
            const fresh: AchievementsLeaderboardResponse = {
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
            await globalCache.set(cacheKey, { body: fresh, storedAtMs: Date.now() }, HARD_TTL_MS);
          } catch {
            /* best-effort refresh */
          }
        },
        0,
        { label: "achievements-lb-swr" }
      );
      return {
        ...wrapped.body,
        servedStale: true,
        fallbacks: wrapped.body.fallbacks.includes("served_stale_cache")
          ? wrapped.body.fallbacks
          : [...wrapped.body.fallbacks, "served_stale_cache"]
      };
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
    await globalCache.set(cacheKey, { body: response, storedAtMs: Date.now() }, HARD_TTL_MS);
    return response;
  }
}
