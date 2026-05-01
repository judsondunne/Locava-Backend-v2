import { mkdir, readFile, writeFile } from "node:fs/promises";

type Envelope = {
  ok?: boolean;
  data?: Record<string, unknown>;
  meta?: {
    db?: { reads?: number; writes?: number; queries?: number };
    budgetViolations?: string[];
    latencyMs?: number;
  };
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

type ScenarioRow = {
  actionName: string;
  route: string;
  method: "GET" | "POST";
  statusCode: number;
  latencyMs: number;
  payloadBytes: number;
  reads: number;
  writes: number;
  queries: number;
  budgetViolations: string[];
  validJson: boolean;
  cacheSource: string | null;
  poolState: string | null;
  hydrationMode: string | null;
  requestGroup: string | null;
  routePriority: string | null;
  notes?: string[];
};

type NativeStartupEvent = {
  phase?: string;
  kind?: string;
  ts?: number;
  path?: string;
  priorityLane?: string;
  label?: string;
};

type LegacyAudit = {
  ok: boolean;
  notes: string[];
};

const BASE_URL = process.env.PERF_BASE_URL ?? "http://127.0.0.1:8080";
const VIEWER_ID = process.env.PERF_VIEWER_ID ?? "internal-viewer";
const OTHER_USER_ID = process.env.PERF_OTHER_USER_ID ?? "user-2";
const OUTPUT = process.env.PERF_OUTPUT ?? "app-action-trace";
const NATIVE_TRACE_FILE = process.env.PERF_NATIVE_TRACE_FILE ?? "";

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function callRoute(input: {
  actionName: string;
  method: "GET" | "POST";
  route: string;
  body?: unknown;
}): Promise<{ row: ScenarioRow; json: Envelope | null }> {
  const startedAt = Date.now();
  const response = await fetch(`${BASE_URL}${input.route}`, {
    method: input.method,
    headers: {
      "content-type": "application/json",
      "x-viewer-id": VIEWER_ID,
      "x-viewer-roles": "internal",
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  const text = await response.text();
  const latencyMs = Date.now() - startedAt;
  const payloadBytes = Buffer.byteLength(text, "utf8");
  let parsed: Envelope | null = null;
  let validJson = false;
  try {
    parsed = JSON.parse(text) as Envelope;
    validJson = true;
  } catch {
    parsed = null;
  }
  const data = parsed?.data ?? {};
  const diagnostics =
    data && typeof data === "object" && data.diagnostics && typeof data.diagnostics === "object"
      ? (data.diagnostics as Record<string, unknown>)
      : {};
  const debug =
    data && typeof data === "object" && data.debug && typeof data.debug === "object"
      ? (data.debug as Record<string, unknown>)
      : {};
  return {
    row: {
      actionName: input.actionName,
      route: input.route,
      method: input.method,
      statusCode: response.status,
      latencyMs,
      payloadBytes,
      reads: Number(parsed?.meta?.db?.reads ?? 0),
      writes: Number(parsed?.meta?.db?.writes ?? 0),
      queries: Number(parsed?.meta?.db?.queries ?? 0),
      budgetViolations: Array.isArray(parsed?.meta?.budgetViolations) ? parsed!.meta!.budgetViolations! : [],
      validJson,
      cacheSource: pickString(diagnostics.cacheSource, diagnostics.cache, debug.cacheSource),
      poolState: pickString(data["poolState"], diagnostics.poolState, debug.poolState),
      hydrationMode: pickString(data["hydrationMode"], diagnostics.hydrationMode),
      requestGroup: pickString(diagnostics.requestGroup),
      routePriority: pickString(diagnostics.routePriority),
    },
    json: parsed,
  };
}

function printRow(row: ScenarioRow): void {
  console.log(
    JSON.stringify(
      {
        actionName: row.actionName,
        route: row.route,
        statusCode: row.statusCode,
        latencyMs: row.latencyMs,
        payloadBytes: row.payloadBytes,
        reads: row.reads,
        writes: row.writes,
        queries: row.queries,
        budgetViolations: row.budgetViolations,
        validJson: row.validJson,
        cacheSource: row.cacheSource,
        poolState: row.poolState,
        hydrationMode: row.hydrationMode,
        requestGroup: row.requestGroup,
        routePriority: row.routePriority,
        notes: row.notes ?? [],
      },
      null,
      2,
    ),
  );
}

function collectFeedPostIds(json: Envelope | null): string[] {
  const items = Array.isArray(json?.data?.items) ? (json!.data!.items as Array<Record<string, unknown>>) : [];
  return items
    .map((item) => String(item.postId ?? ""))
    .filter(Boolean)
    .slice(0, 5);
}

function collectOtherUserId(json: Envelope | null): string | null {
  const items = Array.isArray(json?.data?.items) ? (json!.data!.items as Array<Record<string, unknown>>) : [];
  for (const item of items) {
    const author = item.author;
    if (!author || typeof author !== "object") continue;
    const userId = String((author as Record<string, unknown>).userId ?? "").trim();
    if (userId && userId !== VIEWER_ID) return userId;
  }
  return null;
}

async function loadNativeStartupEvents(): Promise<NativeStartupEvent[]> {
  if (!NATIVE_TRACE_FILE) return [];
  try {
    const raw = await readFile(NATIVE_TRACE_FILE, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as NativeStartupEvent;
          return [parsed];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

async function runLegacyEndpointAudit(): Promise<LegacyAudit> {
  const notes: string[] = [];
  const checks: Array<{
    file: string;
    forbidden: RegExp[];
    required?: RegExp[];
  }> = [
    {
      file: "../Locava-Native/src/data/repos/connectionsRepo.ts",
      forbidden: [/\/friends-data\b/],
      required: [/\/v2\/profiles\//, /\/v2\/social\/suggested-friends/],
    },
    {
      file: "../Locava-Native/src/features/activities/activitiesCatalog.store.ts",
      forbidden: [/activitiesList\b/, /\/api\/v1\/product\/activities\/list/],
      required: [/fallbackActivities/, /readActivitiesCatalogCache/],
    },
    {
      file: "../Locava-Native/src/features/notifications/pushNotifications.ts",
      forbidden: [/\/api\/users\//, /getBackendV2Url/],
      required: [/persistPendingExpoPushRegistration/, /syncExpoPushTokenRecord/],
    },
  ];

  for (const check of checks) {
    const raw = await readFile(check.file, "utf8");
    for (const pattern of check.forbidden) {
      if (pattern.test(raw)) {
        notes.push(`forbidden_pattern:${check.file}:${pattern.source}`);
      }
    }
    for (const pattern of check.required ?? []) {
      if (!pattern.test(raw)) {
        notes.push(`missing_expected_pattern:${check.file}:${pattern.source}`);
      }
    }
  }

  return {
    ok: notes.length === 0,
    notes,
  };
}

function evaluateFailures(rows: ScenarioRow[], nativeEvents: NativeStartupEvent[]): string[] {
  const failures: string[] = [];
  const byAction = new Map(rows.map((row) => [row.actionName, row] as const));

  for (const row of rows) {
    if (!row.validJson) failures.push(`non_json:${row.actionName}`);
    if (row.statusCode >= 500 && !["deferred_startup_work_check"].includes(row.actionName)) {
      failures.push(`route_500:${row.actionName}:${row.statusCode}`);
    }
  }

  const feedCold = byAction.get("cold_app_open_home_feed");
  if (feedCold) {
    if (feedCold.latencyMs > 500) failures.push(`feed_cold_latency:${feedCold.latencyMs}`);
    if (feedCold.payloadBytes > 35_000) failures.push(`feed_cold_payload:${feedCold.payloadBytes}`);
    if (feedCold.reads > 20) failures.push(`feed_cold_reads:${feedCold.reads}`);
    if (feedCold.poolState === "warm" && feedCold.reads > 5) failures.push(`feed_warm_reads_during_cold:${feedCold.reads}`);
  }

  const feedWarm = byAction.get("warm_home_feed_next_page");
  if (feedWarm) {
    if (feedWarm.payloadBytes > 35_000) failures.push(`feed_next_page_payload:${feedWarm.payloadBytes}`);
    if (feedWarm.reads > 5) failures.push(`feed_next_page_reads:${feedWarm.reads}`);
  }

  const mapCompact = byAction.get("map_open_compact_markers");
  if (mapCompact && mapCompact.payloadBytes > 500_000) {
    failures.push(`map_compact_payload:${mapCompact.payloadBytes}`);
  }

  const playback = byAction.get("post_playback_batch_prefetch");
  if (playback) {
    if (playback.payloadBytes > 35_000) failures.push(`playback_payload:${playback.payloadBytes}`);
    if (playback.latencyMs > 500) failures.push(`playback_latency:${playback.latencyMs}`);
    if (playback.queries > 3) failures.push(`playback_queries:${playback.queries}`);
  }

  const searchHomeBootstrap = byAction.get("search_home_bootstrap");
  if (searchHomeBootstrap?.statusCode && searchHomeBootstrap.statusCode >= 500) {
    failures.push(`search_home_bootstrap_status:${searchHomeBootstrap.statusCode}`);
  }

  const profileSelf = byAction.get("profile_self_open");
  if (profileSelf?.statusCode && profileSelf.statusCode >= 500) failures.push(`profile_self_500:${profileSelf.statusCode}`);
  const profileOther = byAction.get("profile_other_user_open");
  if (profileOther?.statusCode && profileOther.statusCode >= 500) failures.push(`profile_other_500:${profileOther.statusCode}`);
  const suggested = byAction.get("suggested_friends_open");
  if (suggested?.statusCode && suggested.statusCode >= 500) failures.push(`suggested_friends_500:${suggested.statusCode}`);
  if (suggested?.statusCode === 304) failures.push("suggested_friends_304");
  if (suggested && suggested.payloadBytes === 0) failures.push("suggested_friends_empty_body");

  const legacyAudit = byAction.get("legacy_endpoint_cleanup_check");
  if (legacyAudit && legacyAudit.statusCode >= 400) {
    failures.push(`legacy_endpoint_cleanup:${legacyAudit.statusCode}`);
  }

  if (nativeEvents.length > 0) {
    const requestStart = nativeEvents.find((entry) => entry.phase === "first_feed_request_start");
    const renderCommitted = nativeEvents.find((entry) => entry.phase === "first_feed_render_committed");
    if (!requestStart || !renderCommitted) {
      failures.push("native_startup_markers_missing");
    } else {
      const deferredDuringGate = nativeEvents.filter((entry) => {
        if (!entry.ts) return false;
        if (entry.ts <= requestStart.ts! || entry.ts >= renderCommitted.ts!) return false;
        const lane = String(entry.priorityLane ?? "").toLowerCase();
        const path = String(entry.path ?? "");
        return (lane === "p3" || lane === "p4" || lane === "background" || lane === "analytics") && path.length > 0;
      });
      if (deferredDuringGate.length > 0) {
        failures.push(`startup_deferred_before_first_feed_render:${deferredDuringGate.length}`);
      }
    }
  }

  return failures;
}

async function main(): Promise<void> {
  const rows: ScenarioRow[] = [];

  const coldFeed = await callRoute({
    actionName: "cold_app_open_home_feed",
    method: "GET",
    route: `/v2/feed/for-you?viewerId=${encodeURIComponent(VIEWER_ID)}&limit=5&debug=1`,
  });
  rows.push(coldFeed.row);
  printRow(coldFeed.row);

  const feedPostIds = collectFeedPostIds(coldFeed.json);
  const otherUserId = collectOtherUserId(coldFeed.json) ?? OTHER_USER_ID;
  const nextCursor = pickString(coldFeed.json?.data?.nextCursor);

  if (nextCursor) {
    const warmFeed = await callRoute({
      actionName: "warm_home_feed_next_page",
      method: "GET",
      route: `/v2/feed/for-you?viewerId=${encodeURIComponent(VIEWER_ID)}&limit=5&cursor=${encodeURIComponent(nextCursor)}&debug=1`,
    });
    rows.push(warmFeed.row);
    printRow(warmFeed.row);
  }

  for (const actionName of ["search_open_cold", "search_open_warm"] as const) {
    const result = await callRoute({
      actionName,
      method: "GET",
      route: "/v2/search/mixes/bootstrap?limit=8&includeDebug=1",
    });
    rows.push(result.row);
    printRow(result.row);
  }

  const searchHomeBootstrap = await callRoute({
    actionName: "search_home_bootstrap",
    method: "GET",
    route: "/v2/search/home-bootstrap?includeDebug=1",
  });
  rows.push(searchHomeBootstrap.row);
  printRow(searchHomeBootstrap.row);

  const mapCompact = await callRoute({
    actionName: "map_open_compact_markers",
    method: "GET",
    route: "/v2/map/markers?payloadMode=compact",
  });
  rows.push(mapCompact.row);
  printRow(mapCompact.row);

  if (feedPostIds.length > 0) {
    const playback = await callRoute({
      actionName: "post_playback_batch_prefetch",
      method: "POST",
      route: "/v2/posts/details:batch",
      body: {
        postIds: feedPostIds,
        reason: "prefetch",
        hydrationMode: "playback",
      },
    });
    rows.push(playback.row);
    printRow(playback.row);
  }

  for (const [actionName, userId] of [
    ["profile_self_open", VIEWER_ID],
    ["profile_other_user_open", otherUserId],
  ] as const) {
    const profile = await callRoute({
      actionName,
      method: "GET",
      route: `/v2/profiles/${encodeURIComponent(userId)}/bootstrap?gridLimit=12`,
    });
    rows.push(profile.row);
    printRow(profile.row);
  }

  const suggested = await callRoute({
    actionName: "suggested_friends_open",
    method: "GET",
    route: "/v2/social/suggested-friends?surface=generic&limit=50",
  });
  rows.push(suggested.row);
  printRow(suggested.row);

  const legacyAudit = await runLegacyEndpointAudit();
  const legacyRow: ScenarioRow = {
    actionName: "legacy_endpoint_cleanup_check",
    method: "GET",
    route: "<native-source-audit>",
    statusCode: legacyAudit.ok ? 200 : 500,
    latencyMs: 0,
    payloadBytes: legacyAudit.notes.join("\n").length,
    reads: 0,
    writes: 0,
    queries: 0,
    budgetViolations: [],
    validJson: true,
    cacheSource: null,
    poolState: null,
    hydrationMode: null,
    requestGroup: null,
    routePriority: null,
    notes: legacyAudit.ok ? ["legacy_endpoints_clean"] : legacyAudit.notes,
  };
  rows.push(legacyRow);
  printRow(legacyRow);

  const nativeEvents = await loadNativeStartupEvents();
  const deferredRow: ScenarioRow = {
    actionName: "deferred_startup_work_check",
    method: "GET",
    route: NATIVE_TRACE_FILE || "<no-native-trace-file>",
    statusCode: nativeEvents.length > 0 ? 200 : 204,
    latencyMs: 0,
    payloadBytes: nativeEvents.length,
    reads: 0,
    writes: 0,
    queries: 0,
    budgetViolations: [],
    validJson: true,
    cacheSource: null,
    poolState: null,
    hydrationMode: null,
    requestGroup: null,
    routePriority: null,
    notes:
      nativeEvents.length > 0
        ? [`loaded_native_events:${nativeEvents.length}`]
        : ["native_trace_missing: set PERF_NATIVE_TRACE_FILE to validate first-feed scheduling"],
  };
  rows.push(deferredRow);
  printRow(deferredRow);

  const failures = evaluateFailures(rows, nativeEvents);
  await mkdir("docs/perf-results", { recursive: true });
  await writeFile(
    `docs/perf-results/${OUTPUT}.json`,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        viewerId: VIEWER_ID,
        failures,
        rows,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (failures.length > 0) {
    throw new Error(`app_action_trace_failures:${failures.join(";")}`);
  }
}

void main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        baseUrl: BASE_URL,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
