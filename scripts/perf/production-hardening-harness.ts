import { writeFile, mkdir } from "node:fs/promises";

type Envelope = {
  ok?: boolean;
  data?: Record<string, unknown>;
  meta?: {
    db?: { reads?: number; writes?: number; queries?: number };
    budgetViolations?: string[];
    latencyMs?: number;
  };
  error?: { code?: string; message?: string };
};

type ScenarioRow = {
  scenario: string;
  route: string;
  method: string;
  latencyMs: number;
  statusCode: number;
  payloadBytes: number;
  reads: number;
  writes: number;
  queries: number;
  budgetViolations: string[];
  validJson: boolean;
  poolState: string | null;
};

const BASE_URL = process.env.PERF_BASE_URL ?? "http://127.0.0.1:8080";
const VIEWER_ID = process.env.PERF_VIEWER_ID ?? "internal-viewer-001";
const OUTPUT = process.env.PERF_OUTPUT ?? "production-hardening";

async function callRoute(input: {
  scenario: string;
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
  return {
    row: {
      scenario: input.scenario,
      route: input.route,
      method: input.method,
      latencyMs,
      statusCode: response.status,
      payloadBytes,
      reads: Number(parsed?.meta?.db?.reads ?? 0),
      writes: Number(parsed?.meta?.db?.writes ?? 0),
      queries: Number(parsed?.meta?.db?.queries ?? 0),
      budgetViolations: Array.isArray(parsed?.meta?.budgetViolations) ? parsed!.meta!.budgetViolations! : [],
      validJson,
      poolState:
        typeof parsed?.data?.poolState === "string"
          ? String(parsed.data.poolState)
          : typeof parsed?.data?.diagnostics?.["poolState"] === "string"
            ? String(parsed.data.diagnostics["poolState"])
            : null,
    },
    json: parsed,
  };
}

function printRows(rows: ScenarioRow[]): void {
  for (const row of rows) {
    console.log(
      JSON.stringify(
        {
          scenario: row.scenario,
          route: row.route,
          method: row.method,
          latencyMs: row.latencyMs,
          statusCode: row.statusCode,
          payloadBytes: row.payloadBytes,
          reads: row.reads,
          writes: row.writes,
          queries: row.queries,
          budgetViolations: row.budgetViolations,
          validJson: row.validJson,
          poolState: row.poolState,
        },
        null,
        2
      )
    );
  }
}

async function main(): Promise<void> {
  const rows: ScenarioRow[] = [];

  const config = await callRoute({
    scenario: "cold_app_startup_simulation",
    method: "GET",
    route: "/api/config/version",
  });
  rows.push(config.row);

  const session = await callRoute({
    scenario: "cold_app_startup_simulation",
    method: "GET",
    route: "/v2/auth/session",
  });
  rows.push(session.row);

  const feed = await callRoute({
    scenario: "cold_app_startup_simulation",
    method: "GET",
    route: "/v2/feed/for-you?limit=5&debug=1",
  });
  rows.push(feed.row);

  const feedJson = feed.json;
  const feedPostIds = Array.isArray(feedJson?.data?.items)
    ? feedJson!.data!.items!
        .map((item) => String((item as { postId?: unknown }).postId ?? "").trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const warmFeed = await callRoute({
    scenario: "warm_app_startup_simulation",
    method: "GET",
    route: "/v2/feed/for-you?limit=5&debug=1",
  });
  rows.push(warmFeed.row);

  const coldMixRoutes = [
    "/v2/mixes/hiking/preview?activity=hiking&limit=3",
    "/v2/mixes/park/preview?activity=park&limit=3",
    "/v2/mixes/beach/preview?activity=beach&limit=3",
    "/v2/mixes/cafe/preview?activity=cafe&limit=3",
  ];
  const coldMixes = await Promise.all(
    coldMixRoutes.map((route) =>
      callRoute({
        scenario: "search_page_cold_pool_open",
        method: "GET",
        route,
      })
    )
  );
  rows.push(...coldMixes.map((result) => result.row));

  const warmMixes = await Promise.all(
    coldMixRoutes.map((route) =>
      callRoute({
        scenario: "search_page_warm_pool_open",
        method: "GET",
        route,
      })
    )
  );
  rows.push(...warmMixes.map((result) => result.row));

  const profileA = await callRoute({
    scenario: "profile_open_twice",
    method: "GET",
    route: `/v2/profiles/${encodeURIComponent(VIEWER_ID)}/bootstrap?gridLimit=12`,
  });
  const profileB = await callRoute({
    scenario: "profile_open_twice",
    method: "GET",
    route: `/v2/profiles/${encodeURIComponent(VIEWER_ID)}/bootstrap?gridLimit=12`,
  });
  rows.push(profileA.row, profileB.row);

  if (feedPostIds.length > 0) {
    const detailsBatch = await callRoute({
      scenario: "batch_post_detail_prefetch",
      method: "POST",
      route: "/v2/posts/details:batch",
      body: {
        postIds: feedPostIds,
        reason: "prefetch",
        hydrationMode: "playback",
      },
    });
    rows.push(detailsBatch.row);
  }

  await mkdir("docs/perf-results", { recursive: true });
  await writeFile(
    `docs/perf-results/${OUTPUT}.json`,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        viewerId: VIEWER_ID,
        rows,
      },
      null,
      2
    ),
    "utf8"
  );
  printRows(rows);
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
      2
    )
  );
  process.exitCode = 1;
});
