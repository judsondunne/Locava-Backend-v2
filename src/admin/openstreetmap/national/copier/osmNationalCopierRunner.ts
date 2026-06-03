import { classifyOpenStreetMapForBbox } from "../../openstreetmap.service.js";
import { fetchOffroadRoutesForBbox } from "../../offroadNationalImport.service.js";
import { dedupeLocavaInventory } from "../../../../lib/inventory/inventoryLocavaDedupe.js";
import type {
  LocavaInventoryRoute,
  LocavaInventorySpot,
} from "../../../../lib/inventory/inventoryLocavaTypes.js";
import {
  buildUnexploredDocsFromClassification,
} from "../osmNationalDocBuilder.js";
import {
  bulkWriteUnexploredSpots,
} from "../../../../repositories/source-of-truth/unexplored-spots-firestore.adapter.js";
import {
  bulkWriteUnexploredRoutes,
} from "../../../../repositories/source-of-truth/unexplored-routes-firestore.adapter.js";
import {
  writeRouteGeometryChunk,
  type OsmNationalWriteOptions,
} from "../../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";
import { splitLargeGeometry } from "../osmNationalDocSize.js";
import { collectRouteGeometryOverflow } from "../osmNationalWriter.service.js";
import type {
  UnexploredRoute,
  UnexploredSpot,
} from "../../../../contracts/entities/osm-national-entities.contract.js";
import { findExistingUnexploredIds } from "./osmNationalCopierExistsBatch.js";
import {
  appendCopierEvent,
  copierBuildEventId,
  getCopierRun,
  putCopierRun,
} from "./osmNationalCopierProgressStore.js";
import { assertCopierCollectionTarget } from "./osmNationalCopierGuards.js";
import type {
  CopierTileResult,
  OsmNationalCopierEvent,
  OsmNationalCopierPhase,
  OsmNationalCopierPreviewDoc,
  OsmNationalCopierRun,
  OsmNationalCopierTile,
  OsmNationalCopierTileRecord,
} from "./osmNationalCopierTypes.js";

const REJECTED_REASON_SAMPLE_CAP = 20;
const ACTIVITY_SAMPLE_CAP = 20;
const MISSING_METADATA_SAMPLE_CAP = 25;
const PREVIEW_TAG_SAMPLE_FIELDS = 8;

/**
 * Hook overrides used by tests. Production code never sets these.
 *
 * Avoiding `vi.mock(...)` lets us keep the runner test deterministic on Node
 * import order and lets the copier remain a normal ESM module.
 */
export type CopierRunnerHooks = {
  classify?: typeof classifyOpenStreetMapForBbox;
  fetchOffroad?: typeof fetchOffroadRoutesForBbox;
  writeSpots?: typeof bulkWriteUnexploredSpots;
  writeRoutes?: typeof bulkWriteUnexploredRoutes;
  writeGeometryChunk?: typeof writeRouteGeometryChunk;
  findExisting?: typeof findExistingUnexploredIds;
  now?: () => number;
};

let activeHooks: CopierRunnerHooks = {};

export function setCopierRunnerHooks(hooks: CopierRunnerHooks): void {
  activeHooks = { ...hooks };
}

export function clearCopierRunnerHooks(): void {
  activeHooks = {};
}

function classifyFn(): typeof classifyOpenStreetMapForBbox {
  return activeHooks.classify ?? classifyOpenStreetMapForBbox;
}

function offroadFn(): typeof fetchOffroadRoutesForBbox {
  return activeHooks.fetchOffroad ?? fetchOffroadRoutesForBbox;
}

function writeSpotsFn(): typeof bulkWriteUnexploredSpots {
  return activeHooks.writeSpots ?? bulkWriteUnexploredSpots;
}

function writeRoutesFn(): typeof bulkWriteUnexploredRoutes {
  return activeHooks.writeRoutes ?? bulkWriteUnexploredRoutes;
}

