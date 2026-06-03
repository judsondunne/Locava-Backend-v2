import {
  isFirestoreEmulatorActiveForOsmNational,
  isOsmNationalProductionWriteUnlocked,
  type OsmNationalWriteTarget,
} from "../osmNationalWriteGuard.js";
import { planCopierTiles } from "./osmNationalCopierPlanner.js";
import {
  copierBuildRunId,
  getCopierRun,
  listCopierEvents,
  listCopierRuns,
  putCopierRun,
} from "./osmNationalCopierProgressStore.js";
import {
  copierProductionConfirmationPhrase,
  copierProductionEnvVarName,
  evaluateCopierStartGuard,
  OSM_NATIONAL_COPIER_ALLOWED_COLLECTIONS,
  OSM_NATIONAL_COPIER_FORBIDDEN_COLLECTIONS,
} from "./osmNationalCopierGuards.js";
import {
  processCopierTile,
  runCopierLoop,
} from "./osmNationalCopierRunner.js";
import {
  DEFAULT_OSM_NATIONAL_COPIER_CONFIG,
  emptyCopierMetrics,
  type OsmNationalCopierConfig,
  type OsmNationalCopierMode,
  type OsmNationalCopierRun,
  type OsmNationalCopierTileRecord,
} from "./osmNationalCopierTypes.js";

export type CopierPlanInput = {
  mode: OsmNationalCopierMode;
  writeTarget?: OsmNationalWriteTarget;
  confirmProductionWrite?: string;
  config?: Partial<OsmNationalCopierConfig>;
  /** Test-only knob — caps planner to N tiles. Never exposed by the routes. */
  maxTiles?: number;
};

export function buildCopierConfig(
  partial: Partial<OsmNationalCopierConfig> | undefined
): OsmNationalCopierConfig {
  return { ...DEFAULT_OSM_NATIONAL_COPIER_CONFIG, ...(partial ?? {}) };
}

function shapeRun(input: {
  mode: OsmNationalCopierMode;
  writeTarget: OsmNationalWriteTarget;
  confirmProductionWrite?: string;
  config: OsmNationalCopierConfig;
  tiles: OsmNationalCopierTileRecord["tile"][];
}): OsmNationalCopierRun {
  const now = new Date().toISOString();
  const tiles: OsmNationalCopierTileRecord[] = input.tiles.map((tile) => ({
    tile,
    status: "pending",
    attempts: 0,
    acceptedSpots: 0,
    acceptedRoutes: 0,
    rejectedSkipped: 0,
    duplicatesSkipped: 0,
    existingSkipped: 0,
    invalidSkipped: 0,
    writtenSpots: 0,
    writtenRoutes: 0,
  }));
  const writeMode = input.mode === "write";
  return {
    runId: copierBuildRunId(),
    mode: input.mode,
    status: "created",
    phase: "idle",
    writeMode,
    writeTarget: writeMode ? input.writeTarget : "none",
    confirmProductionWrite: input.confirmProductionWrite,
    config: input.config,
    tiles,
    metrics: { ...emptyCopierMetrics(), chunksTotal: tiles.length },
    previewDocs: [],
    currentTileId: null,
    currentStateCode: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    lastError: null,
    dryRunLimitReached: false,
    rejectedReasonSamples: [],
    acceptedActivitySamples: [],
    missingMetadataWarnings: [],
  };
}

export function planCopierRun(input: CopierPlanInput): OsmNationalCopierRun {
  const config = buildCopierConfig(input.config);
  const writeTarget: OsmNationalWriteTarget =
    input.mode === "write" ? input.writeTarget ?? "none" : "none";

  const guard = evaluateCopierStartGuard({
    mode: input.mode,
    writeTarget,
    confirmProductionWrite: input.confirmProductionWrite,
    config,
  });
  if (!guard.ok) {
    const error = new Error(`${guard.code}:${guard.message}`);
    (error as Error & { code?: string }).code = guard.code;
    throw error;
  }

  const plan = planCopierTiles({
    config,
    stateCodes: config.stateCodes,
    maxTiles: input.maxTiles,
  });

  const run = shapeRun({
    mode: input.mode,
    writeTarget,
    confirmProductionWrite: input.confirmProductionWrite,
    config,
    tiles: plan.tiles,
  });
  putCopierRun(run);
  return run;
}

