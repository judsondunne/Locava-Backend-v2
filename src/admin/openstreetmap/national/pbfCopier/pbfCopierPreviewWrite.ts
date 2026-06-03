import type { UnexploredRoute, UnexploredSpot } from "../../../../contracts/entities/osm-national-entities.contract.js";
import type { OsmNationalWriteTarget } from "../osmNationalWriteGuard.js";
import { bulkWriteUnexploredRoutes } from "../../../../repositories/source-of-truth/unexplored-routes-firestore.adapter.js";
import { bulkWriteUnexploredSpots } from "../../../../repositories/source-of-truth/unexplored-spots-firestore.adapter.js";
import type { OsmNationalWriteOptions } from "../../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";
import { findExistingUnexploredIds } from "../copier/osmNationalCopierExistsBatch.js";
import {
  validateUnexploredRouteForCopier,
  validateUnexploredSpotForCopier,
} from "../copier/osmNationalCopierRunner.js";
import {
  assertPbfCopierCollectionTarget,
  buildPbfDryRunProofToken,
  evaluatePbfCopierStartGuard,
  PBF_UNDISCOVERED_SHAPE_CONFIRMATION,
} from "./pbfCopierGuards.js";
import {
  appendPbfEvent,
  getPbfRun,
  hasPbfDryRunProof,
  pbfBuildEventId,
  putPbfRun,
} from "./pbfCopierProgressStore.js";
import { createPbfCopierRunRecord } from "./pbfCopierRunRecord.js";
import type { PbfCopierPreviewDoc, PbfCopierRun } from "./pbfCopierTypes.js";
import { emptyPbfCopierMetrics } from "./pbfCopierTypes.js";

export const PREVIEW_WRITE_BATCH_SIZE = 25;

export type WritePreviewDocsInput = {
  dryRunRunId: string;
  writeTarget: OsmNationalWriteTarget;
  confirmProductionWrite?: string;
  confirmUndiscoveredShape?: string;
  /** Max preview items to write (spots + routes in dry-run order). */
  limit?: number | null;
  skipExisting?: boolean;
  includeSpots?: boolean;
  includeRoutes?: boolean;
};

export type PreviewDocsWritePlan = {
  spots: UnexploredSpot[];
  routes: UnexploredRoute[];
  skippedInvalid: number;
};

/** Same order as dry-run preview list — every map pin with a valid writePayload. */
export function extractPreviewDocsForWrite(
  docs: PbfCopierPreviewDoc[],
  input?: { limit?: number | null; includeSpots?: boolean; includeRoutes?: boolean }
): PreviewDocsWritePlan {
  const includeSpots = input?.includeSpots !== false;
  const includeRoutes = input?.includeRoutes !== false;
  const limit = input?.limit;
  const spots: UnexploredSpot[] = [];
  const routes: UnexploredRoute[] = [];
  let skippedInvalid = 0;
  let total = 0;

  for (const doc of docs) {
    if (limit != null && limit > 0 && total >= limit) break;

    if (doc.kind === "unexplored_spot" && includeSpots) {
      const payload = doc.writePayload as UnexploredSpot | undefined;
      if (!payload?.id) {
        skippedInvalid += 1;
        continue;
      }
      if (validateUnexploredSpotForCopier(payload).length > 0) {
        skippedInvalid += 1;
        continue;
      }
      spots.push(payload);
      total += 1;
      continue;
    }

    if (doc.kind === "unexplored_route" && includeRoutes) {
      const payload = doc.writePayload as UnexploredRoute | undefined;
      if (!payload?.id) {
        skippedInvalid += 1;
        continue;
      }
      if (validateUnexploredRouteForCopier(payload).length > 0) {
        skippedInvalid += 1;
        continue;
      }
      routes.push(payload);
      total += 1;
    }
  }

  return { spots, routes, skippedInvalid };
}

/** @deprecated Use extractPreviewDocsForWrite */
export function extractSpotsFromPreviewDocs(
  docs: PbfCopierPreviewDoc[],
  limit?: number | null
): UnexploredSpot[] {
  return extractPreviewDocsForWrite(docs, { limit, includeRoutes: false }).spots;
}

