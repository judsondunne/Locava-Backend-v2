export type ReplayBudgetKey =
  | "feed.first_page"
  | "feed.next_page"
  | "posts.details_batch.prefetch"
  | "posts.details_batch.opened_post"
  | "search.home_bootstrap"
  | "mixes.preview"
  | "collections.recommended"
  | "profile.following"
  | "auth.push_token"
  | "achievements.background";

export type ReplayBudget = {
  key: ReplayBudgetKey;
  label: string;
  latencyTargetMs: number;
  latencyHardFailMs: number;
  maxReads?: number;
  maxQueries?: number;
  maxWrites?: number;
  maxPayloadBytes?: number;
  maxPrimaryAssetLatencyMs?: number;
  notes?: string[];
};

export type ReplayBudgetCheckInput = {
  route: string;
  routeName?: string | null;
  method: string;
  latencyMs: number;
  payloadBytes: number;
  reads?: number | null;
  writes?: number | null;
  queries?: number | null;
  cursorUsed?: boolean;
  hydrationMode?: string | null;
  requestGroup?: string | null;
  deckHit?: boolean;
  mixKey?: string | null;
  primaryAssetLatencyMs?: number | null;
};

export type ReplayBudgetCheckResult = {
  budget: ReplayBudget | null;
  warnings: string[];
  hardFailures: string[];
  pass: boolean;
};

export const REAL_USER_REPLAY_BUDGETS: Record<ReplayBudgetKey, ReplayBudget> = {
  "feed.first_page": {
    key: "feed.first_page",
    label: "Feed first page",
    latencyTargetMs: 500,
    latencyHardFailMs: 800,
    maxReads: 25,
    maxQueries: 6,
    maxWrites: 2,
    maxPayloadBytes: 45_000,
    maxPrimaryAssetLatencyMs: 220,
    notes: ["first visible asset must be renderable/playable without detail hydration"],
  },
  "feed.next_page": {
    key: "feed.next_page",
    label: "Feed next page",
    latencyTargetMs: 350,
    latencyHardFailMs: 650,
    maxReads: 20,
    maxQueries: 2,
    maxWrites: 1,
    maxPayloadBytes: 45_000,
  },
  "posts.details_batch.prefetch": {
    key: "posts.details_batch.prefetch",
    label: "Playback prefetch batch",
    latencyTargetMs: 180,
    latencyHardFailMs: 350,
    maxReads: 3,
    maxQueries: 3,
    maxPayloadBytes: 45_000,
  },
  "posts.details_batch.opened_post": {
    key: "posts.details_batch.opened_post",
    label: "Opened post primary asset",
    latencyTargetMs: 220,
    latencyHardFailMs: 350,
    maxReads: 6,
    maxQueries: 4,
    maxPayloadBytes: 70_000,
    maxPrimaryAssetLatencyMs: 180,
  },
  "search.home_bootstrap": {
    key: "search.home_bootstrap",
    label: "Search home bootstrap",
    latencyTargetMs: 500,
    latencyHardFailMs: 700,
    maxReads: 40,
    maxQueries: 8,
    maxPayloadBytes: 30_000,
  },
  "mixes.preview": {
    key: "mixes.preview",
    label: "Mix preview",
    latencyTargetMs: 150,
    latencyHardFailMs: 250,
    maxReads: 10,
    maxQueries: 2,
  },
  "collections.recommended": {
    key: "collections.recommended",
    label: "Collections recommended",
    latencyTargetMs: 600,
    latencyHardFailMs: 900,
    maxReads: 50,
    maxQueries: 6,
    maxPayloadBytes: 60_000,
  },
  "profile.following": {
    key: "profile.following",
    label: "Profile following",
    latencyTargetMs: 250,
    latencyHardFailMs: 400,
    maxReads: 10,
    maxQueries: 3,
    maxPayloadBytes: 36_000,
  },
  "auth.push_token": {
    key: "auth.push_token",
    label: "Push token sync",
    latencyTargetMs: 200,
    latencyHardFailMs: 300,
    maxReads: 2,
    maxQueries: 2,
    maxWrites: 2,
    maxPayloadBytes: 6_000,
  },
  "achievements.background": {
    key: "achievements.background",
    label: "Background achievements",
    latencyTargetMs: 50,
    latencyHardFailMs: 120,
    maxReads: 4,
    maxQueries: 2,
    maxPayloadBytes: 20_000,
    notes: ["cached/background routes should not contend with P1/P2 lanes"],
  },
};

