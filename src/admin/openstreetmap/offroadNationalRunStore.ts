import type { LocavaInventoryRoute } from "../../lib/inventory/inventoryLocavaTypes.js";
import type { OffroadAreaContext } from "../../lib/inventory/offroad/sources/nationalOffroadSource.types.js";
import type { StateCoverageDiagnostics } from "../../lib/inventory/offroad/sources/nationalOffroadSource.types.js";

export type OffroadNationalDryRunStatus = "queued" | "running" | "completed" | "failed";

export type OffroadSourceRunCounts = {
  sourceId: string;
  rawFeatures: number;
  routesAccepted: number;
  areasAccepted: number;
  rejected: number;
  hidden: number;
  review: number;
  errors: string[];
};

export type OffroadNationalDryRun = {
  runId: string;
  stateCode: string;
  stateCodes?: string[];
  sourceIds: string[];
  sourceFilter?: "all" | "federal" | "state" | "osm";
  status: OffroadNationalDryRunStatus;
  dryRun: true;
  productionWritesBlocked: true;
  startedAt: string;
  completedAt?: string;
  error?: string;
  bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  chunkCount?: number;
  routesBounds?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  routesFilteredOutOfState?: number;
  coverageSummary?: {
    stateOfficialSourceIds: string[];
    stateOfficialRoutes: number;
    federalRoutes: number;
    osmRoutes: number;
    missingStateOfficial: string[];
    sourceErrors: string[];
    completenessNote: string;
  };
  sourceCounts: OffroadSourceRunCounts[];
  routes: LocavaInventoryRoute[];
  areaContexts: OffroadAreaContext[];
  rejectedCount: number;
  stateCoverageDiagnostics?: StateCoverageDiagnostics;
};

const runs = new Map<string, OffroadNationalDryRun>();
const stateEnabledOverrides = new Map<string, boolean>();
const sourceEnabledOverrides = new Map<string, Map<string, boolean>>();

export function setStateEnabled(stateCode: string, enabled: boolean): void {
  stateEnabledOverrides.set(stateCode.toUpperCase(), enabled);
}

export function isStateEnabled(stateCode: string, registryDefault: boolean): boolean {
  const override = stateEnabledOverrides.get(stateCode.toUpperCase());
  return override ?? registryDefault;
}

export function setSourceEnabled(stateCode: string, sourceId: string, enabled: boolean): void {
  const code = stateCode.toUpperCase();
  if (!sourceEnabledOverrides.has(code)) sourceEnabledOverrides.set(code, new Map());
  sourceEnabledOverrides.get(code)!.set(sourceId, enabled);
}

export function isSourceEnabled(stateCode: string, sourceId: string, defaultEnabled: boolean): boolean {
  const override = sourceEnabledOverrides.get(stateCode.toUpperCase())?.get(sourceId);
  return override ?? defaultEnabled;
}

export function putOffroadNationalRun(run: OffroadNationalDryRun): void {
  runs.set(run.runId, run);
}

export function getOffroadNationalRun(runId: string): OffroadNationalDryRun | null {
  return runs.get(runId) ?? null;
}

export function listOffroadNationalRuns(limit = 50): OffroadNationalDryRun[] {
  return [...runs.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

function runsForState(stateCode: string): OffroadNationalDryRun[] {
  const code = stateCode.toUpperCase();
  return listOffroadNationalRuns(500).filter(
    (r) => r.stateCode === code || r.stateCodes?.includes(code)
  );
}

export function getLatestRunForState(stateCode: string): OffroadNationalDryRun | null {
  return runsForState(stateCode)[0] ?? null;
}

/** Prefer completed all-sources runs with the most routes — avoids empty federal-only runs masking good data. */
export function getBestRunForState(stateCode: string): OffroadNationalDryRun | null {
  const candidates = runsForState(stateCode).filter((r) => r.status === "completed");
  if (candidates.length === 0) return getLatestRunForState(stateCode);

  const scored = candidates.map((run) => {
    let score = run.routes.length;
    if (run.sourceFilter === "all") score += 100_000;
    else if (run.sourceFilter === "state") score += 50_000;
    else if (run.sourceFilter === "federal") score += 1_000;
    if (run.sourceIds.some((id) => id.startsWith("vt_") || id.startsWith("nh_") || id.startsWith("ca_"))) {
      score += 10_000;
    }
    return { run, score };
  });

  scored.sort((a, b) => b.score - a.score || (b.run.completedAt ?? "").localeCompare(a.run.completedAt ?? ""));
  return scored[0]?.run ?? null;
}
