import { afterEach, describe, expect, it, vi } from "vitest";
import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import { AchievementsLeaderboardOrchestrator } from "./achievements-leaderboard.orchestrator.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

describe("AchievementsLeaderboardOrchestrator startup grace (xp_friends)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not call service.loadLeaderboardRead on cold miss during grace", async () => {
    vi.stubEnv("BACKENDV2_TEST_STARTUP_GRACE", "1");
    const loadLeaderboardRead = vi.fn();
    const service = { loadLeaderboardRead } as unknown as AchievementsService;
    const orch = new AchievementsLeaderboardOrchestrator(service);
    const out = await orch.run({ viewerId: "u1", scope: "xp_friends" });
    expect(loadLeaderboardRead).not.toHaveBeenCalled();
    expect(out.degraded).toBe(true);
    expect(out.leaderboard).toEqual([]);
    expect(out.fallbacks).toContain("skipped_cold_during_startup_grace");
  });

  it("serves cached xp_friends during grace without hitting service", async () => {
    vi.stubEnv("BACKENDV2_TEST_STARTUP_GRACE", "1");
    const loadLeaderboardRead = vi.fn();
    const service = { loadLeaderboardRead } as unknown as AchievementsService;
    const orch = new AchievementsLeaderboardOrchestrator(service);
    const cacheKey = buildCacheKey("bootstrap", ["achievements-lb-v1", "u2", "xp_friends", ""]);
    await globalCache.set(
      cacheKey,
      {
        body: {
          routeName: "achievements.leaderboard.get",
          scope: "xp_friends",
          leaderboard: [{ rank: 1, userId: "x", userName: "X", profilePic: null, score: 10 }],
          viewerRank: 2,
          cityName: null,
          groupName: null,
          leagueId: null,
          leagueName: null,
          leagueIconUrl: null,
          leagueColor: null,
          leagueBgColor: null,
          degraded: false,
          fallbacks: []
        },
        storedAtMs: Date.now()
      },
      600_000
    );
    const out = await orch.run({ viewerId: "u2", scope: "xp_friends" });
    expect(loadLeaderboardRead).not.toHaveBeenCalled();
    expect(out.leaderboard.length).toBe(1);
  });
});
