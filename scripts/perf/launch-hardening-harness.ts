import { writeFile, mkdir } from "node:fs/promises";

type Step = {
  name: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  requiredKeys: string[];
  firstPaint?: boolean;
};

type StepResult = {
  name: string;
  method: string;
  path: string;
  status: number;
  ok: boolean;
  latencyMs: number;
  payloadBytes: number;
  dbReads: number;
  dbQueries: number;
  dbWrites: number;
  requiredKeysMissing: string[];
};

const BASE_URL = process.env.PERF_BASE_URL ?? "http://127.0.0.1:8080";
const OUTPUT = process.env.PERF_OUTPUT ?? "before";
const VIEWER_ID = process.env.PERF_VIEWER_ID ?? "internal-viewer-001";

const FIRST_PAINT_READ_BUDGET = 40;
const FIRST_PAINT_MAX_MS = 800;

function hasPath(obj: unknown, dotted: string): boolean {
  const parts = dotted.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object" || !(p in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[p];
  }
  return true;
}

async function callStep(step: Step): Promise<StepResult> {
  const started = Date.now();
  const res = await fetch(`${BASE_URL}${step.path}`, {
    method: step.method,
    headers: {
      "content-type": "application/json",
      "x-viewer-id": VIEWER_ID,
      "x-viewer-roles": "internal"
    },
    body: step.body ? JSON.stringify(step.body) : undefined
  });
  const text = await res.text();
  const latencyMs = Date.now() - started;
  const payloadBytes = Buffer.byteLength(text, "utf8");
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Keep shape checks strict.
  }
  const data = (json.data ?? {}) as Record<string, unknown>;
  const meta = (json.meta ?? {}) as Record<string, unknown>;
  const db = (meta.db ?? {}) as Record<string, unknown>;
  const requiredKeysMissing = step.requiredKeys.filter((k) => !hasPath(data, k));
  return {
    name: step.name,
    method: step.method,
    path: step.path,
    status: res.status,
    ok: Boolean(json.ok) && res.status < 400,
    latencyMs,
    payloadBytes,
    dbReads: Number(db.reads ?? 0),
    dbQueries: Number(db.queries ?? 0),
    dbWrites: Number(db.writes ?? 0),
    requiredKeysMissing
  };
}