export async function dryRunFirstAccepted(input: {
  config?: Partial<OsmNationalCopierConfig>;
  maxChunksToScan?: number;
}): Promise<OsmNationalCopierRun> {
  const config = buildCopierConfig({
    ...(input.config ?? {}),
    maxChunksToProcess: input.maxChunksToScan ?? input.config?.maxChunksToProcess ?? null,
  });
  const run = planCopierRun({
    mode: "dry_run_preview",
    writeTarget: "none",
    config,
    maxTiles: input.maxChunksToScan ?? undefined,
  });
  run.status = "running";
  putCopierRun(run);
  return runCopierLoop(run.runId);
}

export async function startCopierRun(runId: string): Promise<OsmNationalCopierRun> {
  const run = getCopierRun(runId);
  if (!run) throw new Error(`copier_run_not_found:${runId}`);
  if (run.status === "running") return run;
  if (run.status === "cancelled" || run.status === "completed") {
    throw new Error(`run_not_startable:${run.status}`);
  }
  run.status = "running";
  putCopierRun(run);
  return runCopierLoop(runId);
}

export function pauseCopierRun(runId: string): OsmNationalCopierRun {
  const run = getCopierRun(runId);
  if (!run) throw new Error(`copier_run_not_found:${runId}`);
  if (run.status === "completed" || run.status === "cancelled") return run;
  run.status = "paused";
  run.phase = "paused";
  putCopierRun(run);
  return run;
}

export function resumeCopierRun(runId: string): Promise<OsmNationalCopierRun> {
  const run = getCopierRun(runId);
  if (!run) throw new Error(`copier_run_not_found:${runId}`);
  if (run.status === "completed" || run.status === "cancelled") {
    throw new Error(`run_not_resumable:${run.status}`);
  }
  run.status = "running";
  putCopierRun(run);
  return runCopierLoop(runId);
}

export function cancelCopierRun(runId: string): OsmNationalCopierRun {
  const run = getCopierRun(runId);
  if (!run) throw new Error(`copier_run_not_found:${runId}`);
  run.status = "cancelled";
  run.phase = "failed";
  run.finishedAt = new Date().toISOString();
  putCopierRun(run);
  return run;
}

export function getCopierRunDetail(runId: string): OsmNationalCopierRun | null {
  return getCopierRun(runId);
}

export function listCopierRunsSummary(limit = 20): OsmNationalCopierRun[] {
  return listCopierRuns(limit);
}

export function listCopierEventsForRun(runId: string, limit = 100) {
  return listCopierEvents(runId, limit);
}

export function exportCopierRun(runId: string) {
  const run = getCopierRun(runId);
  if (!run) return null;
  return {
    runId: run.runId,
    mode: run.mode,
    status: run.status,
    phase: run.phase,
    config: run.config,
    metrics: run.metrics,
    rejectedReasonSamples: run.rejectedReasonSamples,
    acceptedActivitySamples: run.acceptedActivitySamples,
    missingMetadataWarnings: run.missingMetadataWarnings,
    previewDocs: run.previewDocs,
    tiles: run.tiles.map((t) => ({
      tileId: t.tile.tileId,
      stateCode: t.tile.stateCode,
      status: t.status,
      acceptedSpots: t.acceptedSpots,
      acceptedRoutes: t.acceptedRoutes,
      writtenSpots: t.writtenSpots,
      writtenRoutes: t.writtenRoutes,
      rejectedSkipped: t.rejectedSkipped,
      duplicatesSkipped: t.duplicatesSkipped,
      existingSkipped: t.existingSkipped,
      invalidSkipped: t.invalidSkipped,
      overpassMs: t.overpassMs,
      classifyMs: t.classifyMs,
      buildMs: t.buildMs,
      writeMs: t.writeMs,
      lastError: t.lastError,
    })),
  };
}

export function copierHealth() {
  return {
    ok: true as const,
    pageUrl: "/admin/openstreetmap/national-copier",
    apiBase: "/admin/openstreetmap/api/national-copier",
    productionConfirmationPhrase: copierProductionConfirmationPhrase(),
    productionEnvVarName: copierProductionEnvVarName(),
    productionWritesUnlocked: isOsmNationalProductionWriteUnlocked(),
    emulatorHostPresent: isFirestoreEmulatorActiveForOsmNational(),
    forbiddenCollections: [...OSM_NATIONAL_COPIER_FORBIDDEN_COLLECTIONS],
    allowedCollections: [...OSM_NATIONAL_COPIER_ALLOWED_COLLECTIONS],
    postsWriteForbidden: true as const,
  };
}

export { processCopierTile };
