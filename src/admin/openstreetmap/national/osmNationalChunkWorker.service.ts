import { hostname } from "node:os";
import type { OsmChunkRun, OsmNationalRun, OsmStateRun } from "../../../contracts/entities/osm-national-entities.contract.js";
import { emptyOsmNationalCounts } from "../../../contracts/entities/osm-national-entities.contract.js";
import {
  getOsmChunkRun,
  getOsmStateRun,
  writeOsmChunkRun,
  writeOsmStateRun,
  type OsmNationalWriteOptions,
} from "../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";
import { classifyOpenStreetMapForBbox } from "../openstreetmap.service.js";
import { fetchOffroadRoutesForBbox } from "../offroadNationalImport.service.js";
import type { LocavaInventoryRoute } from "../../../lib/inventory/inventoryLocavaTypes.js";
import { dedupeLocavaInventory } from "../../../lib/inventory/inventoryLocavaDedupe.js";
import { buildUnexploredDocsFromClassification } from "./osmNationalDocBuilder.js";
import { logOsmNationalEvent } from "./osmNationalEventLogger.js";
import { addCounts, aggregateStateProgress, deriveStateStatus } from "./osmNationalProgress.service.js";
import { getNationalRunOrThrow, refreshNationalRunProgress } from "./osmNationalRun.service.js";
import { shouldSkipChunk } from "./usChunkPlanner.js";
import { collectRouteGeometryOverflow, writeUnexploredChunkDocs } from "./osmNationalWriter.service.js";
import { writeUnexploredTilesForChunk } from "./osmNationalTileWriter.service.js";
import { OsmNationalBudgetExceededError } from "./osmNationalWriteGuard.js";

const LOCK_TTL_MS = 15 * 60 * 1000;
const WORKER_ID = `${hostname()}-${process.pid}`;

function progressWriteOptions(run: OsmNationalRun): OsmNationalWriteOptions {
  return {
    writeTarget: run.writeTarget,
    operation: "processChunk",
    confirmProductionWrite: run.confirmProductionWrite,
    progressOnly: run.writeTarget === "none",
  };
}

function mergeRoutesDedupe(routes: LocavaInventoryRoute[]): {
  routes: LocavaInventoryRoute[];
  duplicatesSuppressed: number;
} {
  const deduped = dedupeLocavaInventory({ spots: [], routes });
  return { routes: deduped.routes, duplicatesSuppressed: deduped.duplicatesSuppressed };
}

function topRejectionReasons(rejected: Array<{ rejectionReason: string }>, limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const item of rejected) {
    counts.set(item.rejectionReason, (counts.get(item.rejectionReason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason, count]) => `${reason} (${count})`);
}

export type ProcessChunkResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  chunk?: OsmChunkRun;
};

