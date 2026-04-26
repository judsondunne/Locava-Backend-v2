import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listRoutePolicies } from "../src/observability/route-policies.js";

type PriorityClassification =
  | "PRIORITY_PASS"
  | "PRIORITY_PASS_STAGED"
  | "PRIORITY_FAIL_P0_BLOCKED_BY_OPTIONAL"
  | "PRIORITY_FAIL_MEDIA_BLOCKS_METADATA"
  | "PRIORITY_FAIL_OPTIONAL_BLOCKS_MUTATION"
  | "PRIORITY_FAIL_WRONG_CACHE_INVALIDATION"
  | "PRIORITY_FAIL_UNBOUNDED_BACKGROUND"
  | "PRIORITY_UNTESTED";

type FullAuditRow = {
  id?: string | null;
  routeName?: string | null;
  nativeSurface?: string | null;
  nativeRef?: string | null;
  classification?: string | null;
  latencyMs?: number | null;
  budgetMs?: number | null;
  payloadBytes?: number | null;
  budgetBytes?: number | null;
  firestoreReads?: number | null;
  firestoreQueries?: number | null;
  budgetViolations?: string[];
  notes?: string[];
};

type PriorityTier = "P0" | "P1" | "P2" | "P3";

type PriorityRow = {
  routeName: string;
  nativeSurface: string;
  nativeRef: string | null;
  tier: PriorityTier;
  classification: PriorityClassification;
  auditClassification: string | null;
  latencyMs: number | null;
  budgetMs: number | null;
  firestoreReads: number | null;
  firestoreQueries: number | null;
  notes: string[];
};

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
const workspaceRoot = path.resolve(backendRoot, "..");
const fullAuditPath = path.join(backendRoot, "tmp", "full-app-v2-audit-report.json");
const reportPath = path.join(backendRoot, "tmp", "v2-priority-orchestration-report.json");
const markdownPath = path.join(workspaceRoot, "docs", "backendv2-priority-orchestration-report-2026-04-25.md");

const P0_ROUTES = new Set([
  "auth.session.get",
  "feed.bootstrap.get",
  "feed.page.get",
  "feed.itemdetail.get",
  "posts.detail.get",
  "map.bootstrap.get",
  "profile.bootstrap.get",
  "search.suggest.get",
  "chats.inbox.get",
  "chats.thread.get",
  "notifications.list.get",
  "achievements.bootstrap.get"
]);

const P1_ROUTES = new Set([
  "posts.like.post",
  "posts.unlike.post",
  "posts.save.post",
  "posts.unsave.post",
  "users.follow.post",
  "users.unfollow.post",
  "comments.create.post",
  "collections.savesheet.get",
  "chats.sendtext.post",
  "notifications.markread.post",
  "notifications.markallread.post",
  "posting.finalize.post",
  "posting.uploadsession.post",
  "posting.mediaregister.post",
  "chats.create_or_get.post",
  "chats.creategroup.post"
]);

function inferTier(routeName: string): PriorityTier {
  if (P0_ROUTES.has(routeName)) return "P0";
  if (P1_ROUTES.has(routeName)) return "P1";
  if (routeName.includes(".leaderboard.") || routeName.includes(".claimables.") || routeName.includes(".hero.")) return "P2";
  return "P3";
}

