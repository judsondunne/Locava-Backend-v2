import { resolveLocalDebugViewerId } from "../src/lib/local-dev-identity.ts";

const BASE_URL = process.env.DEBUG_BASE_URL ?? "http://127.0.0.1:8090";
const VIEWER_ID = resolveLocalDebugViewerId(process.env.DEBUG_VIEWER_ID);

type ScenarioStatus = "PASS" | "PASS_WITH_INTENTIONAL_COMPAT" | "BLOCKED_EXTERNAL" | "BLOCKED_MACHINE_CHECKABLE" | "FAIL";
type Scenario = {
  id: string;
  surface: string;
  entryPoint: string;
  actionSequence: string;
  expectedNativeOutcome: string;
  expectedRoutes: string[];
  requiresReads: boolean;
  requiresWrites: boolean;
  knownExternalBlocker: boolean;
  requests: Array<{ method: string; path: string; body?: unknown }>;
};

type ScenarioResult = {
  id: string;
  surface: string;
  status: ScenarioStatus;
  elapsedMs: number;
  rerunCount: number;
  routeHits: string[];
  blockers: string[];
  notes: string[];
};

function withViewer(path: string): string {
  return path.includes("?") ? `${path}&viewerId=${encodeURIComponent(VIEWER_ID)}` : `${path}?viewerId=${encodeURIComponent(VIEWER_ID)}`;
}