async function main(): Promise<void> {
  const steps: Step[] = [
    { name: "auth-session", method: "GET", path: "/v2/auth/session", requiredKeys: ["firstRender.viewer.id", "firstRender.session.state"] },
    { name: "feed-bootstrap-following", method: "GET", path: "/v2/feed/bootstrap?tab=following&limit=5", requiredKeys: ["firstRender.feed.items"], firstPaint: true },
    { name: "feed-page-following", method: "GET", path: "/v2/feed/page?tab=following&limit=5", requiredKeys: ["items"], firstPaint: true },
    { name: "feed-for-you", method: "GET", path: "/v2/feed/for-you?limit=5&debug=1", requiredKeys: ["items", "debug"], firstPaint: true },
    { name: "profile-bootstrap", method: "GET", path: `/v2/profiles/${encodeURIComponent(VIEWER_ID)}/bootstrap?gridLimit=6`, requiredKeys: ["firstRender.profile", "firstRender.gridPreview.items"], firstPaint: true },
    { name: "suggested-friends", method: "GET", path: "/v2/social/suggested-friends?surface=generic&limit=8", requiredKeys: ["users", "page"] },
    { name: "achievements-bootstrap", method: "GET", path: "/v2/achievements/bootstrap", requiredKeys: ["hero", "snapshot"] },
    { name: "achievements-snapshot", method: "GET", path: "/v2/achievements/snapshot", requiredKeys: ["snapshot"] },
    {
      name: "contacts-sync-small",
      method: "POST",
      path: "/v2/social/contacts/sync",
      body: { contacts: [{ phoneNumbers: ["+1 (650) 704-6433"], emails: ["nobody@example.com"] }] },
      requiredKeys: ["matchedUsers", "matchedCount"]
    },
    { name: "compat-analytics", method: "POST", path: "/api/analytics/v2/events", body: { events: [] }, requiredKeys: [] },
    { name: "compat-config-version", method: "GET", path: "/api/config/version", requiredKeys: [] },
    { name: "compat-product-viewer", method: "PATCH", path: "/api/v1/product/viewer", body: {}, requiredKeys: [] }
  ];

  const results: StepResult[] = [];
  const failures: string[] = [];
  const discoveredPostIds: string[] = [];
  for (const step of steps) {
    const row = await callStep(step);
    results.push(row);
    if (step.name === "feed-bootstrap-following" || step.name === "feed-page-following" || step.name === "feed-for-you") {
      const res = await fetch(`${BASE_URL}${step.path}`, {
        method: step.method,
        headers: { "x-viewer-id": VIEWER_ID, "x-viewer-roles": "internal" }
      });
      const json = (await res.json()) as Record<string, unknown>;
      const data = (json.data ?? {}) as Record<string, unknown>;
      const rows = step.name === "feed-bootstrap-following"
        ? ((((data.firstRender as Record<string, unknown> | undefined)?.feed as Record<string, unknown> | undefined)?.items as unknown[]) ?? [])
        : (((data.items as unknown[]) ?? []));
      for (const r of rows as Array<Record<string, unknown>>) {
        const postId = typeof r.postId === "string" ? r.postId : "";
        if (postId) discoveredPostIds.push(postId);
      }
    }
    if (row.status >= 500 || row.status === 404) failures.push(`route_failed:${step.name}:${row.status}`);
    if (row.requiredKeysMissing.length > 0) failures.push(`shape_failed:${step.name}:${row.requiredKeysMissing.join(",")}`);
    if (step.firstPaint && row.dbReads > FIRST_PAINT_READ_BUDGET) failures.push(`budget_reads_failed:${step.name}:${row.dbReads}`);
    if (step.firstPaint && row.latencyMs > FIRST_PAINT_MAX_MS) failures.push(`budget_latency_failed:${step.name}:${row.latencyMs}`);
  }

  const uniquePostIds = [...new Set(discoveredPostIds)].slice(0, 3);
  if (uniquePostIds.length > 0) {
    const detailStep: Step = {
      name: "posts-detail",
      method: "GET",
      path: `/v2/posts/${encodeURIComponent(uniquePostIds[0]!)}/detail`,
      requiredKeys: ["firstRender.post"]
    };
    const detailRow = await callStep(detailStep);
    results.push(detailRow);
    if (detailRow.status >= 500 || detailRow.status === 404) failures.push(`route_failed:${detailStep.name}:${detailRow.status}`);
    if (detailRow.requiredKeysMissing.length > 0) failures.push(`shape_failed:${detailStep.name}:${detailRow.requiredKeysMissing.join(",")}`);

    const batchStep: Step = {
      name: "posts-detail-batch-playback",
      method: "POST",
      path: "/v2/posts/details:batch",
      body: { postIds: uniquePostIds, reason: "prefetch", hydrationMode: "playback" },
      requiredKeys: ["found"]
    };
    const batchRow = await callStep(batchStep);
    results.push(batchRow);
    if (batchRow.status >= 500 || batchRow.status === 404) failures.push(`route_failed:${batchStep.name}:${batchRow.status}`);
    if (batchRow.requiredKeysMissing.length > 0) failures.push(`shape_failed:${batchStep.name}:${batchRow.requiredKeysMissing.join(",")}`);
  } else {
    failures.push("posts_detail_seed_missing:no_feed_post_ids");
  }

  const output = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    viewerId: VIEWER_ID,
    failures,
    results
  };

  await mkdir("docs/perf-results", { recursive: true });
  await writeFile(`docs/perf-results/${OUTPUT}.json`, JSON.stringify(output, null, 2), "utf8");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ output: `docs/perf-results/${OUTPUT}.json`, count: results.length, failures }, null, 2));
  if (failures.length > 0) {
    throw new Error(`harness_failures:${failures.join(";")}`);
  }
}

void main();
