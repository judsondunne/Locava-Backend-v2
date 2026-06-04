import {
  evaluatePbfCopierStartGuard,
  PBF_COPIER_ALLOWED_COLLECTIONS,
  PBF_COPIER_FORBIDDEN_COLLECTIONS,
  PBF_UNDISCOVERED_SHAPE_CONFIRMATION,
  pbfIsEmulatorActive,
  pbfIsProductionWriteUnlocked,
  pbfProductionConfirmationPhrase,
  pbfProductionEnvVarName,
  buildPbfDryRunProofToken,
} from "./pbfCopierGuards.js";
import { pbfUndiscoveredPurgeHealthFields } from "./pbfCopierUndiscoveredPurge.js";
import {
  appendPbfEvent,
  getPbfRun,
  hasPbfDryRunProof,
  listPbfEvents,
  listPbfRuns,
  pbfBuildEventId,
  putPbfRun,
} from "./pbfCopierProgressStore.js";
import {
  probePbfParserAvailability,
  type PbfFeatureReaderAvailability,
} from "../../../../lib/openstreetmap/pbf/pbfFeatureReader.js";
import { runPbfCopierLoop, validatePbfFile } from "./pbfCopierRunner.js";
import {
  dryRunPreviewCapFromQuotas,
  emptyQuotaProgress,
  isQuotaMode,
  resolveDryRunStopMode,
} from "./pbfCopierDryRunQuotas.js";
import { BBOX_EXHAUSTIVE_PREVIEW_LIMIT } from "./pbfCopierGeoFilter.js";
import {
  VERMONT_OFFROAD_PRODUCTION_PASSWORD,
  type OsmNationalWriteTarget,
} from "../osmNationalWriteGuard.js";
import { createPbfCopierRunRecord } from "./pbfCopierRunRecord.js";
import {
  DEFAULT_PBF_COPIER_CONFIG,
  emptyPbfCopierMetrics,
  type PbfCopierConfig,
  type PbfCopierMode,
  type PbfCopierRun,
} from "./pbfCopierTypes.js";

export type PbfCopierStartInput = {
  mode: PbfCopierMode;
  writeTarget?: OsmNationalWriteTarget;
  confirmProductionWrite?: string;
  confirmUndiscoveredShape?: string;
  config?: Partial<PbfCopierConfig> & { filePath: string };
  dryRunProofToken?: string;
};

export function buildPbfCopierConfig(
  partial?: Partial<PbfCopierConfig>
): PbfCopierConfig {
  const merged: PbfCopierConfig = { ...DEFAULT_PBF_COPIER_CONFIG, ...(partial ?? {}) };
  // Defensive normalization (bbox exhaustive mode uses a much higher limit below).
  if (!merged.geoFilterEnabled) {
    merged.dryRunLimit = Math.max(1, Math.min(merged.dryRunLimit, 5000));
  }
  merged.classifyBatchSize = Math.max(1, Math.min(merged.classifyBatchSize, 10000));
  if (merged.maxRawObjectsToScan != null && merged.maxRawObjectsToScan < 1) {
    merged.maxRawObjectsToScan = null;
  }
  if (merged.maxDocsToWrite != null && merged.maxDocsToWrite < 1) {
    merged.maxDocsToWrite = null;
  }
  merged.dryRunQuotas = merged.dryRunQuotas ?? {};
  merged.dryRunStopMode = resolveDryRunStopMode({
    dryRunStopMode: merged.dryRunStopMode,
    dryRunQuotas: merged.dryRunQuotas,
  });

  if (merged.dryRunStopMode !== "quotas") {
    merged.maxAcceptedMode = merged.maxAcceptedMode !== false;
  } else {
    merged.maxAcceptedMode = false;
    merged.balancedPreview = false;
    merged.dryRunLimit = dryRunPreviewCapFromQuotas(merged.dryRunQuotas, merged.dryRunLimit);
  }

  if (merged.geoFilterEnabled) {
    merged.maxAcceptedMode = false;
    merged.balancedPreview = true;
    merged.dryRunStopMode = "max_accepted";
    merged.dryRunQuotas = {};
    merged.dryRunLimit = BBOX_EXHAUSTIVE_PREVIEW_LIMIT;
    merged.includePublicOnly = false;
    merged.includeReviewDocs = true;
    merged.requireWaysBeforeStop = true;
    merged.minWayCandidatesBeforeStop = 0;
    if (merged.geoFilterRadiusKm == null || !Number.isFinite(merged.geoFilterRadiusKm)) {
      merged.geoFilterRadiusKm =
        merged.geoFilterRadiusMiles != null && Number.isFinite(merged.geoFilterRadiusMiles)
          ? Math.min(80, Math.max(2, merged.geoFilterRadiusMiles * 1.609344))
          : 12;
    }
  }

  merged.dryRunQuotas = merged.dryRunQuotas ?? {};
  return merged;
}