function writeGeometryChunkFn(): typeof writeRouteGeometryChunk {
  return activeHooks.writeGeometryChunk ?? writeRouteGeometryChunk;
}

function findExistingFn(): typeof findExistingUnexploredIds {
  return activeHooks.findExisting ?? findExistingUnexploredIds;
}

function nowMs(): number {
  return activeHooks.now ? activeHooks.now() : Date.now();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type SpotValidationFailure = { id: string; displayName?: string; reasons: string[] };
export type RouteValidationFailure = { id: string; displayName?: string; reasons: string[] };

export function validateUnexploredSpotForCopier(spot: UnexploredSpot): string[] {
  const reasons: string[] = [];
  if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lng)) reasons.push("missing_coordinates");
  if (Math.abs(spot.lat) > 90 || Math.abs(spot.lng) > 180) reasons.push("invalid_coordinate_range");
  if (!spot.displayName?.trim()) reasons.push("missing_display_name");
  if (!spot.category?.trim()) reasons.push("missing_category");
  if (!Array.isArray(spot.activities) || spot.activities.length === 0) {
    reasons.push("missing_activity");
  }
  if (!spot.sourceKeys || spot.sourceKeys.length === 0) reasons.push("missing_source_keys");
  if (spot.origin !== "generated_osm") reasons.push("bad_origin");
  if (spot.undiscovered !== true) reasons.push("bad_undiscovered_flag");
  return reasons;
}