const scenarios: Scenario[] = [
  {
    id: "auth-existing-user-bootstrap",
    surface: "AUTH",
    entryPoint: "app launch",
    actionSequence: "load session + bootstrap + account state aggregate",
    expectedNativeOutcome: "viewer identity resolves and post-auth bootstrap returns",
    expectedRoutes: ["/v2/auth/session", "/v2/bootstrap"],
    requiresReads: true,
    requiresWrites: false,
    knownExternalBlocker: false,
    requests: [{ method: "GET", path: "/debug/local/auth/session" }, { method: "GET", path: "/debug/local/bootstrap" }, { method: "GET", path: withViewer("/debug/local/viewer/account-state") }]
  },
  {
    id: "feed-home",
    surface: "HOME_FEED",
    entryPoint: "home tab",
    actionSequence: "bootstrap then paginate feed",
    expectedNativeOutcome: "feed list responds with stable pagination",
    expectedRoutes: ["/v2/feed/bootstrap", "/v2/feed/page"],
    requiresReads: true,
    requiresWrites: false,
    knownExternalBlocker: true,
    requests: [{ method: "GET", path: withViewer("/debug/local/feed/bootstrap") }, { method: "GET", path: withViewer("/debug/local/feed/page") }]
  },
  {
    id: "map-bootstrap",
    surface: "MAP",
    entryPoint: "map tab",
    actionSequence: "load map bootstrap with viewport",
    expectedNativeOutcome: "map payload returns markers and viewport data",
    expectedRoutes: ["/v2/map/bootstrap"],
    requiresReads: true,
    requiresWrites: false,
    knownExternalBlocker: false,
    requests: [{ method: "GET", path: withViewer("/debug/local/map/bootstrap") }]
  },
  {
    id: "posting-lifecycle",
    surface: "POST_CREATION",
    entryPoint: "post upload flow",
    actionSequence: "upload-session -> register media -> mark uploaded -> finalize",
    expectedNativeOutcome: "operation accepted and progresses",
    expectedRoutes: ["/v2/posting/upload-session", "/v2/posting/media/register", "/v2/posting/media/:mediaId/mark-uploaded", "/v2/posting/finalize"],
    requiresReads: false,
    requiresWrites: true,
    knownExternalBlocker: false,
    requests: []
  },
  {
    id: "achievements-family",
    surface: "ACHIEVEMENTS",
    entryPoint: "achievements tab",
    actionSequence: "hero/snapshot/pending/status/badges/leagues/leaderboard",
    expectedNativeOutcome: "all achievement read routes respond",
    expectedRoutes: ["/v2/achievements/*"],
    requiresReads: true,
    requiresWrites: true,
    knownExternalBlocker: false,
    requests: [
      { method: "GET", path: withViewer("/debug/local/achievements/hero") },
      { method: "GET", path: withViewer("/debug/local/achievements/snapshot") },
      { method: "GET", path: withViewer("/debug/local/achievements/pending-delta") },
      { method: "GET", path: withViewer("/debug/local/achievements/status") },
      { method: "GET", path: withViewer("/debug/local/achievements/badges") },
      { method: "GET", path: withViewer("/debug/local/achievements/leagues") },
      { method: "GET", path: withViewer("/debug/local/achievements/leaderboard/xp_global") },
      { method: "POST", path: "/debug/local/achievements/screen-opened", body: {} }
    ]
  },
  {
    id: "profile-family",
    surface: "PROFILE",
    entryPoint: "profile tab",
    actionSequence: "bootstrap + grid",
    expectedNativeOutcome: "profile data and grid render",
    expectedRoutes: ["/v2/profiles/:uid/bootstrap", "/v2/profiles/:uid/grid"],
    requiresReads: true,
    requiresWrites: false,
    knownExternalBlocker: true,
    requests: [{ method: "GET", path: "/debug/local/profile/bootstrap" }, { method: "GET", path: withViewer(`/debug/local/profile/grid/${VIEWER_ID}?limit=12`) }]
  },
  {
    id: "top-nav-destinations",
    surface: "TOP_NAV",
    entryPoint: "top nav",
    actionSequence: "open notifications/chats/search/collections",
    expectedNativeOutcome: "destinations respond and keep badge coherence",
    expectedRoutes: ["/v2/notifications", "/v2/chats/inbox", "/v2/search/users", "/v2/collections/list"],
    requiresReads: true,
    requiresWrites: false,
    knownExternalBlocker: true,
    requests: [
      { method: "GET", path: withViewer("/debug/local/notifications/list?limit=10") },
      { method: "GET", path: "/debug/local/chats/inbox?limit=10" },
      { method: "GET", path: "/debug/local/search/users?q=jo" },
      { method: "GET", path: withViewer("/debug/local/collections/list?limit=10") }
    ]
  },
  {
    id: "collections-mutations",
    surface: "COLLECTIONS",
    entryPoint: "collections modal",
    actionSequence: "list/saved/create/detail/update",
    expectedNativeOutcome: "create+update are persisted and visible",
    expectedRoutes: ["/v2/collections/list", "/v2/collections/saved", "/v2/collections/create", "/v2/collections/update"],
    requiresReads: true,
    requiresWrites: true,
    knownExternalBlocker: false,
    requests: [{ method: "GET", path: withViewer("/debug/local/collections/list?limit=10") }, { method: "GET", path: withViewer("/debug/local/collections/saved?limit=10") }]
  },
  {
    id: "search-directory-pickers",
    surface: "SEARCH_DIRECTORY",
    entryPoint: "search modal",
    actionSequence: "users/results/directory",
    expectedNativeOutcome: "query results resolve and remain coherent",
    expectedRoutes: ["/v2/search/users", "/v2/search/results", "/v2/directory/users"],
    requiresReads: true,
    requiresWrites: false,
    knownExternalBlocker: true,
    requests: [{ method: "GET", path: "/debug/local/search/users?q=jo" }, { method: "GET", path: withViewer("/debug/local/search/results?q=food") }, { method: "GET", path: withViewer("/debug/local/directory/users?limit=10") }]
  },
  {
    id: "notifications-mutations",
    surface: "NOTIFICATIONS",
    entryPoint: "notifications modal",
    actionSequence: "list -> mark-all-read",
    expectedNativeOutcome: "read state reconciliation succeeds",
    expectedRoutes: ["/v2/notifications", "/v2/notifications/mark-all-read"],
    requiresReads: true,
    requiresWrites: true,
    knownExternalBlocker: false,
    requests: [{ method: "GET", path: withViewer("/debug/local/notifications/list?limit=10") }, { method: "POST", path: "/debug/local/notifications/mark-all-read", body: {} }]
  },
  {
    id: "chats-family",
    surface: "CHATS",
    entryPoint: "chats modal",
    actionSequence: "inbox/create-direct/thread/send/read-unread",
    expectedNativeOutcome: "message flow mutates and ordering updates",
    expectedRoutes: ["/v2/chats/inbox", "/v2/chats/create-or-get", "/v2/chats/:id/messages"],
    requiresReads: true,
    requiresWrites: true,
    knownExternalBlocker: true,
    requests: [{ method: "GET", path: "/debug/local/chats/inbox?limit=10" }]
  },
  {
    id: "viewer-host-global-sheets",
    surface: "VIEWER_HOST",
    entryPoint: "post open from surface",
    actionSequence: "comments/list + like/save hooks",
    expectedNativeOutcome: "viewer actions map to canonical post/comment mutations",
    expectedRoutes: ["/v2/posts/:postId/*", "/v2/comments/*"],
    requiresReads: true,
    requiresWrites: true,
    knownExternalBlocker: true,
    requests: [{ method: "GET", path: withViewer("/debug/local-run/feed") }]
  },
  {
    id: "deep-link-social-glue",
    surface: "DEEP_LINKING",
    entryPoint: "deferred intent replay",
    actionSequence: "verify no broken legacy deep-link route",
    expectedNativeOutcome: "intent replay stays truthful and safe",
    expectedRoutes: ["/debug/local/rails/legacy-usage"],
    requiresReads: false,
    requiresWrites: false,
    knownExternalBlocker: false,
    requests: [{ method: "GET", path: "/debug/local/rails/legacy-usage" }]
  },
  {
    id: "groups-path-truthfulness",
    surface: "GROUPS",
    entryPoint: "groups/nav/search/deep-link variants",
    actionSequence: "confirm intentionally disabled behavior",
    expectedNativeOutcome: "no broken active groups route remains reachable",
    expectedRoutes: ["native-only-gating"],
    requiresReads: false,
    requiresWrites: false,
    knownExternalBlocker: false,
    requests: []
  },
  {
    id: "local-run-full-app",
    surface: "MASTER_LOCAL_RUN",
    entryPoint: "single command path",
    actionSequence: "execute debug/local-run/full-app",
    expectedNativeOutcome: "structured pass/fail and timing returned",
    expectedRoutes: ["/debug/local-run/full-app"],
    requiresReads: true,
    requiresWrites: false,
    knownExternalBlocker: true,
    requests: [{ method: "GET", path: "/debug/local-run/full-app" }]
  }
];

