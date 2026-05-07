import fs from "node:fs";
import path from "node:path";

type Method = "GET" | "POST";
type Priority = "P0" | "P1" | "P2" | "P3";

type RouteSpec = {
  id: string;
  method: Method;
  path: string;
  priority: Priority;
  body?: unknown;
  requiredKeys?: string[];
};

type AuditRow = {
  id: string;
  method: Method;
  path: string;
  status: number;
  latencyMs: number;
  payloadBytes: number;
  requestId: string | null;
  routeName: string | null;
  reads: number;
  queries: number;
  budgetViolations: string[];
  requiredShapeOk: boolean;
  data?: any;
};

const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const viewerId = process.env.TEST_VIEWER_ID ?? "internal-viewer";
const profileUserId = process.env.PROFILE_USER_ID ?? viewerId;
const authToken = process.env.AUTH_TOKEN?.trim() || "";

function budgets(priority: Priority) {
  if (priority === "P0") return { latencyWarmMs: 400, latencyColdMs: 900, payloadBytes: 120 * 1024, reads: 40, queries: 5 };
  if (priority === "P1") return { latencyWarmMs: 300, latencyColdMs: 700, payloadBytes: 80 * 1024, reads: 10, queries: 4 };
  if (priority === "P2") return { latencyWarmMs: 500, latencyColdMs: 1000, payloadBytes: 250 * 1024, reads: 25, queries: 5 };
  return { latencyWarmMs: 1500, latencyColdMs: 1500, payloadBytes: 100 * 1024, reads: 100, queries: 10 };
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function callRoute(spec: RouteSpec): Promise<AuditRow> {
  const started = Date.now();
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-viewer-id": viewerId,
    "x-viewer-roles": "internal",
    "x-client-session-id": "audit-production-readiness",
    "x-client-request-id": `${spec.id}-${Date.now()}`,
    "x-client-sent-at-ms": String(Date.now()),
    "x-client-route-name": spec.id,
    "x-client-surface": "production_readiness_audit",
    "x-client-build-profile": "production",
    "x-client-platform": "ios",
    "x-client-app-version": "audit-script"
  };
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  if (spec.method === "POST") headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${spec.path}`, {
    method: spec.method,
    headers,
    body: spec.method === "POST" ? JSON.stringify(spec.body ?? {}) : undefined
  });
  const latencyMs = Date.now() - started;
  const text = await response.text();
  const payloadBytes = Buffer.byteLength(text, "utf8");
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const data = parsed?.data ?? null;
  const db = parsed?.meta?.db ?? { reads: 0, queries: 0 };
  const requiredShapeOk = Array.isArray(spec.requiredKeys)
    ? spec.requiredKeys.every((key) => data && Object.prototype.hasOwnProperty.call(data, key))
    : true;
  const routeBudgetViolations: string[] = [];
  const budget = budgets(spec.priority);
  if (latencyMs > budget.latencyColdMs) routeBudgetViolations.push("latency_exceeded");
  if (payloadBytes > budget.payloadBytes) routeBudgetViolations.push("payload_bytes_exceeded");
  if ((db.reads ?? 0) > budget.reads) routeBudgetViolations.push("db_reads_exceeded");
  if ((db.queries ?? 0) > budget.queries) routeBudgetViolations.push("db_queries_exceeded");
  if (!requiredShapeOk) routeBudgetViolations.push("shape_missing_required_fields");
  return {
    id: spec.id,
    method: spec.method,
    path: spec.path,
    status: response.status,
    latencyMs,
    payloadBytes,
    requestId: response.headers.get("x-backend-request-id"),
    routeName: response.headers.get("x-backend-route-name"),
    reads: Number(db.reads ?? 0),
    queries: Number(db.queries ?? 0),
    budgetViolations: routeBudgetViolations,
    requiredShapeOk,
    data,
  };
}

async function main() {
  const rows: AuditRow[] = [];
  const pushRoute = async (route: RouteSpec): Promise<AuditRow> => {
    const row = await callRoute(route);
    rows.push(row);
    return row;
  };

  await pushRoute({ id: "auth.session", method: "GET", path: "/v2/auth/session", priority: "P2", requiredKeys: ["routeName"] });
  const feedFirst = await pushRoute({ id: "feed.first", method: "GET", path: "/v2/feed/for-you/simple?limit=5", priority: "P0", requiredKeys: ["items"] });
  const feedItems = Array.isArray(feedFirst.data?.items) ? feedFirst.data.items : [];
  const nextCursor =
    typeof feedFirst.data?.nextCursor === "string" && feedFirst.data.nextCursor.trim().length > 0
      ? feedFirst.data.nextCursor.trim()
      : null;
  const firstPostId =
    typeof process.env.TEST_POST_ID === "string" && process.env.TEST_POST_ID.trim().length > 0
      ? process.env.TEST_POST_ID.trim()
      : typeof feedItems[0]?.postId === "string" && feedItems[0].postId.trim().length > 0
        ? feedItems[0].postId.trim()
        : "post_1";
  if (nextCursor) {
    await pushRoute({
      id: "feed.next",
      method: "GET",
      path: `/v2/feed/for-you/simple?limit=5&cursor=${encodeURIComponent(nextCursor)}`,
      priority: "P1",
      requiredKeys: ["items"],
    });
  }
  await pushRoute({
    id: "posts.details.batch",
    method: "POST",
    path: "/v2/posts/details:batch",
    priority: "P1",
    body: { postIds: [firstPostId], reason: "prefetch", hydrationMode: "playback", mode: "playback_prefetch_compact" },
    requiredKeys: ["found"],
  });
  await pushRoute({ id: "post.detail", method: "GET", path: `/v2/posts/${encodeURIComponent(firstPostId)}/detail`, priority: "P1" });
  await pushRoute({ id: "profile.bootstrap.6", method: "GET", path: `/v2/profiles/${encodeURIComponent(profileUserId)}/bootstrap?gridLimit=6`, priority: "P2", requiredKeys: ["firstRender"] });
  await pushRoute({ id: "profile.bootstrap.18", method: "GET", path: `/v2/profiles/${encodeURIComponent(profileUserId)}/bootstrap?gridLimit=18`, priority: "P2", requiredKeys: ["firstRender"] });
  await pushRoute({ id: "profile.followers", method: "GET", path: `/v2/profiles/${encodeURIComponent(profileUserId)}/followers?limit=50`, priority: "P3" });
  await pushRoute({ id: "profile.following", method: "GET", path: `/v2/profiles/${encodeURIComponent(profileUserId)}/following?limit=50`, priority: "P3" });
  await pushRoute({ id: "social.suggested.generic", method: "GET", path: "/v2/social/suggested-friends?surface=generic&limit=12", priority: "P3", requiredKeys: ["users"] });
  await pushRoute({ id: "social.suggested.onboarding", method: "GET", path: "/v2/social/suggested-friends?surface=onboarding&limit=20", priority: "P3", requiredKeys: ["users"] });
  await pushRoute({ id: "collections.list", method: "GET", path: "/v2/collections?limit=50", priority: "P3" });
  await pushRoute({ id: "search.bootstrap", method: "GET", path: "/v2/search/home-bootstrap", priority: "P2" });
  await pushRoute({ id: "directory.users", method: "GET", path: "/v2/directory/users?limit=20", priority: "P3" });
  await pushRoute({ id: "map.bootstrap", method: "GET", path: "/v2/map/bootstrap?limit=120", priority: "P3" });
  await pushRoute({ id: "map.markers", method: "GET", path: "/v2/map/markers?limit=120", priority: "P3" });
  await pushRoute({ id: "chats.inbox", method: "GET", path: "/v2/chats/inbox?limit=20", priority: "P3" });
  await pushRoute({ id: "telemetry.ingest", method: "POST", path: "/api/analytics/v2/events", priority: "P3", body: { events: [] } });

  const failures: string[] = [];
  for (const row of rows) {
    if (row.status >= 500 && row.id !== "telemetry.ingest") failures.push(`${row.id}: returned ${row.status}`);
    if (row.id === "profile.followers" && row.status === 503) failures.push("profile.followers returned 503");
    if (row.id === "profile.bootstrap.18" && row.payloadBytes > 1_000_000) failures.push("profile.bootstrap.18 exceeded 1MB");
    if (row.id === "feed.first" && (row.payloadBytes > 1_000_000 || row.reads > 100)) {
      failures.push("feed.first exceeded hard cap (1MB or >100 reads)");
    }
    if ((row.id === "feed.first" || row.id === "posts.details.batch") && row.budgetViolations.includes("payload_bytes_exceeded")) {
      failures.push(`${row.id} violated payload budget`);
    }
    if (row.id === "telemetry.ingest" && row.status >= 500) failures.push("telemetry endpoint unavailable");
    if (!row.requiredShapeOk) failures.push(`${row.id} response shape missing required fields`);
  }

  const reportLines: string[] = [];
  reportLines.push("# Production Readiness Report (Latest)");
  reportLines.push("");
  reportLines.push(`Generated: ${new Date().toISOString()}`);
  reportLines.push(`Base URL: \`${baseUrl}\``);
  reportLines.push(`Viewer: \`${viewerId}\``);
  reportLines.push("");
  reportLines.push("| Route | Status | Latency(ms) | Payload(bytes) | Reads | Queries | Violations |");
  reportLines.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of rows) {
    reportLines.push(
      `| \`${row.id}\` | ${row.status} | ${row.latencyMs} | ${row.payloadBytes} | ${row.reads} | ${row.queries} | ${row.budgetViolations.join(", ") || "none"} |`
    );
  }
  reportLines.push("");
  reportLines.push("## Hard Failures");
  if (failures.length === 0) {
    reportLines.push("- none");
  } else {
    for (const f of failures) reportLines.push(`- ${f}`);
  }
  reportLines.push("");
  const reportPath = path.resolve(process.cwd(), "docs/production-readiness-report-latest.md");
  ensureDir(reportPath);
  fs.writeFileSync(reportPath, `${reportLines.join("\n")}\n`, "utf8");
  process.stdout.write(`${reportLines.join("\n")}\n`);
  if (failures.length > 0) process.exit(1);
}

await main();
