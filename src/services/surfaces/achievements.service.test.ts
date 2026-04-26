import { describe, expect, it, vi } from "vitest";
import type { AchievementLeagueDefinition, AchievementSnapshot } from "../../contracts/entities/achievement-entities.contract.js";
import { AchievementsService } from "./achievements.service.js";

describe("AchievementsService", () => {
  it("builds bootstrap from one snapshot read plus league definitions", async () => {
    const snapshot: AchievementSnapshot = {
      xp: { current: 240, level: 3, levelProgress: 40, tier: "Bronze" },
      streak: { current: 5, longest: 9, lastQualifiedAt: "2026-04-24T10:00:00.000Z" },
      totalPosts: 249,
      globalRank: 12,
      challenges: [
        {
          id: "challenge-1",
          title: "Post more",
          counterSource: "total_posts",
          actionKey: null,
          current: 10,
          target: 10,
          completed: true,
          claimable: true,
          claimed: false
        }
      ],
      weeklyCapturesWeekOf: "2026-04-21",
      weeklyCaptures: [{ id: "weekly-1", title: "Downtown", completed: true, claimed: false, xpReward: 25 }],
      badges: [
        {
          id: "badge-1",
          title: "Explorer",
          badgeSource: "static",
          rewardPoints: 50,
          earned: true,
          claimed: false,
          progress: { current: 10, target: 10 }
        }
      ],
      pendingLeaderboardEvent: null
    };
    const leagues: AchievementLeagueDefinition[] = [
      { id: "bronze", title: "Bronze", minXP: 0, maxXP: 199, color: "#000", bgColor: "#111", order: 1, active: true },
      { id: "silver", title: "Silver", minXP: 200, maxXP: 499, color: "#222", bgColor: "#333", order: 2, active: true }
    ];
    const repository = {
      getHero: vi.fn(),
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      getLeagueDefinitions: vi.fn().mockResolvedValue(leagues)
    } as any;

    const service = new AchievementsService(repository);
    const payload = await service.loadBootstrap("viewer-1");

    expect(repository.getSnapshot).toHaveBeenCalledTimes(1);
    expect(repository.getLeagueDefinitions).toHaveBeenCalledTimes(1);
    expect(repository.getHero).not.toHaveBeenCalled();
    expect(payload.hero.totalPosts).toBe(249);
    expect(payload.hero.xp.tier).toBe("Silver");
    expect(payload.claimables.totalCount).toBe(3);
  });
});