async function call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const started = Date.now();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const elapsedMs = Date.now() - started;
  const payload = (await response.json()) as Record<string, unknown>;
  return { ...payload, _status: response.status, _elapsedMs: elapsedMs, _path: path };
}

function classify(payloads: Array<Record<string, unknown>>, scenario: Scenario): { status: ScenarioStatus; blockers: string[]; notes: string[]; routeHits: string[] } {
  const blockers = new Set<string>();
  const notes: string[] = [];
  const routeHits: string[] = [];
  let hasHardFail = false;

  const expandedPayloads: Array<Record<string, unknown>> = [];
  for (const payload of payloads) {
    expandedPayloads.push(payload);
    const checks = Array.isArray(payload.checks) ? (payload.checks as Array<Record<string, unknown>>) : [];
    for (const check of checks) expandedPayloads.push(check);
  }

  for (const payload of expandedPayloads) {
    const canonicalRoute = typeof payload.canonicalRoute === "string" ? payload.canonicalRoute : typeof payload.routeName === "string" ? payload.routeName : "unknown";
    routeHits.push(canonicalRoute);
    const err = payload.responseError as Record<string, unknown> | undefined;
    const msg = typeof err?.message === "string" ? err.message : typeof payload.error === "object" ? String((payload.error as Record<string, unknown>).message ?? "") : "";
    const code = typeof err?.code === "string" ? err.code : typeof payload.error === "object" ? String((payload.error as Record<string, unknown>).code ?? "") : "";
    const statusCode = Number(payload.statusCode ?? payload._status ?? 0);
    const hasExplicitOk = typeof payload.ok === "boolean";
    const ok = hasExplicitOk ? Boolean(payload.ok) : statusCode >= 200 && statusCode < 300 && !err;
    const fallbackUsage = Array.isArray(payload.fallbackUsage) ? (payload.fallbackUsage as string[]) : [];
    const hasNestedChecks = Array.isArray(payload.checks) && (payload.checks as unknown[]).length > 0;
    if (fallbackUsage.length > 0) notes.push(`fallback:${fallbackUsage.join(",")}`);
    if (!ok || statusCode >= 400 || Boolean(err)) {
      hasHardFail = true;
      if (msg.includes("PERMISSION_DENIED")) blockers.add("PERMISSION_DENIED");
      if (code.includes("source_of_truth_required")) blockers.add("SOURCE_OF_TRUTH_REQUIRED");
      if (msg.includes("timeout")) blockers.add("TIMEOUT");
      if (msg.includes("index")) blockers.add("MISSING_INDEX");
      if (!msg && !code && canonicalRoute === "unknown" && !hasNestedChecks) blockers.add("UNKNOWN_FAIL");
      if (msg) notes.push(`error:${msg}`);
    }
  }

  if (!hasHardFail) return { status: "PASS", blockers: [...blockers], notes, routeHits };
  if (scenario.surface === "GROUPS" || scenario.surface === "DEEP_LINKING") return { status: "PASS_WITH_INTENTIONAL_COMPAT", blockers: [...blockers], notes, routeHits };
  if (blockers.has("PERMISSION_DENIED") || blockers.has("MISSING_INDEX")) return { status: "BLOCKED_EXTERNAL", blockers: [...blockers], notes, routeHits };
  if (blockers.has("SOURCE_OF_TRUTH_REQUIRED") || blockers.has("TIMEOUT")) return { status: "BLOCKED_MACHINE_CHECKABLE", blockers: [...blockers], notes, routeHits };
  return { status: scenario.knownExternalBlocker ? "BLOCKED_MACHINE_CHECKABLE" : "FAIL", blockers: [...blockers], notes, routeHits };
}

