import { randomUUID } from "node:crypto";
import type { OsmNationalRun, UnexploredRoute } from "../../contracts/entities/osm-national-entities.contract.js";
import { emptyOsmNationalCounts } from "../../contracts/entities/osm-national-entities.contract.js";
import type { OsmNationalWriteTarget } from "./national/osmNationalWriteGuard.js";
import type { LocavaInventoryRoute } from "../../lib/inventory/inventoryLocavaTypes.js";
import { getStateBounds } from "../../lib/inventory/offroad/offroadStateBounds.js";
import { getOffroadStateRegistry } from "../../lib/inventory/offroad/sources/offroadSourceRegistry.js";
import { runStateOffroadDryRun, type OffroadDryRunProgress } from "./offroadNationalImport.service.js";
import { getBestRunForState, getOffroadNationalRun, isStateEnabled, putOffroadNationalRun, type OffroadNationalDryRun } from "./offroadNationalRunStore.js";
import {
  buildUnexploredDocsFromClassification,
  buildUnexploredRouteFromInventory,
} from "./national/osmNationalDocBuilder.js";
import { writeUnexploredChunkDocs } from "./national/osmNationalWriter.service.js";
import { writeUnexploredTilesForChunk } from "./national/osmNationalTileWriter.service.js";
import {
  isFirestoreEmulatorActiveForOsmNational,
  OSM_NATIONAL_PRODUCTION_CONFIRMATION,
  OSM_NATIONAL_PRODUCTION_ENV_VAR,
  VERMONT_OFFROAD_PRODUCTION_PASSWORD,
} from "./national/osmNationalWriteGuard.js";
import {
  appendVermontImportLog,
  createVermontImportSession,
  getVermontImportSession,
  patchVermontImportSession,
  type VermontImportPreview,
  type VermontImportSession,
  type VermontImportWriteResult,
} from "./vermontOffroadImportSessionStore.js";

const STATE_CODE = "VT";

export type VermontImportConfig = {
  stateCode: typeof STATE_CODE;
  stateName: string;
  stateBbox: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  emulatorActive: boolean;
  productionWriteEnvVar: string;
  productionWriteEnvUnlocked: boolean;
  productionPasswordOnly: boolean;
  productionConfirmationPhrase: string;
};

export type StartVermontScanInput = {
  reuseCachedRun?: boolean;
  /** OSM statewide Overpass is very slow/unreliable — off by default. VTrans + USFS cover official Class 4. */
  includeOsmSupplemental?: boolean;
};

export type VermontRouteSearchRow = {
  sourceKey: string;
  name: string;
  subtitle: string | null;
  activity: string;
  primaryActivity: string | null;
  activities: string[];
  mapReadiness: string | null;
  offroadCategory: string | null;
  legalDisplayLabel: string | null;
  accessStatus: string | null;
  source: string;
  distanceMiles: number | null;
  distanceMeters: number | null;
  locavaScore: number | null;
  confidence: string | null;
  eligibleForWrite: boolean;
  lat: number;
  lng: number;
  geometryPreview:
    | { type: "none" }
    | { type: "line"; coordinates: Array<{ lat: number; lng: number }> }
    | { type: "multiline"; segments: Array<Array<{ lat: number; lng: number }>> };
};

export type SearchVermontOffroadRoutesInput = {
  runId: string;
  q?: string;
  sourceId?: string;
  mapReadiness?: string;
  offroadCategory?: string;
  eligibleOnly?: boolean;
  includePublicOnly?: boolean;
  includeReviewItems?: boolean;
  limit?: number;
  offset?: number;
};

export type StartVermontWriteInput = {
  sessionId: string;
  limit?: number | "all";
  writeTarget: Exclude<OsmNationalWriteTarget, "none">;
  confirmProductionWrite?: string;
  includePublicOnly?: boolean;
  includeReviewItems?: boolean;
  writeTiles?: boolean;
};

function countByKey<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function routeGeometryPreview(route: LocavaInventoryRoute): VermontRouteSearchRow["geometryPreview"] {
  if (route.segments && route.segments.length > 0) {
    if (route.segments.length === 1) {
      return { type: "line", coordinates: route.segments[0]! };
    }
    return { type: "multiline", segments: route.segments };
  }
  if (route.coordinates && route.coordinates.length > 0) {
    return { type: "line", coordinates: route.coordinates };
  }
  return { type: "none" };
}