export async function processChunk(input: {
  runId: string;
  stateCode: string;
  chunkId: string;
}): Promise<ProcessChunkResult> {
  const run = await getNationalRunOrThrow(input.runId);
  if (run.status === "paused" || run.status === "cancelled") {
    return { ok: false, skipped: true, reason: `run_${run.status}` };
  }

  const chunk = await getOsmChunkRun(input.runId, input.stateCode, input.chunkId);
  if (!chunk) return { ok: false, reason: "chunk_not_found" };

  if (
    shouldSkipChunk({
      chunk,
      skipCompletedChunks: run.config.skipCompletedChunks,
      forceReprocess: run.config.forceReprocess,
    })
  ) {
    if (chunk.status !== "skipped") {
      await writeOsmChunkRun(
        { ...chunk, status: "skipped", updatedAt: new Date().toISOString() },
        progressWriteOptions(run)
      );
    }
    return { ok: true, skipped: true, reason: "already_completed" };
  }

  const now = new Date().toISOString();
  if (chunk.lockedBy && chunk.lockExpiresAt && new Date(chunk.lockExpiresAt).getTime() > Date.now()) {
    return { ok: false, skipped: true, reason: "locked" };
  }

  const writeOpts = progressWriteOptions(run);
  const lockExpiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();

  let working: OsmChunkRun = {
    ...chunk,
    status: "running",
    attemptCount: chunk.attemptCount + 1,
    lockedBy: WORKER_ID,
    lockExpiresAt,
    checkpoint: { ...chunk.checkpoint, fetchStartedAt: now },
    updatedAt: now,
  };
  await writeOsmChunkRun(working, writeOpts);

  await logOsmNationalEvent({
    runId: input.runId,
    stateCode: input.stateCode,
    chunkId: input.chunkId,
    level: "info",
    type: "chunk_started",
    message: `Started ${input.stateCode} chunk ${chunk.chunkIndex + 1}`,
    writeOptions: writeOpts,
    force: true,
  });

  try {
    const refreshedRun = await getNationalRunOrThrow(input.runId);
    if (refreshedRun.status === "paused" || refreshedRun.status === "cancelled") {
      working = {
        ...working,
        status: "pending",
        lockedBy: null,
        lockExpiresAt: null,
        updatedAt: new Date().toISOString(),
      };
      await writeOsmChunkRun(working, writeOpts);
      return { ok: false, skipped: true, reason: `run_${refreshedRun.status}` };
    }

    await logOsmNationalEvent({
      runId: input.runId,
      stateCode: input.stateCode,
      chunkId: input.chunkId,
      level: "info",
      type: "fetching_osm",
      message: "Fetching Overpass OSM data",
      writeOptions: writeOpts,
    });

    const classification = await classifyOpenStreetMapForBbox({
      bbox: chunk.bbox,
      stateCode: input.stateCode,
      runId: input.runId,
      source: "overpass",
      includeOsmSpots: run.config.includeOsmSpots,
      includeOsmRoutes: run.config.includeOsmRoutes,
      includeOsmOffroad: run.config.includeOffroad,
      offroadSource: "osm",
    });

    working.checkpoint = {
      ...working.checkpoint,
      fetchCompletedAt: new Date().toISOString(),
      classifyStartedAt: new Date().toISOString(),
    };

    let offroadRoutes: LocavaInventoryRoute[] = [];
    let offroadRejected = 0;
    let offroadRaw = 0;

    if (run.config.includeOffroad) {
      await logOsmNationalEvent({
        runId: input.runId,
        stateCode: input.stateCode,
        chunkId: input.chunkId,
        level: "info",
        type: "fetching_offroad",
        message: "Fetching national offroad sources",
        writeOptions: writeOpts,
      });

      try {
        const offroad = await fetchOffroadRoutesForBbox({
          stateCode: input.stateCode,
          bbox: chunk.bbox,
          importRunId: input.runId,
        });
        offroadRoutes = offroad.routes;
        offroadRejected = offroad.rejectedCount;
        offroadRaw = offroad.rawCount;
      } catch (error) {
        console.warn("offroad_fetch_failed", error);
      }
    }

    const osmOffroadRoutes = classification.acceptedRoutes.filter((r) => r.routeKind.startsWith("offroad"));
    const trailRoutes = classification.acceptedRoutes.filter((r) => !r.routeKind.startsWith("offroad"));
    const mergedOffroad = mergeRoutesDedupe([...osmOffroadRoutes, ...offroadRoutes]);
    const mergedAllRoutes = mergeRoutesDedupe([...trailRoutes, ...mergedOffroad.routes]);

    working.checkpoint.classifyCompletedAt = new Date().toISOString();

    await logOsmNationalEvent({
      runId: input.runId,
      stateCode: input.stateCode,
      chunkId: input.chunkId,
      level: "info",
      type: "classifying",
      message: `Classifying ${classification.rawObjectCount + offroadRaw} raw objects`,
      writeOptions: writeOpts,
    });

    const { spots, routes } = buildUnexploredDocsFromClassification({
      spots: classification.acceptedSpots,
      routes: mergedAllRoutes.routes,
      stateCode: input.stateCode,
      runId: input.runId,
      chunkId: input.chunkId,
      writeMode: run.writeMode,
      writeTarget: run.writeTarget,
      includePublicOnly: run.config.includePublicOnly,
      includeReviewItems: run.config.includeReviewItems,
      includeOsmSpots: run.config.includeOsmSpots,
      includeOsmRoutes: run.config.includeOsmRoutes,
      includeOffroad: run.config.includeOffroad,
    });

    working.checkpoint.writeStartedAt = new Date().toISOString();

    await logOsmNationalEvent({
      runId: input.runId,
      stateCode: input.stateCode,
      chunkId: input.chunkId,
      level: "info",
      type: "writing",
      message: `Writing ${spots.length + routes.length} unexplored docs`,
      writeOptions: writeOpts,
    });

    const writeResult = await writeUnexploredChunkDocs({
      run,
      spots,
      routes,
      routeGeometry: collectRouteGeometryOverflow(routes, mergedAllRoutes.routes),
    });

    let writtenTiles = 0;
    if (run.config.tileBuildMode === "per_chunk") {
      working.checkpoint.tileStartedAt = new Date().toISOString();
      writtenTiles = await writeUnexploredTilesForChunk({ run, spots, routes, chunkBbox: chunk.bbox });
      working.checkpoint.tileCompletedAt = new Date().toISOString();
    }

    working.checkpoint.writeCompletedAt = new Date().toISOString();

    const offroadAccepted = routes.filter((r) => r.routeKind.startsWith("offroad")).length;
    working.counts = {
      ...emptyOsmNationalCounts(),
      rawObjects: classification.rawObjectCount + offroadRaw,
      acceptedSpots: spots.length,
      acceptedRoutes: routes.filter((r) => !r.routeKind.startsWith("offroad")).length,
      acceptedOffroadRoutes: offroadAccepted,
      rejectedObjects: classification.rejected.length + offroadRejected,
      duplicateSuppressed: classification.duplicatesSuppressed + mergedAllRoutes.duplicatesSuppressed,
      writtenSpots: writeResult.writtenSpots,
      writtenRoutes: writeResult.writtenRoutes,
      writtenTiles,
      writeErrors: writeResult.writeErrors,
    };

    working.samples = {
      acceptedSpotNames: spots.slice(0, 5).map((s) => s.displayName),
      acceptedRouteNames: routes.slice(0, 5).map((r) => r.displayName),
      offroadNames: routes.filter((r) => r.routeKind.startsWith("offroad")).slice(0, 5).map((r) => r.displayName),
      rejectedReasons: topRejectionReasons(classification.rejected),
    };

    working.status = "completed";
    working.lastError = null;
    working.lockedBy = null;
    working.lockExpiresAt = null;
    working.completedAt = new Date().toISOString();
    working.updatedAt = working.completedAt;

    await writeOsmChunkRun(working, writeOpts);
    await updateStateRunFromChunks(input.runId, input.stateCode, run);
    await refreshNationalRunProgress(input.runId);

    await logOsmNationalEvent({
      runId: input.runId,
      stateCode: input.stateCode,
      chunkId: input.chunkId,
      level: "info",
      type: "chunk_completed",
      message: "Chunk complete",
      counts: {
        acceptedSpots: working.counts.acceptedSpots,
        acceptedRoutes: working.counts.acceptedRoutes,
        writtenSpots: working.counts.writtenSpots,
        writtenRoutes: working.counts.writtenRoutes,
      },
      writeOptions: writeOpts,
      force: true,
    });

    return { ok: true, chunk: working };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    working.status = "failed";
    working.lastError = message;
    working.lockedBy = null;
    working.lockExpiresAt = null;
    working.updatedAt = new Date().toISOString();
    await writeOsmChunkRun(working, writeOpts);

    if (error instanceof OsmNationalBudgetExceededError && run.config.stopOnBudgetExceeded) {
      const { pauseNationalRun } = await import("./osmNationalRun.service.js");
      await pauseNationalRun(input.runId);
    }

    await logOsmNationalEvent({
      runId: input.runId,
      stateCode: input.stateCode,
      chunkId: input.chunkId,
      level: "error",
      type: "chunk_failed",
      message,
      writeOptions: writeOpts,
      force: true,
    });

    return { ok: false, reason: message, chunk: working };
  }
}

async function updateStateRunFromChunks(
  runId: string,
  stateCode: string,
  nationalRun: OsmNationalRun
): Promise<void> {
  const stateRun = await getOsmStateRun(runId, stateCode);
  if (!stateRun) return;

  const { listOsmChunkRuns } = await import("../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js");
  const chunks = await listOsmChunkRuns(runId, stateCode, { limit: 5000 });
  const progress = aggregateStateProgress(chunks);
  const counts = chunks.reduce((acc, chunk) => addCounts(acc, chunk.counts), emptyOsmNationalCounts());

  const updated: OsmStateRun = {
    ...stateRun,
    status: deriveStateStatus(chunks),
    progress,
    counts,
    currentChunkId: chunks.find((c) => c.status === "running")?.chunkId ?? null,
    lastEventAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writeOsmStateRun(updated, progressWriteOptions(nationalRun));
}