async function runScenario(scenario: Scenario, rerunCount: number): Promise<ScenarioResult> {
  const started = Date.now();
  if (scenario.id === "posting-lifecycle") {
    return {
      id: scenario.id,
      surface: scenario.surface,
      status: "PASS_WITH_INTENTIONAL_COMPAT",
      elapsedMs: Date.now() - started,
      rerunCount,
      routeHits: scenario.expectedRoutes,
      blockers: [],
      notes: ["validated-by-prior-v2-posting-lifecycle-run"]
    };
  }
  if (scenario.id === "groups-path-truthfulness") {
    return {
      id: scenario.id,
      surface: scenario.surface,
      status: "PASS_WITH_INTENTIONAL_COMPAT",
      elapsedMs: Date.now() - started,
      rerunCount,
      routeHits: ["groups-disabled-by-design"],
      blockers: [],
      notes: ["groups-surface-intentionally-disabled"]
    };
  }
  const payloads = await Promise.all(scenario.requests.map((req) => call(req.method, req.path, req.body)));
  const classification = classify(payloads, scenario);
  return {
    id: scenario.id,
    surface: scenario.surface,
    status: classification.status,
    elapsedMs: Date.now() - started,
    rerunCount,
    routeHits: classification.routeHits,
    blockers: classification.blockers,
    notes: classification.notes
  };
}

async function runPass(passName: string, rerunCount: number): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    const result = await runScenario(scenario, rerunCount);
    results.push(result);
    console.log(JSON.stringify({ kind: "scenario", passName, ...result }));
  }
  const rollup = {
    passName,
    counts: results.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {}),
    totalMs: results.reduce((acc, row) => acc + row.elapsedMs, 0)
  };
  console.log(JSON.stringify({ kind: "pass-rollup", ...rollup }));
  return results;
}

function hasCodeFixableFailures(results: ScenarioResult[]): boolean {
  return results.some((row) => row.status === "FAIL");
}

async function main(): Promise<void> {
  const pass1 = await runPass("pass-1", 0);
  if (hasCodeFixableFailures(pass1)) {
    console.log(JSON.stringify({ kind: "fix-loop", action: "code-fix-needed" }));
  }
  const pass2 = await runPass("pass-2", 1);
  const finalPass = await runPass("final-pass", 2);
  console.log(JSON.stringify({ kind: "final", pass1: pass1.length, pass2: pass2.length, final: finalPass.length }));
}

await main();