function shapeRun(input: {
  mode: PbfCopierMode;
  writeTarget: OsmNationalWriteTarget;
  confirmProductionWrite?: string;
  confirmUndiscoveredShape?: string;
  config: PbfCopierConfig;
}): PbfCopierRun {
  const run = createPbfCopierRunRecord(input);
  if (isQuotaMode(input.config)) {
    run.dryRunQuotaProgress = emptyQuotaProgress(input.config.dryRunQuotas ?? {});
  }
  return run;
}

function logEventForRun(run: PbfCopierRun, message: string): void {
  appendPbfEvent({
    eventId: pbfBuildEventId(),
    runId: run.runId,
    createdAt: new Date().toISOString(),
    level: "info",
    message,
    phase: run.phase,
  });
}

export function planPbfCopierRun(input: PbfCopierStartInput): PbfCopierRun {
  if (!input.config?.filePath?.trim()) {
    const error = new Error("missing_file_path:filePath is required");
    (error as Error & { code?: string }).code = "missing_file_path";
    throw error;
  }
  const config = buildPbfCopierConfig(input.config);
  const writeTarget: OsmNationalWriteTarget =
    input.mode === "write" ? input.writeTarget ?? "none" : "none";

  // Write runs need a prior dry-run proof token for the same file+config.
  const dryRunProofValid =
    input.mode === "write"
      ? Boolean(
          input.dryRunProofToken &&
            input.dryRunProofToken ===
              buildPbfDryRunProofToken({ filePath: config.filePath, config }) &&
            hasPbfDryRunProof(input.dryRunProofToken)
        )
      : true;

  const guard = evaluatePbfCopierStartGuard({
    mode: input.mode,
    writeTarget,
    confirmProductionWrite: input.confirmProductionWrite,
    confirmUndiscoveredShape: input.confirmUndiscoveredShape,
    config,
    dryRunProofToken: input.dryRunProofToken,
    dryRunProofValid,
  });
  if (!guard.ok) {
    const error = new Error(`${guard.code}:${guard.message}`);
    (error as Error & { code?: string }).code = guard.code;
    throw error;
  }

  const run = shapeRun({
    mode: input.mode,
    writeTarget,
    confirmProductionWrite: input.confirmProductionWrite,
    confirmUndiscoveredShape: input.confirmUndiscoveredShape,
    config,
  });
  putPbfRun(run);
  logEventForRun(run, `Run planned (mode=${input.mode}, file=${config.filePath}).`);
  return run;
}

export async function startPbfCopierRun(runId: string): Promise<PbfCopierRun> {
  const run = getPbfRun(runId);
  if (!run) throw new Error(`pbf_copier_run_not_found:${runId}`);
  if (run.status === "running") return run;
  if (run.status === "cancelled" || run.status === "completed") {
    throw new Error(`pbf_run_not_startable:${run.status}`);
  }
  run.status = "running";
  putPbfRun(run);
  return runPbfCopierLoop(runId);
}

