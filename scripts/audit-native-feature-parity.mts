import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type NativeActionRecord = {
  id: string;
  surface: string;
  file: string;
  line: number;
  functionName: string | null;
  routeName: string | null;
  priority: "P0" | "P1" | "P2" | "P3" | "UNKNOWN";
  classification:
    | "COVERED_FULL_AUDIT"
    | "COVERED_SEMANTIC"
    | "COVERED_ROUTE_TEST"
    | "COVERED_MANUAL_ONLY"
    | "UNCOVERED_BACKEND_ACTION"
    | "UNCOVERED_NATIVE_ACTION"
    | "INTENTIONAL_DISABLED"
    | "INTENTIONAL_LEGACY"
    | "STALE_V1_CALL"
    | "DOUBLE_FETCH_RISK"
    | "UNKNOWN";
};

type NativeCoverageReport = {
  generatedAt: string;
  summary: Record<string, number>;
  actions: NativeActionRecord[];
};

type FullAuditReport = {
  summary?: Record<string, number>;
  rows?: Array<{
    id: string;
    routeName: string | null;
    classification: string;
  }>;
};

type SemanticsReport = {
  summary?: Record<string, number>;
  results?: Array<{
    route: string;
    classification: string;
  }>;
};

type SearchReport = {
  summary?: Record<string, number>;
};

type ParitySummary = {
  generatedAt: string;
  nativeActions: number;
  p0p1Actions: number;
  staleV1Callers: number;
  doubleFetchRisks: number;
  uncoveredBackendActionsP0P1: number;
  uncoveredNativeActionsP0P1: number;
  unknownP0P1: number;
  semanticFailures: number;
  searchFailures: number;
  fullAuditBlockersP0P1: number;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
const reportPath = path.join(backendRoot, "tmp", "native-feature-parity-report.json");

async function readJson<T>(inputPath: string): Promise<T> {
  return JSON.parse(await fs.readFile(inputPath, "utf8")) as T;
}

function isP0P1(priority: string): boolean {
  return priority === "P0" || priority === "P1";
}

function routeNameLikelyP0P1(routeName: string | null): boolean {
  if (!routeName) return false;
  return /^(auth|feed|search|map|profile|posts|posting|comments|collections|notifications|chats|social|achievements)\./.test(routeName);
}

async function main() {
  const nativeCoverage = await readJson<NativeCoverageReport>(path.join(backendRoot, "tmp", "native-action-coverage-report.json"));
  const fullAudit = await readJson<FullAuditReport>(path.join(backendRoot, "tmp", "full-app-v2-audit-report.json"));
  const semantics = await readJson<SemanticsReport>(path.join(backendRoot, "tmp", "real-user-v2-semantics-report.json"));
  const search = await readJson<SearchReport>(path.join(backendRoot, "tmp", "search-v2-parity-long-run-report.json"));

  const p0p1Actions = nativeCoverage.actions.filter((action) => isP0P1(action.priority));
  const staleV1Callers = nativeCoverage.actions.filter((action) => action.classification === "STALE_V1_CALL");
  const doubleFetchRisks = nativeCoverage.actions.filter((action) => action.classification === "DOUBLE_FETCH_RISK");
  const uncoveredBackendActionsP0P1 = p0p1Actions.filter((action) => action.classification === "UNCOVERED_BACKEND_ACTION");
  const uncoveredNativeActionsP0P1 = p0p1Actions.filter((action) => action.classification === "UNCOVERED_NATIVE_ACTION");
  const unknownP0P1 = p0p1Actions.filter((action) => action.classification === "UNKNOWN");
  const semanticFailures = Number(semantics.summary?.SEMANTIC_FAIL_WRONG_OWNER ?? 0)
    + Number(semantics.summary?.SEMANTIC_FAIL_MISSING_DOC ?? 0)
    + Number(semantics.summary?.SEMANTIC_FAIL_FAKE_DATA ?? 0)
    + Number(semantics.summary?.SEMANTIC_FAIL_WRONG_ACTIVITY ?? 0)
    + Number(semantics.summary?.SEMANTIC_FAIL_WRONG_COLLECTION_TYPE ?? 0)
    + Number(semantics.summary?.SEMANTIC_FAIL_DUPLICATE ?? 0)
    + Number(semantics.summary?.SEMANTIC_FAIL_CURSOR ?? 0)
    + Number(semantics.summary?.SEMANTIC_FAIL_MUTATION_NOT_PERSISTED ?? 0)
    + Number(semantics.summary?.SEMANTIC_FAIL_DEEP_LINK ?? 0);
  const searchFailures = Object.entries(search.summary ?? {})
    .filter(([key, count]) => key.startsWith("SEARCH_FAIL_") && Number(count) > 0)
    .reduce((sum, [, count]) => sum + Number(count), 0);
  const fullAuditBlockersP0P1 = (fullAudit.rows ?? []).filter((row) => {
    if (!routeNameLikelyP0P1(row.routeName)) return false;
    return /^BROKEN_|^MISSING_/.test(row.classification);
  }).length;

  const summary: ParitySummary = {
    generatedAt: new Date().toISOString(),
    nativeActions: nativeCoverage.actions.length,
    p0p1Actions: p0p1Actions.length,
    staleV1Callers: staleV1Callers.length,
    doubleFetchRisks: doubleFetchRisks.length,
    uncoveredBackendActionsP0P1: uncoveredBackendActionsP0P1.length,
    uncoveredNativeActionsP0P1: uncoveredNativeActionsP0P1.length,
    unknownP0P1: unknownP0P1.length,
    semanticFailures,
    searchFailures,
    fullAuditBlockersP0P1,
  };

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(summary, null, 2));

  console.log(JSON.stringify(summary, null, 2));

  if (
    summary.staleV1Callers > 0 ||
    summary.doubleFetchRisks > 0 ||
    summary.uncoveredBackendActionsP0P1 > 0 ||
    summary.uncoveredNativeActionsP0P1 > 0 ||
    summary.unknownP0P1 > 0 ||
    summary.semanticFailures > 0 ||
    summary.searchFailures > 0 ||
    summary.fullAuditBlockersP0P1 > 0
  ) {
    process.exitCode = 1;
  }
}

await main();
