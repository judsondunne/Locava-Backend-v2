import { describe, expect, it } from "vitest";
import { AchievementDeltaSchema } from "./achievement-entities.contract.js";

describe("achievement entities contract", () => {
  it("accepts a deterministic league pass celebration payload", () => {
    const parsed = AchievementDeltaSchema.parse({
      xpGained: 50,
      newTotalXP: 450,
      leveledUp: false,
      progressBumps: [],
      weeklyCapture: null,
      newlyUnlockedBadges: [],
      uiEvents: ["XP_TOAST"],
      leaguePassCelebration: {
        shouldShow: true,
        leaderboardKey: "xp_global",
        previousRank: 22,
        newRank: 19,
        peoplePassed: 3,
        celebrationId: "lgpass_abc123",
        previousLeague: "bronze",
        newLeague: "silver",
      },
    });
    expect(parsed.leaguePassCelebration?.shouldShow).toBe(true);
    expect(parsed.leaguePassCelebration?.peoplePassed).toBe(3);
    expect(parsed.leaguePassCelebration?.celebrationId).toBe("lgpass_abc123");
  });
});
