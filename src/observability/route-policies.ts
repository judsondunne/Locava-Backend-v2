export type RoutePriority = "critical_interactive" | "deferred_interactive" | "background" | "internal_debug";
export type PriorityLane =
  | "P0_VISIBLE_PLAYBACK"
  | "P1_NEXT_PLAYBACK"
  | "P2_CURRENT_SCREEN"
  | "P3_DEFERRED_SCREEN"
  | "P4_BACKGROUND";

export type RouteBudgetPolicy = {
  routeName: string;
  priority: RoutePriority;
  lane?: PriorityLane;
  budgets: {
    latency: {
      p50Ms: number;
      p95Ms: number;
    };
    dbOps: {
      maxReadsCold: number;
      maxQueriesCold: number;
      expectedReadsWarm?: number;
      expectedQueriesWarm?: number;
    };
    payload: {
      maxBytes: number;
      targetBytes: number;
    };
  };
  cacheExpectation: "required" | "recommended" | "optional";
  concurrency: {
    expectedDedupe: boolean;
    maxConcurrentRepoOps: number;
  };
};

const policies: Record<string, RouteBudgetPolicy> = {
  "auth.session.get": {
    routeName: "auth.session.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 90, p95Ms: 200 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 10_000, targetBytes: 4_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 3 }
  },
  "bootstrap.init.get": {
    routeName: "bootstrap.init.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 120, p95Ms: 260 },
      dbOps: { maxReadsCold: 4, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 14_000, targetBytes: 6_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 3 }
  },
  "profile.bootstrap.get": {
    routeName: "profile.bootstrap.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 150, p95Ms: 340 },
      dbOps: { maxReadsCold: 16, maxQueriesCold: 4, expectedReadsWarm: 4, expectedQueriesWarm: 2 },
      payload: { maxBytes: 55_000, targetBytes: 28_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "profile.followers.get": {
    routeName: "profile.followers.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 120, p95Ms: 260 },
      dbOps: { maxReadsCold: 120, maxQueriesCold: 4, expectedReadsWarm: 20, expectedQueriesWarm: 2 },
      payload: { maxBytes: 36_000, targetBytes: 14_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "profile.following.get": {
    routeName: "profile.following.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 120, p95Ms: 260 },
      dbOps: { maxReadsCold: 120, maxQueriesCold: 4, expectedReadsWarm: 20, expectedQueriesWarm: 2 },
      payload: { maxBytes: 36_000, targetBytes: 14_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "profile.grid.get": {
    routeName: "profile.grid.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 90, p95Ms: 200 },
      dbOps: { maxReadsCold: 24, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 70_000, targetBytes: 35_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 2 }
  },
  "profile.liked_posts.get": {
    routeName: "profile.liked_posts.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 140, p95Ms: 320 },
      dbOps: { maxReadsCold: 80, maxQueriesCold: 6, expectedReadsWarm: 20, expectedQueriesWarm: 2 },
      payload: { maxBytes: 120_000, targetBytes: 55_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "profile.postdetail.get": {
    routeName: "profile.postdetail.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 100, p95Ms: 220 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 30_000, targetBytes: 14_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 2 }
  },
  "feed.bootstrap.get": {
    routeName: "feed.bootstrap.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 110, p95Ms: 240 },
      dbOps: { maxReadsCold: 14, maxQueriesCold: 3, expectedReadsWarm: 2, expectedQueriesWarm: 1 },
      payload: { maxBytes: 38_000, targetBytes: 20_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "feed.page.get": {
    routeName: "feed.page.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 95, p95Ms: 220 },
      dbOps: { maxReadsCold: 16, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 40_000, targetBytes: 22_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "feed.itemdetail.get": {
    routeName: "feed.itemdetail.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 105, p95Ms: 230 },
      dbOps: { maxReadsCold: 9, maxQueriesCold: 6, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 42_000, targetBytes: 24_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "search.results.get": {
    routeName: "search.results.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 95, p95Ms: 220 },
      dbOps: { maxReadsCold: 16, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 36_000, targetBytes: 18_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "search.users.get": {
    routeName: "search.users.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 200 },
      dbOps: { maxReadsCold: 24, maxQueriesCold: 3, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 20_000, targetBytes: 10_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "search.mixes.bootstrap.get": {
    routeName: "search.mixes.bootstrap.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 140, p95Ms: 320 },
      dbOps: { maxReadsCold: 240, maxQueriesCold: 20, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 55_000, targetBytes: 24_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "search.mixes.feed.post": {
    routeName: "search.mixes.feed.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 120, p95Ms: 280 },
      dbOps: { maxReadsCold: 180, maxQueriesCold: 12, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 70_000, targetBytes: 34_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "search.mixes.feed.get": {
    routeName: "search.mixes.feed.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 120, p95Ms: 280 },
      dbOps: { maxReadsCold: 180, maxQueriesCold: 12, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 70_000, targetBytes: 34_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "search.home_bootstrap.v1": {
    routeName: "search.home_bootstrap.v1",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 200, p95Ms: 900 },
      dbOps: { maxReadsCold: 120, maxQueriesCold: 28, expectedReadsWarm: 12, expectedQueriesWarm: 6 },
      payload: { maxBytes: 120_000, targetBytes: 48_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 10 }
  },
  "search.mixes.activity.page.get": {
    routeName: "search.mixes.activity.page.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 120, p95Ms: 400 },
      dbOps: { maxReadsCold: 90, maxQueriesCold: 4, expectedReadsWarm: 0, expectedQueriesWarm: 1 },
      payload: { maxBytes: 80_000, targetBytes: 36_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "posts.like.post": {
    routeName: "posts.like.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 2 }
  },
  "posts.likes.list": {
    routeName: "posts.likes.list",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 240 },
      dbOps: { maxReadsCold: 120, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 1 },
      payload: { maxBytes: 60_000, targetBytes: 18_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: false, maxConcurrentRepoOps: 2 }
  },
  "posts.unlike.post": {
    routeName: "posts.unlike.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 2 }
  },
  "posts.delete": {
    routeName: "posts.delete",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 90, p95Ms: 240 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 10_000, targetBytes: 3_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 2 }
  },
  "users.follow.post": {
    routeName: "users.follow.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 2 }
  },
  "users.unfollow.post": {
    routeName: "users.unfollow.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 2 }
  },
  "users.lastactive.get": {
    routeName: "users.lastactive.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 60, p95Ms: 150 },
      dbOps: { maxReadsCold: 1, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 6_000, targetBytes: 1_200 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 10 }
  },
  "posting.uploadsession.post": {
    routeName: "posting.uploadsession.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 180 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 12 }
  },
  "posting.finalize.post": {
    routeName: "posting.finalize.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 95, p95Ms: 220 },
      dbOps: { maxReadsCold: 4, maxQueriesCold: 4, expectedReadsWarm: 2, expectedQueriesWarm: 2 },
      payload: { maxBytes: 10_000, targetBytes: 3_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "posting.operationstatus.get": {
    routeName: "posting.operationstatus.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 170 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 20 }
  },
  "posting.operationcancel.post": {
    routeName: "posting.operationcancel.post",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 180 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 3, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "achievements.leaderboardviewerrank.get": {
    routeName: "achievements.leaderboardviewerrank.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 90, p95Ms: 200 },
      dbOps: { maxReadsCold: 6, maxQueriesCold: 3, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 14_000, targetBytes: 6_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 3 }
  },
  "posting.operationretry.post": {
    routeName: "posting.operationretry.post",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 200 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 3, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 9_000, targetBytes: 2_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "posting.mediaregister.post": {
    routeName: "posting.mediaregister.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 180 },
      dbOps: { maxReadsCold: 4, maxQueriesCold: 3, expectedReadsWarm: 2, expectedQueriesWarm: 1 },
      payload: { maxBytes: 9_000, targetBytes: 3_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 10 }
  },
  "posting.location_suggest.get": {
    routeName: "posting.location_suggest.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 35, p95Ms: 120 },
      dbOps: { maxReadsCold: 0, maxQueriesCold: 0, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 18_000, targetBytes: 6_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 2 }
  },
  "legends.stagepost.post": {
    routeName: "legends.stagepost.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 18, maxQueriesCold: 0, expectedReadsWarm: 8, expectedQueriesWarm: 0 },
      payload: { maxBytes: 10_000, targetBytes: 3_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: false, maxConcurrentRepoOps: 6 }
  },
  "legends.stagepost.cancel.delete": {
    routeName: "legends.stagepost.cancel.delete",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 60, p95Ms: 160 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 0, expectedReadsWarm: 1, expectedQueriesWarm: 0 },
      payload: { maxBytes: 5_000, targetBytes: 900 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "legends.me.bootstrap.get": {
    routeName: "legends.me.bootstrap.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 200 },
      dbOps: { maxReadsCold: 25, maxQueriesCold: 0, expectedReadsWarm: 10, expectedQueriesWarm: 0 },
      payload: { maxBytes: 38_000, targetBytes: 14_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "legends.scope.get": {
    routeName: "legends.scope.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 0, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 20_000, targetBytes: 7_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "legends.afterpost.get": {
    routeName: "legends.afterpost.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 24, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 1 },
      payload: { maxBytes: 26_000, targetBytes: 9_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "legends.events.unseen.get": {
    routeName: "legends.events.unseen.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 8, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 1 },
      payload: { maxBytes: 18_000, targetBytes: 6_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "legends.events.seen.post": {
    routeName: "legends.events.seen.post",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 60, p95Ms: 160 },
      dbOps: { maxReadsCold: 1, maxQueriesCold: 0, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 4_000, targetBytes: 900 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "posting.mediamarkuploaded.post": {
    routeName: "posting.mediamarkuploaded.post",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 75, p95Ms: 170 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 10 }
  },
  "posting.mediastatus.get": {
    routeName: "posting.mediastatus.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 65, p95Ms: 160 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 16 }
  },
  "comments.list.get": {
    routeName: "comments.list.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 190 },
      dbOps: { maxReadsCold: 20, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 24_000, targetBytes: 12_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "comments.create.post": {
    routeName: "comments.create.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 180 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 10_000, targetBytes: 3_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "comments.like.post": {
    routeName: "comments.like.post",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 75, p95Ms: 170 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "comments.delete.delete": {
    routeName: "comments.delete.delete",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 75, p95Ms: 170 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "notifications.list.get": {
    routeName: "notifications.list.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 180 },
      dbOps: { maxReadsCold: 20, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 24_000, targetBytes: 12_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 10 }
  },
  "notifications.markread.post": {
    routeName: "notifications.markread.post",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 110, p95Ms: 300 },
      dbOps: { maxReadsCold: 1, maxQueriesCold: 1, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "notifications.markallread.post": {
    routeName: "notifications.markallread.post",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 170 },
      dbOps: { maxReadsCold: 1, maxQueriesCold: 1, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "chats.inbox.get": {
    routeName: "chats.inbox.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 190 },
      dbOps: { maxReadsCold: 20, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 26_000, targetBytes: 13_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 10 }
  },
  "chats.thread.get": {
    routeName: "chats.thread.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 190 },
      dbOps: { maxReadsCold: 50, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 28_000, targetBytes: 14_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "chats.sendtext.post": {
    routeName: "chats.sendtext.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 180 },
      dbOps: { maxReadsCold: 1, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 1 },
      payload: { maxBytes: 12_000, targetBytes: 4_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "chats.markread.post": {
    routeName: "chats.markread.post",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 170 },
      dbOps: { maxReadsCold: 1, maxQueriesCold: 1, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "collections.saved.get": {
    routeName: "collections.saved.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 90, p95Ms: 200 },
      dbOps: { maxReadsCold: 28, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 30_000, targetBytes: 15_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "collections.list.get": {
    routeName: "collections.list.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 180 },
      dbOps: { maxReadsCold: 4, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 35_000, targetBytes: 12_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "collections.detail.get": {
    routeName: "collections.detail.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 75, p95Ms: 170 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 18_000, targetBytes: 8_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "collections.create.post": {
    routeName: "collections.create.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 190 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 1 },
      payload: { maxBytes: 12_000, targetBytes: 4_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "collections.update.post": {
    routeName: "collections.update.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 190 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 1 },
      payload: { maxBytes: 10_000, targetBytes: 3_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "posts.save.post": {
    routeName: "posts.save.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 1, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "posts.unsave.post": {
    routeName: "posts.unsave.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 1, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "posts.detail.get": {
    routeName: "posts.detail.get",
    priority: "critical_interactive",
    lane: "P0_VISIBLE_PLAYBACK",
    budgets: {
      latency: { p50Ms: 95, p95Ms: 210 },
      dbOps: { maxReadsCold: 12, maxQueriesCold: 6, expectedReadsWarm: 2, expectedQueriesWarm: 2 },
      payload: { maxBytes: 44_000, targetBytes: 20_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "posts.detail.batch": {
    routeName: "posts.detail.batch",
    priority: "critical_interactive",
    lane: "P1_NEXT_PLAYBACK",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 18, maxQueriesCold: 8, expectedReadsWarm: 2, expectedQueriesWarm: 2 },
      payload: { maxBytes: 52_000, targetBytes: 24_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 3 }
  },
  "posts.stage.post": {
    routeName: "posts.stage.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 190 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 14_000, targetBytes: 4_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "posts.mediasignupload.post": {
    routeName: "posts.mediasignupload.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 200 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 30_000, targetBytes: 7_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "posts.mediacomplete.post": {
    routeName: "posts.mediacomplete.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 90, p95Ms: 220 },
      dbOps: { maxReadsCold: 5, maxQueriesCold: 3, expectedReadsWarm: 2, expectedQueriesWarm: 1 },
      payload: { maxBytes: 18_000, targetBytes: 4_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "posts.publish.post": {
    routeName: "posts.publish.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 120, p95Ms: 360 },
      dbOps: { maxReadsCold: 20, maxQueriesCold: 8, expectedReadsWarm: 4, expectedQueriesWarm: 2 },
      payload: { maxBytes: 110_000, targetBytes: 28_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 10 }
  },
  "posts.card.get": {
    routeName: "posts.card.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 90, p95Ms: 200 },
      dbOps: { maxReadsCold: 8, maxQueriesCold: 4, expectedReadsWarm: 2, expectedQueriesWarm: 1 },
      payload: { maxBytes: 30_000, targetBytes: 10_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "achievements.hero.get": {
    routeName: "achievements.hero.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 170 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 10_000, targetBytes: 3_500 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "achievements.bootstrap.get": {
    routeName: "achievements.bootstrap.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 190 },
      dbOps: { maxReadsCold: 6, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 44_000, targetBytes: 18_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "achievements.snapshot.get": {
    routeName: "achievements.snapshot.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 90, p95Ms: 200 },
      dbOps: { maxReadsCold: 5, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 28_000, targetBytes: 12_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "achievements.pendingdelta.get": {
    routeName: "achievements.pendingdelta.get",
    priority: "background",
    budgets: {
      latency: { p50Ms: 55, p95Ms: 140 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 8_000, targetBytes: 1_500 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "achievements.status.get": {
    routeName: "achievements.status.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 170 },
      dbOps: { maxReadsCold: 4, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 6_000, targetBytes: 2_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "achievements.badges.get": {
    routeName: "achievements.badges.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 190 },
      dbOps: { maxReadsCold: 4, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 24_000, targetBytes: 10_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "achievements.claimables.get": {
    routeName: "achievements.claimables.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 75, p95Ms: 180 },
      dbOps: { maxReadsCold: 5, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 20_000, targetBytes: 8_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "achievements.claim.post": {
    routeName: "achievements.claim.post",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 180 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 10_000, targetBytes: 2_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "achievements.screenopened.post": {
    routeName: "achievements.screenopened.post",
    priority: "background",
    budgets: {
      latency: { p50Ms: 45, p95Ms: 120 },
      dbOps: { maxReadsCold: 0, maxQueriesCold: 0, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 2_000, targetBytes: 400 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "achievements.leagues.get": {
    routeName: "achievements.leagues.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 55, p95Ms: 140 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 16_000, targetBytes: 6_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "achievements.leaderboard.get": {
    routeName: "achievements.leaderboard.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 200 },
      dbOps: { maxReadsCold: 4, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 120_000, targetBytes: 45_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "achievements.leaderboardack.post": {
    routeName: "achievements.leaderboardack.post",
    priority: "background",
    budgets: {
      latency: { p50Ms: 45, p95Ms: 120 },
      dbOps: { maxReadsCold: 0, maxQueriesCold: 0, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 2_000, targetBytes: 400 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "achievements.claimweeklycapture.post": {
    routeName: "achievements.claimweeklycapture.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 4_000, targetBytes: 900 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "achievements.claimbadge.post": {
    routeName: "achievements.claimbadge.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 4_000, targetBytes: 900 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "achievements.claimchallenge.post": {
    routeName: "achievements.claimchallenge.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 4_000, targetBytes: 900 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "achievements.claimintrobonus.post": {
    routeName: "achievements.claimintrobonus.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 4_000, targetBytes: 900 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "map.bootstrap.get": {
    routeName: "map.bootstrap.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 300, p95Ms: 1_000 },
      dbOps: { maxReadsCold: 2_500, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 180_000, targetBytes: 115_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 8 }
  },
  "map.markers.get": {
    routeName: "map.markers.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 260, p95Ms: 700 },
      dbOps: { maxReadsCold: 2_500, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 900_000, targetBytes: 780_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "search.suggest.get": {
    routeName: "search.suggest.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 170 },
      dbOps: { maxReadsCold: 18, maxQueriesCold: 3, expectedReadsWarm: 2, expectedQueriesWarm: 1 },
      payload: { maxBytes: 28_000, targetBytes: 10_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "places.reverse_geocode.get": {
    routeName: "places.reverse_geocode.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 180 },
      dbOps: { maxReadsCold: 0, maxQueriesCold: 0, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 4_000, targetBytes: 1_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 2 }
  },
  "search.bootstrap.get": {
    routeName: "search.bootstrap.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 95, p95Ms: 220 },
      dbOps: { maxReadsCold: 28, maxQueriesCold: 4, expectedReadsWarm: 4, expectedQueriesWarm: 2 },
      payload: { maxBytes: 72_000, targetBytes: 28_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "mixes.catalog.get": {
    routeName: "mixes.catalog.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 170 },
      dbOps: { maxReadsCold: 8, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 18_000, targetBytes: 8_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "mixes.area.post": {
    routeName: "mixes.area.post",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 200 },
      dbOps: { maxReadsCold: 24, maxQueriesCold: 3, expectedReadsWarm: 2, expectedQueriesWarm: 1 },
      payload: { maxBytes: 90_000, targetBytes: 36_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "mixes.feed.post": {
    routeName: "mixes.feed.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 120, p95Ms: 280 },
      dbOps: { maxReadsCold: 220, maxQueriesCold: 18, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 90_000, targetBytes: 38_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "mixes.preview.get": {
    routeName: "mixes.preview.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 120, p95Ms: 300 },
      dbOps: { maxReadsCold: 60, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 36_000, targetBytes: 16_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 2 }
  },
  "mixes.page.get": {
    routeName: "mixes.page.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 180, p95Ms: 500 },
      dbOps: { maxReadsCold: 120, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 120_000, targetBytes: 45_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 3 }
  },
  "social.batch.get": {
    routeName: "social.batch.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 90, p95Ms: 220 },
      dbOps: { maxReadsCold: 120, maxQueriesCold: 12, expectedReadsWarm: 8, expectedQueriesWarm: 2 },
      payload: { maxBytes: 48_000, targetBytes: 18_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "social.suggested_friends.get": {
    routeName: "social.suggested_friends.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 200 },
      dbOps: { maxReadsCold: 24, maxQueriesCold: 4, expectedReadsWarm: 3, expectedQueriesWarm: 2 },
      payload: { maxBytes: 28_000, targetBytes: 12_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "social.contacts_sync.post": {
    routeName: "social.contacts_sync.post",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 110, p95Ms: 260 },
      dbOps: { maxReadsCold: 48, maxQueriesCold: 6, expectedReadsWarm: 8, expectedQueriesWarm: 2 },
      payload: { maxBytes: 32_000, targetBytes: 12_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "users.suggested.get": {
    routeName: "users.suggested.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 95, p95Ms: 240 },
      dbOps: { maxReadsCold: 80, maxQueriesCold: 10, expectedReadsWarm: 10, expectedQueriesWarm: 4 },
      payload: { maxBytes: 80_000, targetBytes: 24_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "posting.stagingpresign.post": {
    routeName: "posting.stagingpresign.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 65, p95Ms: 170 },
      dbOps: { maxReadsCold: 0, maxQueriesCold: 0, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 36_000, targetBytes: 8_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 10 }
  },
  "auth.check_handle.get": {
    routeName: "auth.check_handle.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 170 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 4_000, targetBytes: 800 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 2 }
  },
  "auth.check_user_exists.get": {
    routeName: "auth.check_user_exists.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 180 },
      dbOps: { maxReadsCold: 1, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 4_000, targetBytes: 800 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 2 }
  },
  "auth.login.post": {
    routeName: "auth.login.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 140, p95Ms: 360 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 18_000, targetBytes: 5_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 3 }
  },
  "auth.register.post": {
    routeName: "auth.register.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 160, p95Ms: 420 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 18_000, targetBytes: 5_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 3 }
  },
  "auth.signin_google.post": {
    routeName: "auth.signin_google.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 160, p95Ms: 420 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 18_000, targetBytes: 5_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 3 }
  },
  "auth.signin_apple.post": {
    routeName: "auth.signin_apple.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 160, p95Ms: 420 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 18_000, targetBytes: 5_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 3 }
  },
  "auth.profile_create.post": {
    routeName: "auth.profile_create.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 110, p95Ms: 260 },
      dbOps: { maxReadsCold: 4, maxQueriesCold: 3, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 16_000, targetBytes: 4_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "auth.profile_branch_merge.post": {
    routeName: "auth.profile_branch_merge.post",
    priority: "background",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 180 },
      dbOps: { maxReadsCold: 1, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 6_000, targetBytes: 1_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 2 }
  },
  "chats.create_or_get.post": {
    routeName: "chats.create_or_get.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 200 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "chats.create_group.post": {
    routeName: "chats.create_group.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 95, p95Ms: 220 },
      dbOps: { maxReadsCold: 4, maxQueriesCold: 3, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 10_000, targetBytes: 2_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "chats.markunread.post": {
    routeName: "chats.markunread.post",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 70, p95Ms: 170 },
      dbOps: { maxReadsCold: 1, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 6_000, targetBytes: 1_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "chats.messagereaction.post": {
    routeName: "chats.messagereaction.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 180 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "chats.updategroup.post": {
    routeName: "chats.updategroup.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 190 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 8_000, targetBytes: 2_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "chats.delete.delete": {
    routeName: "chats.delete.delete",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 180 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 6_000, targetBytes: 1_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "chats.typing.put": {
    routeName: "chats.typing.put",
    priority: "background",
    budgets: {
      latency: { p50Ms: 45, p95Ms: 120 },
      dbOps: { maxReadsCold: 0, maxQueriesCold: 1, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 3_000, targetBytes: 400 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: false, maxConcurrentRepoOps: 4 }
  },
  "chats.message.delete": {
    routeName: "chats.message.delete",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 180 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 6_000, targetBytes: 1_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "collections.posts.get": {
    routeName: "collections.posts.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 95, p95Ms: 220 },
      dbOps: { maxReadsCold: 30, maxQueriesCold: 3, expectedReadsWarm: 2, expectedQueriesWarm: 1 },
      payload: { maxBytes: 42_000, targetBytes: 18_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "collections.posts.add.post": {
    routeName: "collections.posts.add.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 200 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 8_000, targetBytes: 2_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "collections.posts.remove.delete": {
    routeName: "collections.posts.remove.delete",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 200 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 8_000, targetBytes: 2_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "collections.leave.post": {
    routeName: "collections.leave.post",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 190 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 8_000, targetBytes: 2_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "collections.delete.post": {
    routeName: "collections.delete.post",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 190 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 8_000, targetBytes: 2_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 6 }
  },
  "posts.save-state.get": {
    routeName: "posts.save-state.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 65, p95Ms: 160 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 6_000, targetBytes: 1_500 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "collections.save-sheet.get": {
    routeName: "collections.save-sheet.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 200 },
      dbOps: { maxReadsCold: 10, maxQueriesCold: 3, expectedReadsWarm: 2, expectedQueriesWarm: 1 },
      payload: { maxBytes: 24_000, targetBytes: 10_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "groups.list.get": {
    routeName: "groups.list.get",
    priority: "deferred_interactive",
    budgets: {
      latency: { p50Ms: 90, p95Ms: 220 },
      dbOps: { maxReadsCold: 16, maxQueriesCold: 2, expectedReadsWarm: 2, expectedQueriesWarm: 1 },
      payload: { maxBytes: 22_000, targetBytes: 9_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "groups.create.post": {
    routeName: "groups.create.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 95, p95Ms: 240 },
      dbOps: { maxReadsCold: 3, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 10_000, targetBytes: 2_500 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "groups.detail.get": {
    routeName: "groups.detail.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 90, p95Ms: 220 },
      dbOps: { maxReadsCold: 6, maxQueriesCold: 2, expectedReadsWarm: 1, expectedQueriesWarm: 1 },
      payload: { maxBytes: 14_000, targetBytes: 5_000 }
    },
    cacheExpectation: "recommended",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "groups.join.post": {
    routeName: "groups.join.post",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 80, p95Ms: 190 },
      dbOps: { maxReadsCold: 2, maxQueriesCold: 2, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 8_000, targetBytes: 2_000 }
    },
    cacheExpectation: "optional",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  },
  "directory.users.get": {
    routeName: "directory.users.get",
    priority: "critical_interactive",
    budgets: {
      latency: { p50Ms: 85, p95Ms: 200 },
      dbOps: { maxReadsCold: 24, maxQueriesCold: 3, expectedReadsWarm: 0, expectedQueriesWarm: 0 },
      payload: { maxBytes: 20_000, targetBytes: 10_000 }
    },
    cacheExpectation: "required",
    concurrency: { expectedDedupe: true, maxConcurrentRepoOps: 4 }
  }
};

export function getRoutePolicy(routeName: string): RouteBudgetPolicy | undefined {
  const policy = policies[routeName];
  if (!policy) return undefined;
  if (policy.lane) return policy;
  return { ...policy, lane: inferLaneFromPriority(policy.priority) };
}

export function listRoutePolicies(): RouteBudgetPolicy[] {
  return Object.values(policies).map((policy) =>
    policy.lane ? policy : { ...policy, lane: inferLaneFromPriority(policy.priority) }
  );
}

function inferLaneFromPriority(priority: RoutePriority): PriorityLane {
  if (priority === "critical_interactive") return "P2_CURRENT_SCREEN";
  if (priority === "deferred_interactive") return "P3_DEFERRED_SCREEN";
  return "P4_BACKGROUND";
}
