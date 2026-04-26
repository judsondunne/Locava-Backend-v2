import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app/createApp.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";

const mockHero = {
  xp: { current: 2570, level: 17, levelProgress: 28, tier: "Explorer" },
  streak: { current: 18, longest: 18, lastQualifiedAt: "2026-04-24T18:40:17.124Z" },
  totalPosts: 126,
  globalRank: 4
};

const mockSnapshot = {
  xp: { current: 2570, level: 17, levelProgress: 28, tier: "Explorer" },
  streak: { current: 18, longest: 18, lastQualifiedAt: "2026-04-24T18:40:17.124Z" },
  totalPosts: 126,
  globalRank: 4,
  challenges: [
    {
      id: "challenge-post-10",
      title: "Post 10 times",
      counterSource: "total_posts" as const,
      actionKey: null,
      current: 10,
      target: 10,
      completed: true,
      claimable: true,
      claimed: false
    }
  ],
  weeklyCapturesWeekOf: "2026-W17",
  weeklyCaptures: [
    {
      id: "capture-1",
      title: "Capture 1",
      completed: true,
      claimed: false,
      xpReward: 100
    }
  ],
  badges: [
    {
      id: "activity_swimming",
      title: "Aquatic Ace",
      description: "Post 10 times with the Swimming activity.",
      emoji: "🏊",
      image: "🏊",
      iconUrl: "🏊",
      statKey: "activity_swimming",
      targetNumber: 10,
      rewardPoints: 250,
      color: "#388E3C",
      category: "Activity",
      minUserXP: 0,
      badgeSource: "static" as const,
      earned: true,
      claimed: false,
      progress: { current: 10, target: 10 }
    }
  ],
  pendingLeaderboardEvent: null
};

const mockLeagues = [
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
];

const mockBootstrapShell = {
  hero: {
    xp: { current: 2570, level: 17, levelProgress: 28, tier: "Explorer" },
    streak: { current: 18, longest: 18, lastQualifiedAt: "2026-04-24T18:40:17.124Z" },
    totalPosts: 126,
    globalRank: null
  },
  snapshot: {
    xp: { current: 2570, level: 17, levelProgress: 28, tier: "Explorer" },
    streak: { current: 18, longest: 18, lastQualifiedAt: "2026-04-24T18:40:17.124Z" },
    totalPosts: 126,
    globalRank: null,
    challenges: [
      {
        id: "challenge-post-10",
        title: "Post 10 times",
        counterSource: "total_posts" as const,
        actionKey: null,
        current: 10,
        target: 10,
        completed: true,
        claimable: true,
        claimed: false
      }
    ],
    weeklyCapturesWeekOf: "2026-W17",
    weeklyCaptures: [
      {
        id: "capture-1",
        title: "Capture 1",
        completed: true,
        claimed: false,
        xpReward: 100
      }
    ],
    badges: [
      {
        id: "activity_swimming",
        title: "Aquatic Ace",
        description: "Post 10 times with the Swimming activity.",
        emoji: "🏊",
        image: "https://example.com/achievements/activity_swimming.jpg",
        iconUrl: "https://example.com/achievements/activity_swimming.jpg",
        statKey: "activity_swimming",
        targetNumber: 10,
        rewardPoints: 250,
        color: "#388E3C",
        category: "Activity",
        minUserXP: 0,
        badgeSource: "static" as const,
        earned: true,
        claimed: false,
        progress: { current: 10, target: 10 }
      }
    ],
    pendingLeaderboardEvent: null
  },
  leagues: mockLeagues,
  claimables: {
    totalCount: 3,
    weeklyCaptures: [{ id: "capture-1", title: "Capture 1", xpReward: 100 }],
    badges: [{ id: "activity_swimming", title: "Aquatic Ace", source: "static" as const, rewardPoints: 250 }],
    challenges: [{ id: "challenge-post-10", title: "Post 10 times", rewardPoints: 100 }]
  },
  degraded: false,
  fallbacks: ["achievement_global_rank_staged"]
};

const mockClaimables = {
  totalCount: 3,
  weeklyCaptures: [{ id: "capture-1", title: "Capture 1", xpReward: 100 }],
  badges: [{ id: "activity_swimming", title: "Aquatic Ace", source: "static" as const, rewardPoints: 250 }],
  challenges: [{ id: "challenge-post-10", title: "Post 10 times", rewardPoints: 100 }]
};

const mockLeaderboard = {
  scope: "xp_global" as const,
  entries: [
    {
      rank: 1,
      userId: "viewer-1",
      userName: "Viewer One",
      profilePic: null,
      score: 4250,
      level: 24,
      tier: "Explorer",
      xpUpdatedAtMs: 1775751883109
    }
  ],
  viewerRank: 4,
  cityName: null,
  groupName: null,
  leagueId: null,
  leagueName: null,
  leagueIconUrl: null,
  leagueColor: null,
  leagueBgColor: null
};