function planDryRunPbfRun(input: {
  filePath: string;
  config?: Partial<PbfCopierConfig>;
  maxRawObjectsToScan?: number | null;
  acceptedLimit?: number;
  mode?: PbfCopierMode;
}): PbfCopierRun {
  const mode = input.mode ?? "dry_run_preview";
  const config = buildPbfCopierConfig({
    ...(input.config ?? {}),
    filePath: input.filePath,
    maxRawObjectsToScan:
      input.maxRawObjectsToScan !== undefined
        ? input.maxRawObjectsToScan
        : input.config?.maxRawObjectsToScan !== undefined
          ? input.config.maxRawObjectsToScan
          : null,
    dryRunLimit: input.acceptedLimit ?? input.config?.dryRunLimit ?? DEFAULT_PBF_COPIER_CONFIG.dryRunLimit,
  });
  const run = planPbfCopierRun({
    mode,
    writeTarget: "none",
    config,
  });
  run.status = "running";
  putPbfRun(run);
  return run;
}

function attachDryRunLoopErrorHandler(runId: string): void {
  void runPbfCopierLoop(runId).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const latest = getPbfRun(runId);
    if (latest && latest.status === "running") {
      latest.status = "failed";
      latest.phase = "failed";
      latest.lastError = message;
      latest.finishedAt = new Date().toISOString();
      putPbfRun(latest);
    }
  });
}

export async function dryRunPbfFirstAccepted(input: {
  filePath: string;
  config?: Partial<PbfCopierConfig>;
  maxRawObjectsToScan?: number | null;
  acceptedLimit?: number;
  mode?: PbfCopierMode;
}): Promise<PbfCopierRun> {
  const run = planDryRunPbfRun(input);
  return runPbfCopierLoop(run.runId);
}

/** Start a dry-run in the background; poll `/runs/:id` for live progress. */
export function startDryRunPbfPreview(input: {
  filePath: string;
  config?: Partial<PbfCopierConfig>;
  maxRawObjectsToScan?: number | null;
  acceptedLimit?: number;
  mode?: PbfCopierMode;
}): PbfCopierRun {
  const run = planDryRunPbfRun(input);
  attachDryRunLoopErrorHandler(run.runId);
  return run;
}

export function pausePbfCopierRun(runId: string): PbfCopierRun {
  const run = getPbfRun(runId);
  if (!run) throw new Error(`pbf_copier_run_not_found:${runId}`);
  if (run.status === "completed" || run.status === "cancelled") return run;
  run.status = "paused";
  run.phase = "paused";
  putPbfRun(run);
  logEventForRun(run, "Run paused.");
  return run;
}

export function resumePbfCopierRun(runId: string): PbfCopierRun {
  const run = getPbfRun(runId);
  if (!run) throw new Error(`pbf_copier_run_not_found:${runId}`);
  if (run.status === "completed" || run.status === "cancelled") {
    throw new Error(`pbf_run_not_resumable:${run.status}`);
  }
  run.status = "running";
  putPbfRun(run);
  void runPbfCopierLoop(runId).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const latest = getPbfRun(runId);
    if (latest && latest.status === "running") {
      latest.status = "failed";
      latest.phase = "failed";
      latest.lastError = message;
      latest.finishedAt = new Date().toISOString();
      putPbfRun(latest);
    }
  });
  return run;
}

export function cancelPbfCopierRun(runId: string): PbfCopierRun {
  const run = getPbfRun(runId);
  if (!run) throw new Error(`pbf_copier_run_not_found:${runId}`);
  run.status = "cancelled";
  run.phase = "cancelled";
  run.finishedAt = new Date().toISOString();
  putPbfRun(run);
  logEventForRun(run, "Run cancelled by user.");
  return run;
}

export function getPbfCopierRunDetail(runId: string): PbfCopierRun | null {
  return getPbfRun(runId);
}

export function listPbfCopierRunsSummary(limit = 20): PbfCopierRun[] {
  return listPbfRuns(limit);
}