function routeSearchHaystack(route: LocavaInventoryRoute): string {
  return [
    route.name,
    route.subtitle,
    route.sourceKey,
    route.source,
    route.activity,
    route.primaryActivity,
    ...(route.activities ?? []),
    ...(route.searchableAliases ?? []),
    route.offroad?.offroadCategory,
    route.offroad?.legalDisplayLabel,
    route.offroad?.accessStatus,
    route.mapReadiness,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function routeToVermontSearchRow(input: {
  route: LocavaInventoryRoute;
  runId: string;
  includePublicOnly?: boolean;
  includeReviewItems?: boolean;
}): VermontRouteSearchRow {
  const includePublicOnly = input.includePublicOnly !== false;
  const includeReviewItems = input.includeReviewItems ?? false;
  const eligibleForWrite = Boolean(
    buildUnexploredRouteFromInventory({
      route: input.route,
      stateCode: STATE_CODE,
      runId: input.runId,
      chunkId: "vt-offroad-search",
      writeMode: false,
      writeTarget: "none",
      includePublicOnly,
      includeReviewItems,
    })
  );

  return {
    sourceKey: input.route.sourceKey,
    name: input.route.name,
    subtitle: input.route.subtitle ?? null,
    activity: input.route.activity,
    primaryActivity: input.route.primaryActivity ?? input.route.activity ?? null,
    activities: input.route.activities ?? [],
    mapReadiness: input.route.mapReadiness ?? null,
    offroadCategory: input.route.offroad?.offroadCategory ?? null,
    legalDisplayLabel: input.route.offroad?.legalDisplayLabel ?? null,
    accessStatus: input.route.offroad?.accessStatus ?? null,
    source: input.route.source,
    distanceMiles: input.route.distanceMiles ?? null,
    distanceMeters: input.route.distanceMeters ?? null,
    locavaScore: input.route.locavaScore ?? null,
    confidence: input.route.confidence ?? null,
    eligibleForWrite,
    lat: input.route.center.lat,
    lng: input.route.center.lng,
    geometryPreview: routeGeometryPreview(input.route),
  };
}

export function searchVermontOffroadRoutes(input: SearchVermontOffroadRoutesInput): {
  runId: string;
  total: number;
  limit: number;
  offset: number;
  results: VermontRouteSearchRow[];
} {
  const run = getOffroadNationalRun(input.runId);
  if (!run) throw new Error("run_not_found");

  const q = input.q?.trim().toLowerCase() ?? "";
  const includePublicOnly = input.includePublicOnly !== false;
  const includeReviewItems = input.includeReviewItems ?? false;

  let routes = run.routes;

  if (input.sourceId) {
    routes = routes.filter((r) => r.source === input.sourceId || r.tags._primarySource === input.sourceId);
  }
  if (input.mapReadiness) {
    routes = routes.filter((r) => (r.mapReadiness ?? "unknown") === input.mapReadiness);
  }
  if (input.offroadCategory) {
    routes = routes.filter((r) => r.offroad?.offroadCategory === input.offroadCategory);
  }
  if (q) {
    routes = routes.filter((r) => routeSearchHaystack(r).includes(q));
  }

  const rows = routes.map((route) =>
    routeToVermontSearchRow({
      route,
      runId: input.runId,
      includePublicOnly,
      includeReviewItems,
    })
  );

  const filtered = input.eligibleOnly ? rows.filter((r) => r.eligibleForWrite) : rows;
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 5000);
  const offset = Math.max(input.offset ?? 0, 0);

  return {
    runId: input.runId,
    total: filtered.length,
    limit,
    offset,
    results: filtered.slice(offset, offset + limit),
  };
}

function sourcePrefix(source: string): string {
  if (source.startsWith("vt_")) return "vt_state";
  if (source.includes("openstreetmap") || source === "osm_offroad") return "osm";
  if (source.startsWith("usfs")) return "usfs";
  if (source.startsWith("blm")) return "blm";
  return source.split("_")[0] ?? source;
}

export function buildVermontWritePreview(input: {
  routes: LocavaInventoryRoute[];
  runId: string;
  includePublicOnly?: boolean;
  includeReviewItems?: boolean;
}): VermontImportPreview {
  const includePublicOnly = input.includePublicOnly !== false;
  const includeReviewItems = input.includeReviewItems ?? false;

  const { routes: eligibleRoutes } = buildUnexploredDocsFromClassification({
    spots: [],
    routes: input.routes,
    stateCode: STATE_CODE,
    runId: input.runId,
    chunkId: "vt-offroad-preview",
    writeMode: false,
    writeTarget: "none",
    includePublicOnly,
    includeReviewItems,
    includeOsmSpots: false,
    includeOsmRoutes: false,
    includeOffroad: true,
  });

  return {
    totalRoutesFetched: input.routes.length,
    eligibleUndiscoveredPosts: eligibleRoutes.length,
    filteredOutByPublicOnly: input.routes.length - eligibleRoutes.length,
    byMapReadiness: countByKey(input.routes, (r) => r.mapReadiness ?? "unknown"),
    bySourcePrefix: countByKey(input.routes, (r) => sourcePrefix(r.source)),
    sourceCounts: [],
  };
}

export function buildEligibleUnexploredRoutes(input: {
  routes: LocavaInventoryRoute[];
  runId: string;
  includePublicOnly?: boolean;
  includeReviewItems?: boolean;
  limit?: number | "all";
}): UnexploredRoute[] {
  const includePublicOnly = input.includePublicOnly !== false;
  const includeReviewItems = input.includeReviewItems ?? false;

  const { routes } = buildUnexploredDocsFromClassification({
    spots: [],
    routes: input.routes,
    stateCode: STATE_CODE,
    runId: input.runId,
    chunkId: "vt-offroad-bulk",
    writeMode: true,
    writeTarget: "production",
    includePublicOnly,
    includeReviewItems,
    includeOsmSpots: false,
    includeOsmRoutes: false,
    includeOffroad: true,
  });

  if (input.limit === "all" || input.limit == null) return routes;
  return routes.slice(0, Math.max(0, input.limit));
}

function buildSyntheticWriteRun(input: {
  runId: string;
  writeTarget: Exclude<OsmNationalWriteTarget, "none">;
  confirmProductionWrite?: string;
  includePublicOnly: boolean;
  includeReviewItems: boolean;
  writeTiles: boolean;
  docCount: number;
}): OsmNationalRun {
  const now = new Date().toISOString();
  return {
    runId: input.runId,
    runType: "national_osm_unexplored_import",
    status: "running",
    writeMode: true,
    writeTarget: input.writeTarget,
    confirmProductionWrite: input.confirmProductionWrite,
    config: {
      states: [STATE_CODE],
      chunkSizeKm: 120,
      maxConcurrentStates: 1,
      maxConcurrentChunks: 1,
      maxWritesPerSecond: 10,
      maxChunksPerMinute: 6,
      includeOsmSpots: false,
      includeOsmRoutes: false,
      includeOffroad: true,
      includePublicOnly: input.includePublicOnly,
      includeReviewItems: input.includeReviewItems,
      skipCompletedChunks: true,
      forceReprocess: false,
      dryRunOnly: false,
      tileBuildMode: input.writeTiles ? "per_chunk" : "none",
      maxTotalWrites: Math.max(input.docCount + 1000, 5000),
      maxWritesPerMinute: 3000,
      maxChunkWrites: Math.max(input.docCount + 100, 5000),
      stopOnBudgetExceeded: true,
      pauseOnErrorRateAbovePercent: 25,
    },
    progress: {
      totalStates: 1,
      completedStates: 0,
      failedStates: 0,
      totalChunks: 1,
      completedChunks: 0,
      runningChunks: 1,
      failedChunks: 0,
      skippedChunks: 0,
      estimatedTotalChunks: 1,
      percentComplete: 0,
      etaSeconds: null,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
    },
    counts: emptyOsmNationalCounts(),
    currentActivity: {
      stateCode: STATE_CODE,
      chunkId: "vt-offroad-bulk",
      step: "writing",
      message: "Writing Vermont offroad undiscovered routes",
      startedAt: now,
    },
    safety: {
      productionWritesBlockedByDefault: true,
      productionWriteConfirmed:
        input.confirmProductionWrite === OSM_NATIONAL_PRODUCTION_CONFIRMATION ||
        input.confirmProductionWrite === VERMONT_OFFROAD_PRODUCTION_PASSWORD,
      maxWriteBudget: Math.max(input.docCount + 1000, 5000),
      stoppedBecauseBudgetExceeded: false,
    },
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function getVermontImportConfig(): VermontImportConfig {
  const registry = getOffroadStateRegistry(STATE_CODE);
  const bounds = getStateBounds(STATE_CODE);
  if (!registry || !bounds) {
    throw new Error("vermont_registry_or_bounds_missing");
  }

  return {
    stateCode: STATE_CODE,
    stateName: registry.stateName,
    stateBbox: bounds.bbox,
    emulatorActive: isFirestoreEmulatorActiveForOsmNational(),
    productionWriteEnvVar: OSM_NATIONAL_PRODUCTION_ENV_VAR,
    productionWriteEnvUnlocked: true,
    productionPasswordOnly: true,
    productionConfirmationPhrase: VERMONT_OFFROAD_PRODUCTION_PASSWORD,
  };
}

export function startVermontOffroadScan(input: StartVermontScanInput = {}): VermontImportSession {
  const session = createVermontImportSession();
  const sessionId = session.sessionId;

  appendVermontImportLog(sessionId, "info", "Vermont off-road import session started.");
  patchVermontImportSession(sessionId, {
    phase: "scanning",
    scanStartedAt: new Date().toISOString(),
    scanProgress: {
      step: "starting",
      message: "Starting Vermont statewide scan…",
      includeOsmSupplemental: input.includeOsmSupplemental === true,
      elapsedMs: 0,
      percentComplete: 0,
    },
  });

  void runScanJob(sessionId, input.reuseCachedRun === true, input.includeOsmSupplemental === true);
  return getVermontImportSession(sessionId)!;
}

function progressPercent(progress: OffroadDryRunProgress, includeOsm: boolean): number {
  if (progress.phase === "complete") return 100;
  if (progress.phase === "merging") return 92;
  const sourceTotal = progress.sourceTotal ?? (includeOsm ? 4 : 3);
  const sourceIndex = Math.max(0, (progress.sourceIndex ?? 1) - 1);
  const chunkTotal = progress.chunkTotal ?? 1;
  const chunkIndex = progress.chunkIndex ?? 0;
  const sourceWeight = 88 / sourceTotal;
  const withinSource = chunkTotal > 0 ? (chunkIndex / chunkTotal) * sourceWeight : sourceWeight;
  return Math.min(91, Math.round(sourceIndex * sourceWeight + withinSource));
}

function applyScanProgress(sessionId: string, startedAt: number, includeOsm: boolean, progress: OffroadDryRunProgress): void {
  patchVermontImportSession(sessionId, {
    scanProgress: {
      step: progress.phase,
      message: progress.message,
      sourceId: progress.sourceId ?? null,
      sourceIndex: progress.sourceIndex,
      sourceTotal: progress.sourceTotal,
      chunkIndex: progress.chunkIndex,
      chunkTotal: progress.chunkTotal,
      routesAcceptedSoFar: progress.routesAcceptedSoFar,
      percentComplete: progressPercent(progress, includeOsm),
      elapsedMs: Date.now() - startedAt,
      includeOsmSupplemental: includeOsm,
    },
  });
  if (progress.phase === "source_complete") {
    appendVermontImportLog(sessionId, "info", progress.message, {
      sourceId: progress.sourceId,
      routesAcceptedSoFar: progress.routesAcceptedSoFar,
    });
  } else if (progress.phase === "source_start") {
    appendVermontImportLog(sessionId, "info", progress.message, { sourceId: progress.sourceId });
  } else if (progress.phase === "merging") {
    appendVermontImportLog(sessionId, "info", progress.message);
  }
}

async function runVermontStateDryRun(sessionId: string, includeOsmSupplemental: boolean) {
  const startedAt = Date.now();
  const excludeSourceIds = includeOsmSupplemental ? [] : ["osm_offroad"];
  if (!includeOsmSupplemental) {
    appendVermontImportLog(
      sessionId,
      "info",
      "Skipping OSM statewide Overpass (slow/unreliable). Using VTrans Class 4 + Legal Trails and USFS MVUM."
    );
  } else {
    appendVermontImportLog(sessionId, "warn", "Including OSM supplemental — this can take 30+ minutes statewide.");
  }

  return runStateOffroadDryRun({
    stateCode: STATE_CODE,
    sourceFilter: "all",
    excludeSourceIds,
    onProgress: (progress) => applyScanProgress(sessionId, startedAt, includeOsmSupplemental, progress),
  });
}

async function runScanJob(sessionId: string, reuseCachedRun: boolean, includeOsmSupplemental: boolean): Promise<void> {
  try {
    const registry = getOffroadStateRegistry(STATE_CODE);
    if (!registry) throw new Error("vermont_registry_missing");
    if (!isStateEnabled(registry.stateCode, registry.enabled)) {
      throw new Error("vermont_state_disabled_enable_in_offroad_master");
    }

    const bounds = getStateBounds(STATE_CODE);
    if (!bounds) throw new Error("vermont_bounds_missing");

    appendVermontImportLog(sessionId, "info", "Fetching ALL Vermont off-road trails (full state — no bounding box).", {
      bbox: bounds.bbox,
      includeOsmSupplemental,
    });

    let runId: string;
    let routes: LocavaInventoryRoute[];
    let sourceCounts: VermontImportPreview["sourceCounts"];

    if (reuseCachedRun) {
      const cached = getBestRunForState(STATE_CODE);
      if (cached?.status === "completed" && cached.routes.length > 0) {
        appendVermontImportLog(sessionId, "warn", "Reusing cached in-memory VT dry-run (skip network fetch).", {
          runId: cached.runId,
          routeCount: cached.routes.length,
          completedAt: cached.completedAt,
        });
        runId = cached.runId;
        routes = cached.routes;
        sourceCounts = cached.sourceCounts.map((s) => ({
          sourceId: s.sourceId,
          rawFeatures: s.rawFeatures,
          routesAccepted: s.routesAccepted,
          rejected: s.rejected,
          errors: s.errors,
        }));
      } else {
        appendVermontImportLog(sessionId, "warn", "No usable cached VT run — running fresh statewide fetch.");
        const run = await runVermontStateDryRun(sessionId, includeOsmSupplemental);
        if (run.status !== "completed") throw new Error(run.error ?? "scan_failed");
        runId = run.runId;
        routes = run.routes;
        sourceCounts = run.sourceCounts.map((s) => ({
          sourceId: s.sourceId,
          rawFeatures: s.rawFeatures,
          routesAccepted: s.routesAccepted,
          rejected: s.rejected,
          errors: s.errors,
        }));
      }
    } else {
      appendVermontImportLog(
        sessionId,
        "info",
        includeOsmSupplemental
          ? "Querying VTrans, USFS, BLM, and OSM supplemental statewide…"
          : "Querying VTrans Class 4/Legal Trails + USFS MVUM statewide…"
      );
      const run = await runVermontStateDryRun(sessionId, includeOsmSupplemental);
      if (run.status !== "completed") throw new Error(run.error ?? "scan_failed");
      runId = run.runId;
      routes = run.routes;
      sourceCounts = run.sourceCounts.map((s) => ({
        sourceId: s.sourceId,
        rawFeatures: s.rawFeatures,
        routesAccepted: s.routesAccepted,
        rejected: s.rejected,
        errors: s.errors,
      }));

      for (const sc of sourceCounts) {
        appendVermontImportLog(sessionId, "info", `Source ${sc.sourceId}: ${sc.routesAccepted} routes accepted (${sc.rawFeatures} raw).`, {
          rejected: sc.rejected,
          errors: sc.errors,
        });
      }
    }

    const preview = buildVermontWritePreview({
      routes,
      runId,
      includePublicOnly: true,
      includeReviewItems: false,
    });
    preview.sourceCounts = sourceCounts;

    appendVermontImportLog(
      sessionId,
      "success",
      `Scan complete — ${preview.totalRoutesFetched} routes fetched, ${preview.eligibleUndiscoveredPosts} eligible undiscovered posts (public-ready).`,
      {
        filteredOutByPublicOnly: preview.filteredOutByPublicOnly,
        byMapReadiness: preview.byMapReadiness,
        bySourcePrefix: preview.bySourcePrefix,
      }
    );

    patchVermontImportSession(sessionId, {
      phase: "scan_complete",
      runId,
      preview,
      scanProgress: null,
      scanCompletedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendVermontImportLog(sessionId, "error", `Scan failed: ${message}`);
    patchVermontImportSession(sessionId, {
      phase: "failed",
      error: message,
      scanProgress: null,
      scanCompletedAt: new Date().toISOString(),
    });
  }
}

export function startVermontOffroadWrite(input: StartVermontWriteInput): VermontImportSession {
  const session = getVermontImportSession(input.sessionId);
  if (!session) throw new Error("session_not_found");
  if (session.phase !== "scan_complete" && session.phase !== "write_complete") {
    throw new Error(`session_not_ready:${session.phase}`);
  }
  if (!session.runId) throw new Error("session_missing_run_id");

  patchVermontImportSession(input.sessionId, {
    phase: "writing",
    writeStartedAt: new Date().toISOString(),
    writeResult: null,
    error: null,
  });

  void runWriteJob(input);
  return getVermontImportSession(input.sessionId)!;
}

async function runWriteJob(input: StartVermontWriteInput): Promise<void> {
  const sessionId = input.sessionId;
  const limit = input.limit ?? "all";
  const includePublicOnly = input.includePublicOnly !== false;
  const includeReviewItems = input.includeReviewItems ?? false;
  const writeTiles = input.writeTiles !== false;

  try {
    const session = getVermontImportSession(sessionId);
    if (!session?.runId) throw new Error("session_missing_run_id");

    const offroadRun = getOffroadNationalRun(session.runId);
    if (!offroadRun || offroadRun.routes.length === 0) {
      throw new Error("offroad_run_missing_or_empty");
    }

    appendVermontImportLog(sessionId, "info", "Building unexplored route documents…", {
      limit,
      includePublicOnly,
      includeReviewItems,
      writeTarget: input.writeTarget,
    });

    const routes = buildEligibleUnexploredRoutes({
      routes: offroadRun.routes,
      runId: session.runId,
      includePublicOnly,
      includeReviewItems,
      limit,
    });

    if (routes.length === 0) {
      throw new Error("no_eligible_routes_to_write");
    }

    appendVermontImportLog(sessionId, "info", `Prepared ${routes.length} undiscovered route doc(s) for Firestore write.`);

    const writeRunId = randomUUID();
    const writeRun = buildSyntheticWriteRun({
      runId: writeRunId,
      writeTarget: input.writeTarget,
      confirmProductionWrite: input.confirmProductionWrite,
      includePublicOnly,
      includeReviewItems,
      writeTiles,
      docCount: routes.length,
    });

    appendVermontImportLog(sessionId, "info", `Writing to unexploredRoutes (writeTarget=${input.writeTarget})…`);

    const writeResult = await writeUnexploredChunkDocs({
      run: writeRun,
      spots: [],
      routes,
    });

    appendVermontImportLog(sessionId, "info", `Route write finished: ${writeResult.writtenRoutes} written, ${writeResult.writeErrors} error(s).`, {
      skippedBecauseDryRun: writeResult.skippedBecauseDryRun,
    });

    if (writeResult.writeErrors > 0 && writeResult.writtenRoutes === 0) {
      throw new Error(
        `firestore_write_blocked_or_failed:${writeResult.writeErrors}_error(s)_—_check production password or emulator`
      );
    }

    let writtenTiles = 0;
    if (writeTiles && writeResult.writtenRoutes > 0) {
      const bounds = getStateBounds(STATE_CODE);
      if (bounds) {
        appendVermontImportLog(sessionId, "info", "Building unexploredTiles for Vermont bbox…");
        writtenTiles = await writeUnexploredTilesForChunk({
          run: writeRun,
          spots: [],
          routes,
          chunkBbox: bounds.bbox,
        });
        appendVermontImportLog(sessionId, "success", `Wrote ${writtenTiles} tile document(s).`);
      }
    }

    const result: VermontImportWriteResult = {
      requestedLimit: limit,
      docsBuilt: routes.length,
      writtenRoutes: writeResult.writtenRoutes,
      writtenTiles,
      writeErrors: writeResult.writeErrors,
      skippedBecauseDryRun: writeResult.skippedBecauseDryRun,
      sampleRouteIds: routes.slice(0, 5).map((r) => r.id),
    };

    appendVermontImportLog(
      sessionId,
      "success",
      `Write complete — ${result.writtenRoutes} undiscovered route post(s) created in Firestore.`,
      result as unknown as Record<string, unknown>
    );

    patchVermontImportSession(sessionId, {
      phase: "write_complete",
      writeResult: result,
      writeCompletedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendVermontImportLog(sessionId, "error", `Write failed: ${message}`);
    patchVermontImportSession(sessionId, {
      phase: "failed",
      error: message,
      writeCompletedAt: new Date().toISOString(),
    });
  }
}

export const VERMONT_BROWSER_CACHE_VERSION = 1 as const;

export type VermontBrowserCachePayload = {
  version: typeof VERMONT_BROWSER_CACHE_VERSION;
  savedAt: string;
  includeOsmSupplemental?: boolean;
  run: {
    runId: string;
    stateCode: string;
    sourceIds: string[];
    sourceFilter?: "all" | "federal" | "state" | "osm";
    bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
    chunkCount?: number;
    routesBounds?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
    routesFilteredOutOfState?: number;
    sourceCounts: VermontImportPreview["sourceCounts"];
    routes: LocavaInventoryRoute[];
    areaContexts?: unknown[];
    rejectedCount: number;
    startedAt: string;
    completedAt?: string;
  };
  preview: VermontImportPreview;
};

export function exportVermontBrowserCache(sessionId: string): VermontBrowserCachePayload {
  const session = getVermontImportSession(sessionId);
  if (!session?.runId) throw new Error("session_not_ready");
  const run = getOffroadNationalRun(session.runId);
  if (!run || run.status !== "completed") throw new Error("run_not_ready");
  if (!session.preview) throw new Error("session_missing_preview");

  return {
    version: VERMONT_BROWSER_CACHE_VERSION,
    savedAt: new Date().toISOString(),
    includeOsmSupplemental: session.scanProgress?.includeOsmSupplemental === true,
    run: {
      runId: run.runId,
      stateCode: run.stateCode,
      sourceIds: run.sourceIds,
      sourceFilter: run.sourceFilter,
      bbox: run.bbox,
      chunkCount: run.chunkCount,
      routesBounds: run.routesBounds,
      routesFilteredOutOfState: run.routesFilteredOutOfState,
      sourceCounts: session.preview.sourceCounts,
      routes: run.routes,
      areaContexts: run.areaContexts,
      rejectedCount: run.rejectedCount,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    },
    preview: session.preview,
  };
}

export function restoreVermontOffroadFromBrowserCache(payload: VermontBrowserCachePayload): VermontImportSession {
  if (payload.version !== VERMONT_BROWSER_CACHE_VERSION) {
    throw new Error(`unsupported_cache_version:${payload.version}`);
  }
  if (payload.run.stateCode !== STATE_CODE) throw new Error("cache_not_vermont");
  if (!Array.isArray(payload.run.routes) || payload.run.routes.length === 0) {
    throw new Error("cache_empty_routes");
  }

  putOffroadNationalRun({
    runId: payload.run.runId,
    stateCode: payload.run.stateCode,
    sourceIds: payload.run.sourceIds,
    sourceFilter: payload.run.sourceFilter ?? "all",
    status: "completed",
    dryRun: true,
    productionWritesBlocked: true,
    startedAt: payload.run.startedAt,
    completedAt: payload.run.completedAt ?? payload.savedAt,
    bbox: payload.run.bbox,
    chunkCount: payload.run.chunkCount,
    routesBounds: payload.run.routesBounds,
    routesFilteredOutOfState: payload.run.routesFilteredOutOfState,
    sourceCounts: payload.run.sourceCounts.map((s) => ({
      ...s,
      areasAccepted: 0,
      hidden: 0,
      review: 0,
    })),
    routes: payload.run.routes,
    areaContexts: (payload.run.areaContexts ?? []) as OffroadNationalDryRun["areaContexts"],
    rejectedCount: payload.run.rejectedCount,
  });

  const session = createVermontImportSession();
  const sessionId = session.sessionId;
  appendVermontImportLog(
    sessionId,
    "success",
    `Restored ${payload.run.routes.length} routes from browser cache (saved ${payload.savedAt}).`,
    { runId: payload.run.runId, savedAt: payload.savedAt }
  );
  patchVermontImportSession(sessionId, {
    phase: "scan_complete",
    runId: payload.run.runId,
    preview: payload.preview,
    scanCompletedAt: new Date().toISOString(),
  });
  return getVermontImportSession(sessionId)!;
}