describe("v2 achievements routes", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const viewerHeaders = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal"
  };

  beforeEach(() => {
    vi.spyOn(achievementsRepository, "getHero").mockResolvedValue(structuredClone(mockHero));
    vi.spyOn(achievementsRepository, "getSnapshot").mockResolvedValue(structuredClone(mockSnapshot));
    vi.spyOn(achievementsRepository, "getBootstrapShell").mockResolvedValue(structuredClone(mockBootstrapShell));
    vi.spyOn(achievementsRepository, "getClaimables").mockResolvedValue(structuredClone(mockClaimables));
    vi.spyOn(achievementsRepository, "getLeagueDefinitions").mockResolvedValue(structuredClone(mockLeagues));
    vi.spyOn(achievementsRepository, "getLeaderboardRead").mockResolvedValue(structuredClone(mockLeaderboard));
    vi.spyOn(achievementsRepository, "recordScreenOpened").mockResolvedValue({ recordedAtMs: Date.now() });
    vi.spyOn(achievementsRepository, "recordLeaderboardAck").mockResolvedValue({
      recordedAtMs: Date.now(),
      acknowledged: true
    });
    vi.spyOn(achievementsRepository, "claimWeeklyCapture").mockResolvedValue({
      xpAwarded: 100,
      newTotalXP: 2670,
      leveledUp: false,
      newLevel: 17,
      tier: "Explorer"
    });
    vi.spyOn(achievementsRepository, "claimBadge").mockResolvedValue({
      xpAwarded: 250,
      newTotalXP: 2820,
      leveledUp: true,
      newLevel: 18,
      tier: "Master"
    });
    vi.spyOn(achievementsRepository, "claimChallenge").mockResolvedValue({
      xpAwarded: 100,
      newTotalXP: 2670,
      leveledUp: false,
      newLevel: 17,
      tier: "Explorer"
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns hero read payload", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/achievements/hero",
      headers: viewerHeaders
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("achievements.hero.get");
    expect(body.hero.xp.level).toBeGreaterThan(0);
  });

  it("collapses repeated hero requests to warm-cache zero reads", async () => {
    await app.inject({ method: "GET", url: "/v2/achievements/hero", headers: viewerHeaders });
    const warm = await app.inject({ method: "GET", url: "/v2/achievements/hero", headers: viewerHeaders });
    expect(warm.json().meta.db.reads).toBe(0);
    expect(warm.json().meta.db.queries).toBe(0);
  });

  it("returns snapshot read payload", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/achievements/snapshot",
      headers: viewerHeaders
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("achievements.snapshot.get");
    expect(Array.isArray(body.snapshot.challenges)).toBe(true);
    expect(body.snapshot).toHaveProperty("globalRank");
  });

  it("returns bootstrap aggregate payload", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/achievements/bootstrap",
      headers: viewerHeaders
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("achievements.bootstrap.get");
    expect(body.hero.globalRank).toBeNull();
    expect(body.snapshot.badges).toHaveLength(1);
    expect(body.leagues.length).toBeGreaterThan(0);
    expect(body.claimables.totalCount).toBeGreaterThan(0);
    expect(body.degraded).toBe(false);
    expect(body.fallbacks).toEqual(["achievement_global_rank_staged"]);
  });

  it("returns canonical status surface", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/achievements/status",
      headers: viewerHeaders
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("achievements.status.get");
    expect(body.status.nextLevelXp).toBeGreaterThanOrEqual(0);
    expect(body.status.badgeCount).toBeGreaterThan(0);
  });

  it("reuses warmed snapshot cache for status without extra reads", async () => {
    await app.inject({
      method: "GET",
      url: "/v2/achievements/snapshot",
      headers: viewerHeaders
    });

    const warmStatus = await app.inject({
      method: "GET",
      url: "/v2/achievements/status",
      headers: viewerHeaders
    });

    expect(warmStatus.statusCode).toBe(200);
    expect(warmStatus.json().meta.db.reads).toBe(0);
    expect(warmStatus.json().meta.db.queries).toBe(0);
  });

  it("returns canonical badge rows", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/achievements/badges",
      headers: viewerHeaders
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("achievements.badges.get");
    expect(Array.isArray(body.badges)).toBe(true);
    expect(body.badges[0]).toHaveProperty("badgeId");
    expect(body.badges[0]).toHaveProperty("progressTarget");
  });

  it("returns claimables surface", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/achievements/claimables",
      headers: viewerHeaders
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("achievements.claimables.get");
    expect(body.claimables.totalCount).toBeGreaterThan(0);
    expect(Array.isArray(body.claimables.badges)).toBe(true);
  });

  it("accepts screen-opened POST", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v2/achievements/screen-opened",
      headers: { ...viewerHeaders, "content-type": "application/json" },
      payload: {}
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("achievements.screenopened.post");
    expect(body.ok).toBe(true);
    expect(typeof body.recordedAtMs).toBe("number");
  });

  it("returns null pending delta by default and bounded poll hints", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/achievements/pending-delta",
      headers: viewerHeaders
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("achievements.pendingdelta.get");
    expect(body.delta).toBeNull();
    expect(body.pollAfterMs).toBeGreaterThan(0);
  });

  it("consumes seeded pending delta once", async () => {
    achievementsRepository.seedPendingDelta("internal-viewer", {
      xpGained: 75,
      newTotalXP: 2300,
      newLevel: 4,
      tier: "Pathfinder"
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const first = await app.inject({
      method: "GET",
      url: "/v2/achievements/pending-delta",
      headers: viewerHeaders
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.delta?.payload?.xpGained).toBe(75);

    await new Promise((resolve) => setTimeout(resolve, 1000));
    const second = await app.inject({
      method: "GET",
      url: "/v2/achievements/pending-delta",
      headers: viewerHeaders
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.delta).toBeNull();
  });

  it("returns leagues catalog", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/achievements/leagues",
      headers: viewerHeaders
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("achievements.leagues.get");
    expect(body.leagues.length).toBeGreaterThan(0);
  });

  it("reuses bootstrap cache for leagues without extra reads", async () => {
    await app.inject({
      method: "GET",
      url: "/v2/achievements/bootstrap",
      headers: viewerHeaders
    });

    const warm = await app.inject({
      method: "GET",
      url: "/v2/achievements/leagues",
      headers: viewerHeaders
    });

    expect(warm.statusCode).toBe(200);
    expect(warm.json().meta.db.reads).toBe(0);
    expect(warm.json().meta.db.queries).toBe(0);
  });

  it("returns xp_global leaderboard", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/achievements/leaderboard/xp_global",
      headers: viewerHeaders
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("achievements.leaderboard.get");
    expect(body.leaderboard.length).toBeGreaterThan(0);
    expect(typeof body.viewerRank).toBe("number");
  });

  it("returns xp_league leaderboard with leagueId", async () => {
    vi.spyOn(achievementsRepository, "getLeaderboardRead").mockResolvedValueOnce({
      ...structuredClone(mockLeaderboard),
      scope: "xp_league",
      leagueId: "explorer",
      leagueName: "Explorer"
    });
    const response = await app.inject({
      method: "GET",
      url: "/v2/achievements/leaderboard/xp_league?leagueId=explorer",
      headers: viewerHeaders
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.leagueName).toBeTruthy();
  });

  it("returns viewer rank helper route", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/achievements/leaderboard/xp_global/viewer-rank",
      headers: viewerHeaders
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("achievements.leaderboardviewerrank.get");
    expect(body.viewerRank).toBe(4);
  });

  it("acks leaderboard event", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v2/achievements/ack-leaderboard-event",
      headers: { ...viewerHeaders, "content-type": "application/json" },
      payload: { eventId: "evt-test-ack-1" }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("achievements.leaderboardack.post");
    expect(body.ok).toBe(true);
  });

  it("claims weekly capture reward shape", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v2/achievements/claim-weekly-capture",
      headers: { ...viewerHeaders, "content-type": "application/json" },
      payload: { captureId: "capture:1" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.reward.xpAwarded).toBe(100);
  });

  it("claims via generic claim route", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v2/achievements/claim",
      headers: { ...viewerHeaders, "content-type": "application/json" },
      payload: { kind: "badge", id: "activity_swimming" }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.routeName).toBe("achievements.claim.post");
    expect(body.kind).toBe("badge");
    expect(body.reward.xpAwarded).toBe(250);
  });

  it("emits diagnostics visibility and budget-safe entries", async () => {
    await app.inject({ method: "GET", url: "/v2/achievements/hero", headers: viewerHeaders });
    await app.inject({ method: "GET", url: "/v2/achievements/snapshot", headers: viewerHeaders });
    await app.inject({ method: "GET", url: "/v2/achievements/pending-delta", headers: viewerHeaders });

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=80" });
    const rows = diagnostics.json().data.recentRequests as Array<{
      routeName?: string;
      routePolicy?: { routeName: string };
      budgetViolations?: string[];
      dedupe?: { hits: number; misses: number };
      concurrency?: { waits: number };
    }>;

    const hero = rows.find((r) => r.routeName === "achievements.hero.get");
    const snapshot = rows.find((r) => r.routeName === "achievements.snapshot.get");
    const pending = rows.find((r) => r.routeName === "achievements.pendingdelta.get");

    expect(hero?.routePolicy?.routeName).toBe("achievements.hero.get");
    expect(snapshot?.routePolicy?.routeName).toBe("achievements.snapshot.get");
    expect(pending?.routePolicy?.routeName).toBe("achievements.pendingdelta.get");
    expect(hero?.budgetViolations).toEqual([]);
    expect(snapshot?.budgetViolations).toEqual([]);
    expect(pending?.budgetViolations).toEqual([]);
    expect(typeof hero?.dedupe?.hits).toBe("number");
    expect(typeof pending?.concurrency?.waits).toBe("number");
  });
});
