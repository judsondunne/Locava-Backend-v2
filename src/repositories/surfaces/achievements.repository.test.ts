import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AchievementsRepository,
  computeWeeklyExplorationFromPostRows,
  isStaticAchievementBadge,
  projectCanonicalBadgeRowsFromSnapshot,
  projectCanonicalStatusFromSnapshot
} from "./achievements.repository.js";
import { globalCache } from "../../cache/global-cache.js";
import * as firestoreClient from "../source-of-truth/firestore-client.js";
import type { AchievementSnapshot } from "../../contracts/entities/achievement-entities.contract.js";

function buildSnapshotWithBadges(
  badges: AchievementSnapshot["badges"],
  streak: AchievementSnapshot["streak"] = { current: 3, longest: 5, lastQualifiedAt: null }
): AchievementSnapshot {
  return {
    xp: { current: 2920, level: 18, levelProgress: 12, tier: "Master" },
    streak,
    totalPosts: 126,
    globalRank: 4,
    challenges: [],
    weeklyCapturesWeekOf: "2026-04-20",
    weeklyCaptures: [],
    badges,
    pendingLeaderboardEvent: null
  };
}

describe("achievements repository helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("computes weekly streak semantics without inflating same-day duplicates", () => {
    const exploration = computeWeeklyExplorationFromPostRows(
      [
        { createdAt: "2026-04-22T18:00:00.000Z", activities: ["hiking"] },
        { createdAt: "2026-04-22T09:00:00.000Z", activities: ["hiking"] },
        { createdAt: "2026-04-15T15:00:00.000Z", activities: ["coffee"] },
        { createdAt: "2026-04-08T12:00:00.000Z", activities: ["coffee"] },
        { createdAt: "2026-03-25T12:00:00.000Z", activities: ["running"] }
      ],
      new Date("2026-04-24T12:00:00.000Z")
    );

    expect(exploration.consecutiveWeeks).toBe(3);
    expect(exploration.longestStreak).toBe(3);
    expect(exploration.postCountByDate["2026-04-22"]).toBe(2);
    expect(exploration.topActivities[0]).toBe("Hiking");
  });

  it("treats empty post history like the old first-time fallback", () => {
    const exploration = computeWeeklyExplorationFromPostRows([], new Date("2026-04-24T12:00:00.000Z"));
    expect(exploration.consecutiveWeeks).toBe(1);
    expect(exploration.longestStreak).toBe(1);
    expect(exploration.postsThisWeek).toBe(0);
  });

  it("filters competitive badges out of the canonical static badge surface", () => {
    const snapshot = buildSnapshotWithBadges([
      {
        id: "activity_swimming",
        title: "Aquatic Ace",
        description: "Swim 10 times",
        badgeSource: "static",
        earned: true,
        claimed: false,
        rewardPoints: 250,
        progress: { current: 10, target: 10 }
      },
      {
        id: "region_nyc",
        title: "NYC Champion",
        description: "Lead New York",
        badgeSource: "competitive",
        badgeType: "region",
        earned: true,
        claimed: false,
        rewardPoints: 100,
        progress: { current: 5, target: 5 }
      }
    ]);

    const status = projectCanonicalStatusFromSnapshot(snapshot);
    const canonicalBadges = projectCanonicalBadgeRowsFromSnapshot(snapshot);

    expect(status.badgeCount).toBe(1);
    expect(status.earnedBadgeCount).toBe(1);
    expect(canonicalBadges).toHaveLength(1);
    expect(canonicalBadges[0]?.badgeId).toBe("activity_swimming");
  });

  it("classifies static and competitive badge sources explicitly", () => {
    expect(isStaticAchievementBadge({ badgeSource: "static" })).toBe(true);
    expect(isStaticAchievementBadge({ badgeSource: "competitive" })).toBe(false);
    expect(isStaticAchievementBadge({ badgeSource: undefined })).toBe(true);
  });

  it("prefers canonical post count over higher optimistic counters", async () => {
    vi.spyOn(globalCache, "get").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue({
      collection: (name: string) => {
        if (name !== "posts") throw new Error("unexpected_collection");
        return {
          where: (_field: string, _op: string, _value: string) => ({
            count: () => ({
              get: async () => ({ data: () => ({ count: 290 }) })
            })
          })
        };
      }
    } as never);

    const repository = new AchievementsRepository();
    const totalPosts = await (repository as any).getCanonicalTotalPosts(
      "viewer-1",
      { totalPosts: 290 },
      new Map([["total_posts", { value: 75 }]]),
      { numPosts: 291, postsCount: 291, postCount: 291 }
    );

    expect(totalPosts).toBe(290);
  });
});