function resolveReplayBudget(input: ReplayBudgetCheckInput): ReplayBudget | null {
  if (input.route.startsWith("/v2/feed/for-you/simple")) {
    return input.cursorUsed ? REAL_USER_REPLAY_BUDGETS["feed.next_page"] : REAL_USER_REPLAY_BUDGETS["feed.first_page"];
  }
  if (input.route === "/v2/posts/details:batch" || input.route.endsWith("/v2/posts/details:batch")) {
    const openedGroup =
      input.requestGroup === "open" ||
      input.requestGroup === "opened_post" ||
      input.hydrationMode === "open" ||
      input.hydrationMode === "full";
    return openedGroup
      ? REAL_USER_REPLAY_BUDGETS["posts.details_batch.opened_post"]
      : REAL_USER_REPLAY_BUDGETS["posts.details_batch.prefetch"];
  }
  if (input.route.startsWith("/v2/search/home-bootstrap")) return REAL_USER_REPLAY_BUDGETS["search.home_bootstrap"];
  if (/^\/v2\/mixes\/[^/]+\/preview/.test(input.route)) return REAL_USER_REPLAY_BUDGETS["mixes.preview"];
  if (/^\/v2\/collections\/[^/]+\/recommended/.test(input.route)) return REAL_USER_REPLAY_BUDGETS["collections.recommended"];
  if (/^\/v2\/profiles\/[^/]+\/following/.test(input.route)) return REAL_USER_REPLAY_BUDGETS["profile.following"];
  if (input.route.startsWith("/v2/auth/push-token")) return REAL_USER_REPLAY_BUDGETS["auth.push_token"];
  if (
    input.route.startsWith("/v2/achievements/bootstrap") ||
    input.route.startsWith("/v2/achievements/snapshot") ||
    input.route.startsWith("/v2/achievements/hero") ||
    input.route.startsWith("/v2/achievements/leagues") ||
    input.route.startsWith("/v2/achievements/leaderboard/")
  ) {
    return REAL_USER_REPLAY_BUDGETS["achievements.background"];
  }
  return null;
}

export function evaluateReplayBudget(input: ReplayBudgetCheckInput): ReplayBudgetCheckResult {
  const budget = resolveReplayBudget(input);
  if (!budget) return { budget: null, warnings: [], hardFailures: [], pass: true };

  const warnings: string[] = [];
  const hardFailures: string[] = [];
  const reads = input.reads ?? 0;
  const writes = input.writes ?? 0;
  const queries = input.queries ?? 0;

  if (input.latencyMs > budget.latencyTargetMs) warnings.push(`latency_target_exceeded:${input.latencyMs}>${budget.latencyTargetMs}`);
  if (input.latencyMs > budget.latencyHardFailMs) {
    if (budget.key === "achievements.background") warnings.push(`latency_hard_exceeded_background:${input.latencyMs}>${budget.latencyHardFailMs}`);
    else hardFailures.push(`latency_hard_fail:${input.latencyMs}>${budget.latencyHardFailMs}`);
  }
  if (budget.maxReads != null && reads > budget.maxReads) hardFailures.push(`reads_exceeded:${reads}>${budget.maxReads}`);
  if (budget.maxQueries != null && queries > budget.maxQueries) hardFailures.push(`queries_exceeded:${queries}>${budget.maxQueries}`);
  if (budget.maxWrites != null && writes > budget.maxWrites) hardFailures.push(`writes_exceeded:${writes}>${budget.maxWrites}`);
  if (budget.maxPayloadBytes != null && input.payloadBytes > budget.maxPayloadBytes) {
    hardFailures.push(`payload_exceeded:${input.payloadBytes}>${budget.maxPayloadBytes}`);
  }
  if (budget.maxPrimaryAssetLatencyMs != null && input.primaryAssetLatencyMs != null) {
    if (input.primaryAssetLatencyMs > budget.maxPrimaryAssetLatencyMs) {
      hardFailures.push(
        `primary_asset_latency_exceeded:${input.primaryAssetLatencyMs}>${budget.maxPrimaryAssetLatencyMs}`,
      );
    }
  }

  return {
    budget,
    warnings,
    hardFailures,
    pass: warnings.length === 0 && hardFailures.length === 0,
  };
}