function logPreviewWriteEvent(input: {
  runId: string;
  level?: "info" | "warn" | "error";
  message: string;
  counts?: Record<string, number>;
}): void {
  appendPbfEvent({
    eventId: pbfBuildEventId(),
    runId: input.runId,
    createdAt: new Date().toISOString(),
    level: input.level ?? "info",
    message: input.message,
    phase: "writing_batch",
    counts: input.counts,
  });
}

export async function runPreviewDocsWriteLoop(writeRunId: string): Promise<PbfCopierRun> {
  let run = getPbfRun(writeRunId);
  if (!run) throw new Error(`pbf_copier_run_not_found:${writeRunId}`);
  if (!run.previewWriteSourceRunId) {
    throw new Error("preview_write_missing_source_run");
  }

  const sourceRun = getPbfRun(run.previewWriteSourceRunId);
  if (!sourceRun) throw new Error(`preview_write_source_not_found:${run.previewWriteSourceRunId}`);

  let { spots, routes } = extractPreviewDocsForWrite(sourceRun.previewDocs, {
    limit: run.previewWriteSpotLimit ?? null,
    includeSpots: run.config.includeSpots,
    includeRoutes: run.config.includeRoutes,
  });

  const totalPlanned = spots.length + routes.length;

  run.status = "running";
  run.phase = "writing_batch";
  run.startedAt = run.startedAt ?? new Date().toISOString();
  putPbfRun(run);

  const writeOptions: OsmNationalWriteOptions = {
    writeTarget: run.writeTarget,
    operation: "osm_pbf_copier.write_preview_docs",
    confirmProductionWrite: run.confirmProductionWrite,
  };

  try {
    if (run.config.skipExisting) {
      run.phase = "checking_existing_ids";
      putPbfRun(run);
      if (spots.length > 0) {
        const existingSpots = await findExistingUnexploredIds(
          "unexploredSpots",
          spots.map((s) => s.id)
        );
        run.metrics.estimatedReads += spots.length;
        if (existingSpots.size > 0) {
          run.metrics.skippedExisting += existingSpots.size;
          spots = spots.filter((s) => !existingSpots.has(s.id));
        }
      }
      if (routes.length > 0) {
        const existingRoutes = await findExistingUnexploredIds(
          "unexploredRoutes",
          routes.map((r) => r.id)
        );
        run.metrics.estimatedReads += routes.length;
        if (existingRoutes.size > 0) {
          run.metrics.skippedExisting += existingRoutes.size;
          routes = routes.filter((r) => !existingRoutes.has(r.id));
        }
      }
    }

    const spotsToWrite = spots.length;
    const routesToWrite = routes.length;
    const grandTotal = spotsToWrite + routesToWrite;

    run.previewWritePlannedSpots = spotsToWrite;
    run.previewWritePlannedRoutes = routesToWrite;
    run.metrics.docsPreviewed = grandTotal;
    putPbfRun(run);

    logPreviewWriteEvent({
      runId: writeRunId,
      message:
        `Writing ${spotsToWrite} spot(s) + ${routesToWrite} route(s) = ${grandTotal} doc(s) to ${run.writeTarget} ` +
        `(from dry-run ${run.previewWriteSourceRunId}).`,
      counts: { spotsPlanned: spotsToWrite, routesPlanned: routesToWrite },
    });

    let writtenSpots = 0;
    let writtenRoutes = 0;
    let batchIndex = 0;

    for (let i = 0; i < spots.length; i += PREVIEW_WRITE_BATCH_SIZE) {
      const latest = getPbfRun(writeRunId);
      if (!latest) break;
      run = latest;
      if (run.status === "cancelled") {
        run.phase = "cancelled";
        run.finishedAt = new Date().toISOString();
        putPbfRun(run);
        return run;
      }

      batchIndex += 1;
      const batch = spots.slice(i, i + PREVIEW_WRITE_BATCH_SIZE);
      run.phase = "writing_batch";
      run.currentActivity = {
        currentObjectType: "node",
        currentOsmId: null,
        currentLabel: `Spots batch ${batchIndex}`,
        currentPhaseDetail: `${writtenSpots + writtenRoutes}/${grandTotal} docs written`,
      };
      putPbfRun(run);

      assertPbfCopierCollectionTarget("unexploredSpots");
      run.metrics.estimatedWrites += batch.length;
      run.metrics.writerCalls += 1;
      const n = await bulkWriteUnexploredSpots(batch, writeOptions);
      writtenSpots += n;
      run.metrics.docsWritten = writtenSpots + writtenRoutes;
      run.metrics.acceptedSpots = writtenSpots;
      run.metrics.batchesWritten += 1;
      run.updatedAt = new Date().toISOString();
      putPbfRun(run);

      logPreviewWriteEvent({
        runId: writeRunId,
        message: `Wrote spots batch ${batchIndex}: ${n} spot(s) (${writtenSpots} spots, ${writtenRoutes} routes so far).`,
        counts: { written: n, writtenSpots, writtenRoutes },
      });
    }

    for (let i = 0; i < routes.length; i += PREVIEW_WRITE_BATCH_SIZE) {
      const latest = getPbfRun(writeRunId);
      if (!latest) break;
      run = latest;
      if (run.status === "cancelled") {
        run.phase = "cancelled";
        run.finishedAt = new Date().toISOString();
        putPbfRun(run);
        return run;
      }

      batchIndex += 1;
      const batch = routes.slice(i, i + PREVIEW_WRITE_BATCH_SIZE);
      run.phase = "writing_batch";
      run.currentActivity = {
        currentObjectType: "way",
        currentOsmId: null,
        currentLabel: `Routes batch ${batchIndex}`,
        currentPhaseDetail: `${writtenSpots + writtenRoutes}/${grandTotal} docs written`,
      };
      putPbfRun(run);

      assertPbfCopierCollectionTarget("unexploredRoutes");
      run.metrics.estimatedWrites += batch.length;
      run.metrics.writerCalls += 1;
      const n = await bulkWriteUnexploredRoutes(batch, writeOptions);
      writtenRoutes += n;
      run.metrics.docsWritten = writtenSpots + writtenRoutes;
      run.metrics.acceptedRoutes = writtenRoutes;
      run.metrics.batchesWritten += 1;
      run.updatedAt = new Date().toISOString();
      putPbfRun(run);

      logPreviewWriteEvent({
        runId: writeRunId,
        message: `Wrote routes batch ${batchIndex}: ${n} route(s) (${writtenSpots} spots + ${writtenRoutes} routes total).`,
        counts: { written: n, writtenSpots, writtenRoutes },
      });
    }

    run.status = "completed";
    run.phase = "complete";
    run.finishedAt = new Date().toISOString();
    run.scanStopReason =
      `Wrote ${writtenSpots} spot(s) and ${writtenRoutes} route(s) (${writtenSpots + writtenRoutes} total) to ${run.writeTarget}.`;
    putPbfRun(run);

    logPreviewWriteEvent({
      runId: writeRunId,
      message: run.scanStopReason,
      counts: {
        writtenSpots,
        writtenRoutes,
        skippedExisting: run.metrics.skippedExisting,
      },
    });

    return run;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    run.status = "failed";
    run.phase = "failed";
    run.lastError = message;
    run.metrics.errors += 1;
    run.finishedAt = new Date().toISOString();
    putPbfRun(run);
    logPreviewWriteEvent({
      runId: writeRunId,
      level: "error",
      message: `Preview write failed: ${message}`,
    });
    return run;
  }
}