export function validateUnexploredRouteForCopier(route: UnexploredRoute): string[] {
  const reasons: string[] = [];
  if (!route.center || !Number.isFinite(route.center.lat) || !Number.isFinite(route.center.lng)) {
    reasons.push("missing_center");
  }
  if (!route.displayName?.trim()) reasons.push("missing_display_name");
  if (!Array.isArray(route.activities) || route.activities.length === 0) {
    reasons.push("missing_activity");
  }
  if (!route.sourceKeys || route.sourceKeys.length === 0) reasons.push("missing_source_keys");
  if (route.origin !== "generated_osm") reasons.push("bad_origin");
  if (route.undiscovered !== true) reasons.push("bad_undiscovered_flag");
  if (
    !route.geometryStorage ||
    !["inline", "artifact_ref", "chunked_subcollection"].includes(route.geometryStorage.mode)
  ) {
    reasons.push("missing_geometry_storage");
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Preview doc shaping
// ---------------------------------------------------------------------------

function trimTags(tags: Record<string, unknown> | undefined): Record<string, string> {
  if (!tags) return {};
  const out: Record<string, string> = {};
  let i = 0;
  for (const [k, v] of Object.entries(tags)) {
    if (i >= PREVIEW_TAG_SAMPLE_FIELDS) break;
    out[k] = typeof v === "string" ? v : JSON.stringify(v).slice(0, 80);
    i += 1;
  }
  return out;
}

export function buildSpotPreviewDoc(
  spot: UnexploredSpot,
  importChunkId: string
): OsmNationalCopierPreviewDoc {
  const warnings: string[] = [];
  if (!spot.activities?.length) warnings.push("missing_activity");
  if (!spot.displayName?.trim()) warnings.push("missing_display_name");
  if (!spot.category?.trim()) warnings.push("missing_category");
  return {
    id: spot.id,
    kind: "unexplored_spot",
    collection: "unexploredSpots",
    displayName: spot.displayName,
    primaryActivity: spot.primaryActivity ?? null,
    activities: spot.activities ?? [],
    primaryCategory: spot.category,
    lat: spot.lat,
    lng: spot.lng,
    bbox: spot.bbox,
    sourceFamily: spot.sourceFamily,
    sourceKeys: spot.sourceKeys,
    sourceIds: spot.sourceIds,
    origin: "generated_osm",
    mapReadiness: spot.mapReadiness,
    publicMapEligible: spot.publicMapEligible,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: spot.import.runId,
    importChunkId,
    importPipelineVersion: spot.import.pipelineVersion,
    parking: spot.parking as Record<string, unknown> | undefined,
    trailhead: spot.trailhead as Record<string, unknown> | undefined,
    parentPlaceName: spot.parentPlaceName,
    sourceTagSample: trimTags(spot.sourceTags as Record<string, unknown>),
    warnings,
  };
}

export function buildRoutePreviewDoc(
  route: UnexploredRoute,
  importChunkId: string
): OsmNationalCopierPreviewDoc {
  const warnings: string[] = [];
  if (!route.activities?.length) warnings.push("missing_activity");
  if (!route.displayName?.trim()) warnings.push("missing_display_name");
  if (!route.center) warnings.push("missing_center");
  return {
    id: route.id,
    kind: "unexplored_route",
    collection: "unexploredRoutes",
    displayName: route.displayName,
    primaryActivity: route.primaryActivity ?? null,
    activities: route.activities ?? [],
    primaryCategory: route.category ?? route.categories?.[0] ?? "route",
    lat: route.center.lat,
    lng: route.center.lng,
    center: route.center,
    bbox: route.bbox,
    sourceFamily: route.sourceFamily,
    sourceKeys: route.sourceKeys,
    sourceIds: route.sourceIds,
    origin: "generated_osm",
    mapReadiness: route.mapReadiness,
    publicMapEligible: route.publicMapEligible,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: route.import.runId,
    importChunkId,
    importPipelineVersion: route.import.pipelineVersion,
    selectedParking: route.selectedParking,
    selectedTrailhead: route.selectedTrailhead,
    parentPlaceName: route.parentPlaceName,
    legalDisplayLabel: route.legalDisplayLabel,
    offroadCategory: route.offroadCategory,
    distanceMeters: route.distanceMeters,
    distanceLabel: route.distanceLabel,
    geometryStorage: route.geometryStorage,
    encodedPolylinePreviewLength: route.encodedPolyline?.length,
    sourceTagSample: trimTags(route.sourceTags as Record<string, unknown>),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Tile processing
// ---------------------------------------------------------------------------

function mergeRoutesDedupe(routes: LocavaInventoryRoute[]): {
  routes: LocavaInventoryRoute[];
  duplicatesSuppressed: number;
} {
  const deduped = dedupeLocavaInventory({ spots: [], routes });
  return { routes: deduped.routes, duplicatesSuppressed: deduped.duplicatesSuppressed };
}

export async function processCopierTile(input: {
  run: OsmNationalCopierRun;
  tile: OsmNationalCopierTile;
}): Promise<CopierTileResult> {
  const { run, tile } = input;
  const config = run.config;
  const rejectedReasonSamples: string[] = [];
  const warnings: string[] = [];

  const tFetchStart = nowMs();
  let classification;
  try {
    classification = await classifyFn()({
      bbox: tile.bbox,
      stateCode: tile.stateCode,
      runId: run.runId,
      source: "overpass",
      includeOsmSpots: config.includeSpots,
      includeOsmRoutes: config.includeRoutes,
      includeOsmOffroad: config.includeRoutes,
      offroadSource: "osm",
    });
  } catch (error) {
    warnings.push(
      `overpass_failed:${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
  const overpassMs = nowMs() - tFetchStart;

  for (const r of classification.rejected.slice(0, 10)) {
    if (r.rejectionReason && !rejectedReasonSamples.includes(r.rejectionReason)) {
      rejectedReasonSamples.push(r.rejectionReason);
    }
  }

  let offroadRoutes: LocavaInventoryRoute[] = [];
  if (config.includeRoutes) {
    try {
      const offroad = await offroadFn()({
        stateCode: tile.stateCode,
        bbox: tile.bbox,
        importRunId: run.runId,
      });
      offroadRoutes = offroad.routes;
    } catch (error) {
      warnings.push(
        `offroad_fetch_failed:${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const tClassifyStart = nowMs();
  const osmOffroadRoutes = classification.acceptedRoutes.filter((r: LocavaInventoryRoute) =>
    r.routeKind.startsWith("offroad")
  );
  const trailRoutes = classification.acceptedRoutes.filter(
    (r: LocavaInventoryRoute) => !r.routeKind.startsWith("offroad")
  );
  const mergedOffroad = mergeRoutesDedupe([...osmOffroadRoutes, ...offroadRoutes]);
  const mergedAllRoutes = mergeRoutesDedupe([...trailRoutes, ...mergedOffroad.routes]);
  const classifyMs = nowMs() - tClassifyStart;

  const tBuildStart = nowMs();
  const { spots, routes } = buildUnexploredDocsFromClassification({
    spots: config.includeSpots ? (classification.acceptedSpots as LocavaInventorySpot[]) : [],
    routes: mergedAllRoutes.routes,
    stateCode: tile.stateCode,
    runId: run.runId,
    chunkId: tile.tileId,
    writeMode: run.writeMode,
    writeTarget: run.writeTarget,
    includePublicOnly: config.includePublicOnly,
    includeReviewItems: config.includeReviewDocs,
    includeOsmSpots: config.includeSpots,
    includeOsmRoutes: config.includeRoutes,
    includeOffroad: config.includeRoutes,
  });
  const buildMs = nowMs() - tBuildStart;

  // Filter invalid docs (we are intentionally not "fixing" classifier output;
  // we just refuse to write rejected/invalid items).
  const validSpots: UnexploredSpot[] = [];
  const validRoutes: UnexploredRoute[] = [];
  let invalidCount = 0;

  for (const spot of spots) {
    const reasons = validateUnexploredSpotForCopier(spot);
    if (reasons.length === 0) {
      validSpots.push(spot);
    } else {
      invalidCount += 1;
      warnings.push(`invalid_spot:${spot.id}:${reasons.join(",")}`);
    }
  }
  for (const route of routes) {
    const reasons = validateUnexploredRouteForCopier(route);
    if (reasons.length === 0) {
      validRoutes.push(route);
    } else {
      invalidCount += 1;
      warnings.push(`invalid_route:${route.id}:${reasons.join(",")}`);
    }
  }

  return {
    tile,
    spots: validSpots,
    routes: validRoutes,
    inventoryRoutes: mergedAllRoutes.routes,
    rejectedCount: classification.rejected.length,
    invalidCount,
    duplicatesSuppressed:
      classification.duplicatesSuppressed +
      mergedOffroad.duplicatesSuppressed +
      mergedAllRoutes.duplicatesSuppressed,
    rawObjectCount: classification.rawObjectCount,
    overpassMs,
    classifyMs,
    buildMs,
    rejectedReasonSamples,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Run loop
// ---------------------------------------------------------------------------

function logEvent(input: {
  runId: string;
  phase: OsmNationalCopierPhase;
  level?: OsmNationalCopierEvent["level"];
  message: string;
  tileId?: string;
  stateCode?: string;
  counts?: Record<string, number>;
}): void {
  const event: OsmNationalCopierEvent = {
    eventId: copierBuildEventId(),
    runId: input.runId,
    createdAt: new Date().toISOString(),
    level: input.level ?? "info",
    message: input.message,
    phase: input.phase,
    tileId: input.tileId,
    stateCode: input.stateCode,
    counts: input.counts,
  };
  appendCopierEvent(event);
}

function captureSamples(run: OsmNationalCopierRun, tileResult: CopierTileResult): void {
  for (const reason of tileResult.rejectedReasonSamples) {
    if (run.rejectedReasonSamples.length >= REJECTED_REASON_SAMPLE_CAP) break;
    if (!run.rejectedReasonSamples.includes(reason)) run.rejectedReasonSamples.push(reason);
  }
  for (const doc of tileResult.spots) {
    for (const activity of doc.activities ?? []) {
      if (run.acceptedActivitySamples.length >= ACTIVITY_SAMPLE_CAP) break;
      if (!run.acceptedActivitySamples.includes(activity)) run.acceptedActivitySamples.push(activity);
    }
  }
  for (const doc of tileResult.routes) {
    for (const activity of doc.activities ?? []) {
      if (run.acceptedActivitySamples.length >= ACTIVITY_SAMPLE_CAP) break;
      if (!run.acceptedActivitySamples.includes(activity)) run.acceptedActivitySamples.push(activity);
    }
  }
  for (const warning of tileResult.warnings) {
    if (run.missingMetadataWarnings.length >= MISSING_METADATA_SAMPLE_CAP) break;
    run.missingMetadataWarnings.push(warning);
  }
}

function updateMetricsForElapsed(run: OsmNationalCopierRun, startMs: number): void {
  const elapsedMs = Math.max(0, nowMs() - startMs);
  run.metrics.elapsedMs = elapsedMs;
  const minutes = elapsedMs / 60_000;
  run.metrics.averageDocsPerMinute =
    minutes > 0 ? Math.round(run.metrics.docsPreviewed / minutes) : 0;
  run.metrics.averageWritesPerMinute =
    minutes > 0 ? Math.round(run.metrics.writesActual / minutes) : 0;
  if (run.metrics.chunksCompleted > 0 && run.metrics.chunksTotal > 0) {
    const remainingTiles = Math.max(0, run.metrics.chunksTotal - run.metrics.chunksCompleted);
    const msPerTile = elapsedMs / run.metrics.chunksCompleted;
    run.metrics.estimatedTimeRemainingMs = Math.round(remainingTiles * msPerTile);
  } else {
    run.metrics.estimatedTimeRemainingMs = null;
  }
}

function applyTileResultToRun(input: {
  run: OsmNationalCopierRun;
  record: OsmNationalCopierTileRecord;
  tileResult: CopierTileResult;
}): void {
  const { run, record, tileResult } = input;

  record.acceptedSpots = tileResult.spots.length;
  record.acceptedRoutes = tileResult.routes.length;
  record.rejectedSkipped = tileResult.rejectedCount;
  record.duplicatesSkipped = tileResult.duplicatesSuppressed;
  record.invalidSkipped = tileResult.invalidCount;
  record.overpassMs = tileResult.overpassMs;
  record.classifyMs = tileResult.classifyMs;
  record.buildMs = tileResult.buildMs;

  run.metrics.docsSkippedRejected += tileResult.rejectedCount;
  run.metrics.docsSkippedDuplicate += tileResult.duplicatesSuppressed;
  run.metrics.docsSkippedInvalid += tileResult.invalidCount;
  run.metrics.overpassRequests += 1;
  if (tileResult.warnings.some((w) => w.startsWith("overpass_failed"))) {
    run.metrics.overpassFailures += 1;
  }

  captureSamples(run, tileResult);

  for (const spot of tileResult.spots) {
    if (run.previewDocs.length < run.config.dryRunLimit) {
      run.previewDocs.push(buildSpotPreviewDoc(spot, tileResult.tile.tileId));
    }
    run.metrics.docsPreviewed += 1;
  }
  for (const route of tileResult.routes) {
    if (run.previewDocs.length < run.config.dryRunLimit) {
      run.previewDocs.push(buildRoutePreviewDoc(route, tileResult.tile.tileId));
    }
    run.metrics.docsPreviewed += 1;
  }
}

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

async function writeTileResult(input: {
  run: OsmNationalCopierRun;
  tileResult: CopierTileResult;
}): Promise<{ writtenSpots: number; writtenRoutes: number; writeMs: number }> {
  const { run, tileResult } = input;
  if (!run.writeMode || run.writeTarget === "none") {
    return { writtenSpots: 0, writtenRoutes: 0, writeMs: 0 };
  }

  assertCopierCollectionTarget("unexploredSpots");
  assertCopierCollectionTarget("unexploredRoutes");

  const writeOptions: OsmNationalWriteOptions = {
    writeTarget: run.writeTarget,
    operation: "osm_national_copier.write",
    confirmProductionWrite: run.confirmProductionWrite,
  };

  let spotsToWrite = tileResult.spots;
  let routesToWrite = tileResult.routes;

  if (run.config.skipExisting) {
    run.phase = "checking_existing";
    const spotIds = spotsToWrite.map((s) => s.id);
    const routeIds = routesToWrite.map((r) => r.id);
    const existingSpots = await findExistingFn()("unexploredSpots", spotIds);
    const existingRoutes = await findExistingFn()("unexploredRoutes", routeIds);
    run.metrics.readsActual += spotIds.length + routeIds.length;
    run.metrics.readsEstimated += spotIds.length + routeIds.length;
    if (existingSpots.size > 0) {
      run.metrics.docsSkippedExisting += existingSpots.size;
      spotsToWrite = spotsToWrite.filter((s) => !existingSpots.has(s.id));
    }
    if (existingRoutes.size > 0) {
      run.metrics.docsSkippedExisting += existingRoutes.size;
      routesToWrite = routesToWrite.filter((r) => !existingRoutes.has(r.id));
    }
  }

  if (
    run.config.maxDocsToWrite != null &&
    run.metrics.writesActual + spotsToWrite.length + routesToWrite.length >
      run.config.maxDocsToWrite
  ) {
    const remaining = Math.max(0, run.config.maxDocsToWrite - run.metrics.writesActual);
    if (remaining <= 0) {
      return { writtenSpots: 0, writtenRoutes: 0, writeMs: 0 };
    }
    if (spotsToWrite.length > remaining) {
      spotsToWrite = spotsToWrite.slice(0, remaining);
      routesToWrite = [];
    } else {
      const remainingRoutes = remaining - spotsToWrite.length;
      routesToWrite = routesToWrite.slice(0, Math.max(0, remainingRoutes));
    }
  }

  run.phase = "writing";
  run.metrics.writesEstimated += spotsToWrite.length + routesToWrite.length;

  const writeStart = nowMs();
  let writtenSpots = 0;
  let writtenRoutes = 0;

  if (spotsToWrite.length > 0) {
    writtenSpots = await writeSpotsFn()(spotsToWrite, writeOptions);
    run.metrics.writesActual += writtenSpots;
  }
  if (routesToWrite.length > 0) {
    writtenRoutes = await writeRoutesFn()(routesToWrite, writeOptions);
    run.metrics.writesActual += writtenRoutes;
  }

  const overflow = collectRouteGeometryOverflow(routesToWrite, tileResult.inventoryRoutes);
  for (const item of overflow) {
    const chunks = splitLargeGeometry({ coordinates: item.coordinates });
    if (chunks.length <= 1) continue;
    for (let i = 0; i < chunks.length; i += 1) {
      await writeGeometryChunkFn()({
        routeId: item.routeId,
        chunkIndex: i,
        coordinates: chunks[i],
        options: writeOptions,
      });
    }
  }

  return {
    writtenSpots,
    writtenRoutes,
    writeMs: nowMs() - writeStart,
  };
}

// ---------------------------------------------------------------------------
// Outer loop
// ---------------------------------------------------------------------------

export async function runCopierLoop(runId: string): Promise<OsmNationalCopierRun> {
  const startMs = nowMs();
  let run = getCopierRun(runId);
  if (!run) throw new Error(`copier_run_not_found:${runId}`);
  if (run.status === "cancelled") return run;
  if (run.status === "paused") {
    run.phase = "paused";
    putCopierRun(run);
    return run;
  }

  run.status = "running";
  run.phase = "fetching";
  run.startedAt = run.startedAt ?? new Date().toISOString();
  putCopierRun(run);
  logEvent({ runId, phase: "fetching", message: "Copier run started." });

  for (const record of run.tiles) {
    const latest = getCopierRun(runId);
    if (!latest) break;
    run = latest;

    if (run.status === "paused") {
      run.phase = "paused";
      putCopierRun(run);
      logEvent({ runId, phase: "paused", message: "Run paused." });
      return run;
    }
    if (run.status === "cancelled") {
      logEvent({ runId, phase: "failed", message: "Run cancelled." });
      return run;
    }
    if (run.dryRunLimitReached) break;
    if (
      run.config.maxChunksToProcess != null &&
      run.metrics.chunksCompleted >= run.config.maxChunksToProcess
    ) {
      logEvent({
        runId,
        phase: "complete",
        message: "Reached maxChunksToProcess; stopping cleanly.",
        counts: { maxChunksToProcess: run.config.maxChunksToProcess },
      });
      break;
    }
    if (record.status === "completed" || record.status === "skipped") continue;

    record.status = "running";
    record.attempts += 1;
    record.startedAt = new Date().toISOString();
    run.currentTileId = record.tile.tileId;
    run.currentStateCode = record.tile.stateCode;
    run.phase = "fetching";
    putCopierRun(run);

    let tileResult: CopierTileResult;
    try {
      tileResult = await processCopierTile({ run, tile: record.tile });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record.status = "failed";
      record.lastError = message;
      run.metrics.chunksFailed += 1;
      run.metrics.overpassFailures += 1;
      logEvent({
        runId,
        phase: "fetching",
        level: "error",
        tileId: record.tile.tileId,
        stateCode: record.tile.stateCode,
        message: `Tile failed: ${message}`,
      });
      record.finishedAt = new Date().toISOString();
      putCopierRun(run);
      continue;
    }

    run.phase = "building_docs";
    applyTileResultToRun({ run, record, tileResult });

    if (run.mode === "write" && (tileResult.spots.length || tileResult.routes.length)) {
      try {
        const writeOut = await writeTileResult({ run, tileResult });
        record.writeMs = writeOut.writeMs;
        record.writtenSpots = writeOut.writtenSpots;
        record.writtenRoutes = writeOut.writtenRoutes;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        record.status = "failed";
        record.lastError = message;
        run.lastError = message;
        run.metrics.chunksFailed += 1;
        logEvent({
          runId,
          phase: "writing",
          level: "error",
          tileId: record.tile.tileId,
          message: `Write failed: ${message}`,
        });
        record.finishedAt = new Date().toISOString();
        putCopierRun(run);
        if (run.config.stopOnBudgetExceeded && /BUDGET_EXCEEDED/.test(message)) {
          run.status = "paused";
          run.phase = "paused";
          putCopierRun(run);
          return run;
        }
        continue;
      }
    }

    record.status = "completed";
    record.finishedAt = new Date().toISOString();
    run.metrics.chunksCompleted += 1;
    updateMetricsForElapsed(run, startMs);

    if (
      run.mode === "dry_run_preview" &&
      run.metrics.docsPreviewed >= run.config.dryRunLimit
    ) {
      run.dryRunLimitReached = true;
      logEvent({
        runId,
        phase: "complete",
        message: `Dry-run limit reached (${run.config.dryRunLimit}).`,
      });
    }

    putCopierRun(run);
    logEvent({
      runId,
      phase: "complete",
      tileId: record.tile.tileId,
      stateCode: record.tile.stateCode,
      message: `Tile complete (spots=${record.acceptedSpots}, routes=${record.acceptedRoutes}, written=${record.writtenSpots + record.writtenRoutes}).`,
      counts: {
        acceptedSpots: record.acceptedSpots,
        acceptedRoutes: record.acceptedRoutes,
        writtenSpots: record.writtenSpots,
        writtenRoutes: record.writtenRoutes,
      },
    });
  }

  const final = getCopierRun(runId);
  if (!final) throw new Error(`copier_run_disappeared:${runId}`);
  final.status =
    final.status === "paused" || final.status === "cancelled" ? final.status : "completed";
  final.phase = final.status === "completed" ? "complete" : final.phase;
  final.finishedAt = new Date().toISOString();
  final.currentTileId = null;
  final.currentStateCode = null;
  updateMetricsForElapsed(final, startMs);
  putCopierRun(final);
  logEvent({ runId, phase: final.phase, message: `Run ${final.status}.` });
  return final;
}