function classifyRow(routeName: string, row: FullAuditRow | undefined, tier: PriorityTier): { classification: PriorityClassification; notes: string[] } {
  if (!row) {
    return { classification: "PRIORITY_UNTESTED", notes: ["No full-app audit row was found for this native-facing route."] };
  }
  const notes = [...(row.notes ?? [])];
  const auditClassification = String(row.classification ?? "");
  const violations = new Set(row.budgetViolations ?? []);
  if (auditClassification === "PASS" || auditClassification === "PASS_WITH_STAGED_HYDRATION") {
    return {
      classification: auditClassification === "PASS_WITH_STAGED_HYDRATION" ? "PRIORITY_PASS_STAGED" : "PRIORITY_PASS",
      notes
    };
  }
  if (routeName === "posting.finalize.post" && violations.has("latency_p95_exceeded")) {
    notes.unshift("Finalize still waits for canonical publish completion; operation polling exists but critical response latency remains above budget.");
    return { classification: "PRIORITY_FAIL_OPTIONAL_BLOCKS_MUTATION", notes };
  }
  if (routeName === "achievements.bootstrap.get" && (violations.has("db_reads_exceeded") || violations.has("payload_bytes_exceeded"))) {
    notes.unshift("Bootstrap still carries optional achievements snapshot/claimables weight on the first paint path.");
    return { classification: "PRIORITY_FAIL_P0_BLOCKED_BY_OPTIONAL", notes };
  }
  if (routeName === "achievements.claimables.get" && (violations.has("db_reads_exceeded") || violations.has("latency_p95_exceeded"))) {
    notes.unshift("Claimables is lighter after narrowing reads, but it still exceeds the cold-miss budget.");
    return { classification: "PRIORITY_FAIL_UNBOUNDED_BACKGROUND", notes };
  }
  if (tier === "P0" && violations.has("latency_p95_exceeded")) {
    notes.unshift("Critical paint route exceeded the cold latency budget.");
    return { classification: "PRIORITY_FAIL_P0_BLOCKED_BY_OPTIONAL", notes };
  }
  if (tier === "P1" && violations.has("latency_p95_exceeded")) {
    notes.unshift("Interactive mutation/action exceeded the cold latency budget.");
    return { classification: "PRIORITY_FAIL_OPTIONAL_BLOCKS_MUTATION", notes };
  }
  if (violations.has("payload_bytes_exceeded") || violations.has("db_reads_exceeded")) {
    notes.unshift("Background hydration or payload breadth remains above the current orchestration target.");
    return { classification: "PRIORITY_FAIL_UNBOUNDED_BACKGROUND", notes };
  }
  return { classification: "PRIORITY_PASS_STAGED", notes };
}

async function main() {
  const fullAudit = JSON.parse(await fs.readFile(fullAuditPath, "utf8")) as { rows?: FullAuditRow[] };
  const fullRows = fullAudit.rows ?? [];
  const byRouteName = new Map<string, FullAuditRow>();
  for (const row of fullRows) {
    const routeName = typeof row.routeName === "string" ? row.routeName : null;
    if (routeName) byRouteName.set(routeName, row);
  }

  const priorityRows: PriorityRow[] = [];
  for (const policy of listRoutePolicies()) {
    if (policy.priority === "internal_debug") continue;
    const tier = inferTier(policy.routeName);
    const auditRow = byRouteName.get(policy.routeName);
    const { classification, notes } = classifyRow(policy.routeName, auditRow, tier);
    priorityRows.push({
      routeName: policy.routeName,
      nativeSurface: auditRow?.nativeSurface ?? policy.routeName,
      nativeRef: auditRow?.nativeRef ?? null,
      tier,
      classification,
      auditClassification: auditRow?.classification ?? null,
      latencyMs: auditRow?.latencyMs ?? null,
      budgetMs: auditRow?.budgetMs ?? policy.budgets.latency.p95Ms,
      firestoreReads: auditRow?.firestoreReads ?? null,
      firestoreQueries: auditRow?.firestoreQueries ?? null,
      notes
    });
  }

  const counts: Record<string, number> = {};
  for (const row of priorityRows) counts[row.classification] = (counts[row.classification] ?? 0) + 1;
  const report = {
    generatedAt: new Date().toISOString(),
    counts,
    rows: priorityRows
  };

  const lines = [
    "# Backendv2 Priority Orchestration Report (2026-04-25)",
    "",
    "## Summary",
    "",
    ...Object.entries(counts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Rows",
    "",
    "| Route | Tier | Priority status | Full-app audit | Latency | Reads | Queries | Notes |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- |",
    ...priorityRows.map((row) => {
      const note = row.notes.join("; ").replace(/\|/g, "\\|");
      return `| ${row.routeName} | ${row.tier} | ${row.classification} | ${row.auditClassification ?? "n/a"} | ${row.latencyMs ?? "n/a"} | ${row.firestoreReads ?? "n/a"} | ${row.firestoreQueries ?? "n/a"} | ${note || " "} |`;
    })
  ];

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.mkdir(path.dirname(markdownPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownPath, `${lines.join("\n")}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