export function listPbfCopierEventsForRun(runId: string, limit = 100) {
  return listPbfEvents(runId, limit);
}

export function exportPbfCopierRun(runId: string) {
  const run = getPbfRun(runId);
  if (!run) return null;
  return {
    runId: run.runId,
    mode: run.mode,
    status: run.status,
    phase: run.phase,
    config: run.config,
    metrics: run.metrics,
    rejectedReasonSamples: run.rejectedReasonSamples,
    rejectionReasonCounts: run.rejectionReasonCounts,
    rejectedSamples: run.rejectedSamples,
    rejectedSamplesTruncated: run.rejectedSamplesTruncated,
    acceptedActivitySamples: run.acceptedActivitySamples,
    missingMetadataWarnings: run.missingMetadataWarnings,
    routeTrailDiagnostics: run.routeTrailDiagnostics,
    previewDocs: run.previewDocs,
    previewQuality: run.previewQuality,
    parserId: run.parserId,
    parserVersion: run.parserVersion,
    sourceProvider: run.sourceProvider,
    sourceTimestamp: run.sourceTimestamp,
    dryRunProofToken: run.dryRunProofToken,
    file: {
      path: run.config.filePath,
      bytesRead: run.metrics.fileBytesRead,
      bytesTotal: run.metrics.fileBytesTotal,
    },
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

export type PbfCopierHealth = {
  ok: true;
  pageUrl: "/admin/openstreetmap/pbf-copier";
  apiBase: "/admin/openstreetmap/api/pbf-copier";
  parserId: string;
  parserVersion?: string;
  parserAvailable: boolean;
  parserAvailabilityReason?: string;
  parserMode: "streaming";
  productionConfirmationPhrase: string;
  undiscoveredShapeConfirmationPhrase: string;
  productionEnvVarName: string;
  productionWritesUnlocked: boolean;
  vermontProductionPassword: string;
  emulatorHostPresent: boolean;
  forbiddenCollections: readonly string[];
  allowedCollections: readonly string[];
  postsWriteForbidden: true;
} & ReturnType<typeof pbfUndiscoveredPurgeHealthFields>;

export async function pbfCopierHealth(): Promise<PbfCopierHealth> {
  const availability: PbfFeatureReaderAvailability = await probePbfParserAvailability();
  return {
    ok: true,
    pageUrl: "/admin/openstreetmap/pbf-copier",
    apiBase: "/admin/openstreetmap/api/pbf-copier",
    parserId: availability.parserId,
    parserVersion: availability.parserVersion,
    parserAvailable: availability.parserAvailable,
    parserAvailabilityReason: availability.reason,
    parserMode: "streaming",
    productionConfirmationPhrase: pbfProductionConfirmationPhrase(),
    undiscoveredShapeConfirmationPhrase: PBF_UNDISCOVERED_SHAPE_CONFIRMATION,
    productionEnvVarName: pbfProductionEnvVarName(),
    productionWritesUnlocked: pbfIsProductionWriteUnlocked(),
    vermontProductionPassword: VERMONT_OFFROAD_PRODUCTION_PASSWORD,
    emulatorHostPresent: pbfIsEmulatorActive(),
    forbiddenCollections: PBF_COPIER_FORBIDDEN_COLLECTIONS,
    allowedCollections: PBF_COPIER_ALLOWED_COLLECTIONS,
    postsWriteForbidden: true,
    ...pbfUndiscoveredPurgeHealthFields(),
  };
}

export { validatePbfFile };
export { diagnosePlaceInPbf } from "./pbfCopierDiagnosePlace.js";
export {
  DEFAULT_VERMONT_PBF_PATH,
  VERMONT_PBF_DOWNLOAD_COMMAND,
  inferStateCodeFromFilePath,
} from "./pbfCopierPathHelpers.js";
export { computeScanQualityAssessment } from "./pbfCopierScanQuality.js";