/** @deprecated Alias */
export const runPreviewSpotsWriteLoop = runPreviewDocsWriteLoop;

export function startWritePreviewDocs(input: WritePreviewDocsInput): PbfCopierRun {
  const sourceRun = getPbfRun(input.dryRunRunId);
  if (!sourceRun) {
    const error = new Error("dry_run_run_not_found:Dry-run run not found.");
    (error as Error & { code?: string }).code = "dry_run_run_not_found";
    throw error;
  }
  if (sourceRun.status !== "completed") {
    const error = new Error("dry_run_not_complete:Dry-run must finish before writing preview docs.");
    (error as Error & { code?: string }).code = "dry_run_not_complete";
    throw error;
  }
  if (sourceRun.mode !== "dry_run_preview" && sourceRun.mode !== "fast_dry_run") {
    const error = new Error("invalid_source_run:Source run must be a dry-run preview.");
    (error as Error & { code?: string }).code = "invalid_source_run";
    throw error;
  }
  if (!sourceRun.dryRunProofToken) {
    const error = new Error("dry_run_proof_missing:Dry-run proof token missing.");
    (error as Error & { code?: string }).code = "dry_run_proof_missing";
    throw error;
  }

  const proofToken = sourceRun.dryRunProofToken;
  const proofValid =
    proofToken === buildPbfDryRunProofToken({ filePath: sourceRun.config.filePath, config: sourceRun.config }) &&
    hasPbfDryRunProof(proofToken);

  const confirmUndiscoveredShape =
    input.confirmUndiscoveredShape ?? PBF_UNDISCOVERED_SHAPE_CONFIRMATION;

  const guard = evaluatePbfCopierStartGuard({
    mode: "write",
    writeTarget: input.writeTarget,
    confirmProductionWrite: input.confirmProductionWrite,
    confirmUndiscoveredShape,
    config: sourceRun.config,
    dryRunProofToken: proofToken,
    dryRunProofValid: proofValid,
  });
  if (!guard.ok) {
    const error = new Error(`${guard.code}:${guard.message}`);
    (error as Error & { code?: string }).code = guard.code;
    throw error;
  }

  const plan = extractPreviewDocsForWrite(sourceRun.previewDocs, {
    limit: input.limit ?? null,
    includeSpots: input.includeSpots,
    includeRoutes: input.includeRoutes,
  });

  if (plan.spots.length === 0 && plan.routes.length === 0) {
    const error = new Error("no_preview_docs:No valid spot/route preview docs to write.");
    (error as Error & { code?: string }).code = "no_preview_docs";
    throw error;
  }

  const writeRun = createPbfCopierRunRecord({
    mode: "write",
    writeTarget: input.writeTarget,
    confirmProductionWrite: input.confirmProductionWrite,
    confirmUndiscoveredShape,
    config: {
      ...sourceRun.config,
      includeSpots: input.includeSpots !== false,
      includeRoutes: input.includeRoutes !== false,
      skipExisting: input.skipExisting ?? sourceRun.config.skipExisting,
    },
  });
  writeRun.metrics = {
    ...emptyPbfCopierMetrics(),
    docsPreviewed: plan.spots.length + plan.routes.length,
  };
  writeRun.previewWriteSourceRunId = sourceRun.runId;
  writeRun.previewWritePlannedSpots = plan.spots.length;
  writeRun.previewWritePlannedRoutes = plan.routes.length;
  writeRun.previewWriteSpotLimit = input.limit ?? null;
  writeRun.status = "running";
  writeRun.phase = "writing_batch";
  writeRun.startedAt = new Date().toISOString();
  putPbfRun(writeRun);

  appendPbfEvent({
    eventId: pbfBuildEventId(),
    runId: writeRun.runId,
    createdAt: new Date().toISOString(),
    level: "info",
    message:
      `Preview write queued: ${plan.spots.length} spot(s) + ${plan.routes.length} route(s) → ${input.writeTarget}.`,
    phase: "writing_batch",
    counts: {
      spotsPlanned: plan.spots.length,
      routesPlanned: plan.routes.length,
      skippedInvalid: plan.skippedInvalid,
    },
  });

  void runPreviewDocsWriteLoop(writeRun.runId).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const latest = getPbfRun(writeRun.runId);
    if (latest && latest.status === "running") {
      latest.status = "failed";
      latest.phase = "failed";
      latest.lastError = message;
      latest.finishedAt = new Date().toISOString();
      putPbfRun(latest);
    }
  });

  return writeRun;
}

/** @deprecated Use startWritePreviewDocs */
export const startWritePreviewSpots = startWritePreviewDocs;
