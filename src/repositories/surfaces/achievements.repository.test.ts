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
import { type RequestContext, getRequestContext, runWithRequestContext } from "../../observability/request-context.js";

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

function withRequestContext<T>(fn: () => Promise<T>): Promise<T> {
  const ctx: RequestContext = {
    requestId: "test-request",
    route: "/test",
    method: "GET",
    startNs: 0n,
    payloadBytes: 0,
    dbOps: { reads: 0, writes: 0, queries: 0 },
    cache: { hits: 0, misses: 0 },
    dedupe: { hits: 0, misses: 0 },
    concurrency: { waits: 0 },
    entityCache: { hits: 0, misses: 0 },
    entityConstruction: { total: 0, types: {} },
    idempotency: { hits: 0, misses: 0 },
    invalidation: { keys: 0, entityKeys: 0, routeKeys: 0, types: {} },
    fallbacks: [],
    timeouts: [],
    surfaceTimings: {}
  };
  return runWithRequestContext(ctx, fn);
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
        if (name === "posts") {
          return {
            where: (_field: string, _op: string, _value: string) => ({
              count: () => ({
                get: async () => ({ data: () => ({ count: 290 }) })
              })
            })
          };
        }
        if (name === "users") {
          return {
            doc: () => ({
              set: async () => undefined
            })
          };
        }
        throw new Error("unexpected_collection");
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

  it("trusts fresh verified embedded post counts before hitting the aggregate query", async () => {
    const countSpy = vi.fn();
    vi.spyOn(globalCache, "get").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue({
      collection: (name: string) => {
        if (name === "posts") {
          return {
            where: () => ({
              count: () => ({
                get: countSpy
              })
            })
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      }
    } as never);

    const repository = new AchievementsRepository();
    const totalPosts = await (repository as any).getCanonicalTotalPosts(
      "viewer-1",
      { totalPosts: 14 },
      undefined,
      {
        numPosts: 17,
        postsCount: 17,
        postCount: 17,
        postCountVerifiedValue: 17,
        postCountVerifiedAtMs: Date.now()
      }
    );

    expect(totalPosts).toBe(17);
    expect(countSpy).not.toHaveBeenCalled();
  });

  it("builds bootstrap shell from canonical post count instead of stale state totals", async () => {
    vi.spyOn(globalCache, "get").mockImplementation(async (key: string) => {
      if (key.includes("achievements-state-v2")) return undefined;
      if (key.includes("achievements-leagues-v2")) return [];
      if (key.includes("achievements-badge-definitions-v2")) return [];
      if (key.includes("achievements-badges-v2")) return [];
      if (key.includes("user:viewer-1:postCount:v2")) return undefined;
      return undefined;
    });
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue({
      collection: (name: string) => {
        if (name === "users") {
          return {
            doc: (docId: string) => ({
              get: async () => ({
                exists: true,
                data: () => ({
                  numPosts: 461,
                  postsCount: 461,
                  postCount: 461,
                  postCountVerifiedValue: 461,
                  postCountVerifiedAtMs: Date.now()
                })
              }),
              collection: (child: string) => {
                if (child !== "achievements") throw new Error(`unexpected_user_child:${child}`);
                return {
                  doc: (stateId: string) => {
                    expect(docId).toBe("viewer-1");
                    expect(stateId).toBe("state");
                    return {
                      get: async () => ({
                        exists: true,
                        data: () => ({
                          totalPosts: 462,
                          challengeCounters: {},
                          claimedChallenges: {},
                          weeklyCaptures: {},
                          xp: { current: 2570 }
                        })
                      })
                    };
                  }
                };
              },
              set: async () => undefined
            })
          };
        }
        if (name === "posts") {
          return {
            where: (_field: string, _op: string, _value: string) => ({
              count: () => ({
                get: async () => ({ data: () => ({ count: 461 }) })
              })
            })
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      }
    } as never);

    const repository = new AchievementsRepository();
    const shell = await repository.getBootstrapShell("viewer-1");

    expect(shell.hero.totalPosts).toBe(461);
    expect(shell.snapshot.totalPosts).toBe(461);
  });

  it("stages bootstrap leagues instead of blocking on a cold league snapshot read", async () => {
    vi.spyOn(globalCache, "get").mockImplementation(async (key: string) => {
      if (key.includes("achievements-state-v2")) return undefined;
      if (key.includes("achievements-leagues-v2")) return undefined;
      if (key.includes("achievements-badge-definitions-v2")) return [];
      if (key.includes("achievements-badges-v2")) return [];
      if (key.includes("user:viewer-1:postCount:v2")) return undefined;
      return undefined;
    });
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "del").mockResolvedValue(undefined);
    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue({
      collection: (name: string) => {
        if (name === "users") {
          return {
            doc: () => ({
              get: async () => ({
                exists: true,
                data: () => ({
                  numPosts: 12,
                  postsCount: 12,
                  postCount: 12,
                  postCountVerifiedValue: 12,
                  postCountVerifiedAtMs: Date.now()
                })
              }),
              collection: (child: string) => {
                if (child !== "achievements") throw new Error(`unexpected_user_child:${child}`);
                return {
                  doc: () => ({
                    get: async () => ({
                      exists: true,
                      data: () => ({
                        totalPosts: 12,
                        challengeCounters: {},
                        claimedChallenges: {},
                        weeklyCaptures: {},
                        xp: { current: 2570, tier: "Explorer" }
                      })
                    })
                  })
                };
              }
            })
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      }
    } as never);

    const repository = new AchievementsRepository();
    const shell = await repository.getBootstrapShell("viewer-1");

    expect(shell.leagues).toEqual([]);
    expect(shell.degraded).toBe(true);
    expect(shell.fallbacks).toContain("achievement_leagues_staged");
  });

  it("returns screen-opened success without waiting on cache refresh work", async () => {
    vi.spyOn(globalCache, "get").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "del").mockResolvedValue(undefined);
    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue({
      collection: (name: string) => {
        if (name !== "users") throw new Error(`unexpected_collection:${name}`);
        return {
          doc: () => ({
            collection: (child: string) => {
              if (child !== "achievements") throw new Error(`unexpected_child:${child}`);
              return {
                doc: () => ({
                  update: async () => undefined,
                  set: async () => undefined
                })
              };
            }
          })
        };
      }
    } as never);

    const repository = new AchievementsRepository();
    const result = await Promise.race([
      repository.recordScreenOpened("viewer-1"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("record_screen_opened_timed_out")), 200))
    ]);

    expect(result.recordedAtMs).toBeGreaterThan(0);
  });

  it("skips a redundant screen-opened write when a fresh opened timestamp is already cached", async () => {
    const updateSpy = vi.fn();
    const setSpy = vi.fn();
    vi.spyOn(globalCache, "get").mockImplementation(async (key: string) => {
      if (key.includes("achievements-state-v2")) {
        return { achievementsScreenOpenedAt: new Date(Date.now() - 5_000).toISOString() };
      }
      return undefined;
    });
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "del").mockResolvedValue(undefined);
    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue({
      collection: (name: string) => {
        if (name !== "users") throw new Error(`unexpected_collection:${name}`);
        return {
          doc: () => ({
            collection: (child: string) => {
              if (child !== "achievements") throw new Error(`unexpected_child:${child}`);
              return {
                doc: () => ({
                  update: updateSpy,
                  set: setSpy
                })
              };
            }
          })
        };
      }
    } as never);

    const repository = new AchievementsRepository();
    const result = await repository.recordScreenOpened("viewer-1");

    expect(result.recordedAtMs).toBeGreaterThan(0);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("updates cached screen-opened state immediately and defers the firestore write", async () => {
    const updateSpy = vi.fn();
    const setSpy = vi.fn();
    const cacheSetSpy = vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "get").mockImplementation(async (key: string) => {
      if (key.includes("achievements-state-v2")) {
        return { xp: { current: 2500 }, updatedAt: new Date(Date.now() - 120_000).toISOString() };
      }
      return undefined;
    });
    vi.spyOn(globalCache, "del").mockResolvedValue(undefined);
    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue({
      collection: (name: string) => {
        if (name !== "users") throw new Error(`unexpected_collection:${name}`);
        return {
          doc: () => ({
            collection: (child: string) => {
              if (child !== "achievements") throw new Error(`unexpected_child:${child}`);
              return {
                doc: () => ({
                  update: updateSpy,
                  set: setSpy
                })
              };
            }
          })
        };
      }
    } as never);

    const repository = new AchievementsRepository();
    const result = await Promise.race([
      repository.recordScreenOpened("viewer-1"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("record_screen_opened_cached_timed_out")), 200))
    ]);

    expect(result.recordedAtMs).toBeGreaterThan(0);
    expect(cacheSetSpy).toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("serves league definitions from one compact cache-doc read", async () => {
    vi.spyOn(globalCache, "get").mockImplementation(async () => undefined);
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue({
      collection: (name: string) => {
        if (name !== "cache") {
          throw new Error(`unexpected_collection:${name}`);
        }
        return {
          doc: (docId: string) => {
            expect(docId).toBe("achievements_leagues_v2");
            return {
              get: async () => ({
                exists: true,
                data: () => ({
                  leagues: [
                    {
                      id: "explorer",
                      title: "Explorer",
                      minXP: 500,
                      maxXP: 1999,
                      color: "#0f766e",
                      bgColor: "#ecfeff",
                      order: 2,
                      active: true
                    }
                  ]
                })
              })
            };
          }
        };
      }
    } as never);

    const repository = new AchievementsRepository();
    await withRequestContext(async () => {
      const leagues = await repository.getLeagueDefinitions();
      expect(leagues).toHaveLength(1);
      expect(leagues[0]?.id).toBe("explorer");
      const ctx = getRequestContext();
      expect(ctx?.dbOps.queries).toBe(1);
      expect(ctx?.dbOps.reads).toBe(1);
    });
  });

  it("serves claimables from bootstrap shell instead of cold recompute", async () => {
    const repository = new AchievementsRepository();
    const surfaceSpy = vi.spyOn(repository, "getClaimablesSurface").mockResolvedValue({
      claimables: {
        totalCount: 1,
        weeklyCaptures: [],
        badges: [{ id: "activity_swimming", title: "Aquatic Ace", source: "static", rewardPoints: 250 }],
        challenges: []
      },
      degraded: true,
      fallbacks: ["achievement_badge_definitions_staged"]
    });

    const claimables = await repository.getClaimables("viewer-1");

    expect(claimables.totalCount).toBe(1);
    expect(claimables.badges[0]?.id).toBe("activity_swimming");
    expect(surfaceSpy).toHaveBeenCalledTimes(1);
  });
});
