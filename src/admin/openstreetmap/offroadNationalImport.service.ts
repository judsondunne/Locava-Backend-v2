import { randomUUID } from "node:crypto";
import type { InventoryBbox } from "../../contracts/entities/inventory-entities.contract.js";
import { isInventoryProductionWriteUnlocked } from "../inventory/inventoryWriteGuard.js";
import {
  chunkStateBbox,
  dedupeRawFeatures,
  fetchChunksWithConcurrency,
} from "../../lib/inventory/offroad/offroadChunking.js";
import { getStateBounds } from "../../lib/inventory/offroad/offroadStateBounds.js";
import { mergeOffroadRoutesFromSources } from "../../lib/inventory/offroad/offroadSourceMerger.js";
import { mergeOsmAndVtransOffroadRoutes } from "../../lib/inventory/offroad/inventoryOffroadMerge.js";
import { filterRoutesToExplicitOffroadClasses } from "../../lib/inventory/offroad/offroadExplicitClassFilter.js";
import { mergeVtransInventoryRoutes } from "../../lib/inventory/offroad/vtransRoadSegmentMerge.js";
import {
  filterRoutesToStateBbox,
  unionBoundsForRoutes,
} from "../../lib/inventory/offroad/offroadRouteBounds.js";
import {
  buildStateCoverageDiagnostics,
  getOffroadStateRegistry,
  listOffroadStateRegistries,
} from "../../lib/inventory/offroad/sources/offroadSourceRegistry.js";
import type {
  NationalOffroadSourceAdapter,
  OffroadAreaContext,
  OffroadRawFeature,
  RejectedOffroadCandidate,
} from "../../lib/inventory/offroad/sources/nationalOffroadSource.types.js";
import {
  DEFAULT_OFFROAD_CHUNK_CONFIG,
  type OffroadSourceRegistryEntry,
} from "../../lib/inventory/offroad/sources/nationalOffroadSource.types.js";
import { usfsMvumAdapter } from "../../lib/inventory/offroad/sources/usfsMvumSource.js";
import { blmGtlfAdapter } from "../../lib/inventory/offroad/sources/blmGtlfSource.js";
import { osmOffroadAdapter } from "../../lib/inventory/offroad/sources/osmOffroadNationalSource.js";
import { vtVtransArcgisAdapter } from "../../lib/inventory/offroad/sources/stateArcgisOffroadSource.js";
import { nhClassViOffroadAdapter } from "../../lib/inventory/offroad/sources/nhClassViOffroadSource.js";
import { caBlmOhvAreaAdapter } from "../../lib/inventory/offroad/sources/offroadAreaContextSource.js";
import { canSourcePublishPublic } from "../../lib/inventory/offroad/sourceValidation.js";
import type { LocavaInventoryRoute } from "../../lib/inventory/inventoryLocavaTypes.js";
import { applyOffroadMapReadinessToRoutes } from "../../lib/inventory/offroad/offroadRouteMapReadiness.js";
import { buildOffroadStateCatalog } from "../../lib/inventory/offroad/offroadPipelineConfig.js";
import {
  getBestRunForState,
  isSourceEnabled,
  isStateEnabled,
  putOffroadNationalRun,
  setStateEnabled,
  type OffroadNationalDryRun,
  type OffroadSourceRunCounts,
} from "./offroadNationalRunStore.js";

const ADAPTERS: Record<string, NationalOffroadSourceAdapter> = {
  usfs_mvum: usfsMvumAdapter,
  blm_gtlf: blmGtlfAdapter,
  osm_offroad: osmOffroadAdapter,
  vt_vtrans_public_highway_system: vtVtransArcgisAdapter,
  nh_class_vi_roads: nhClassViOffroadAdapter,
  ca_blm_ohv_areas: caBlmOhvAreaAdapter,
};

const FEDERAL_SOURCE_IDS = ["usfs_mvum", "blm_gtlf", "osm_offroad"] as const;

export type OffroadDryRunProgress = {
  phase: "source_start" | "chunk_complete" | "source_complete" | "merging" | "complete";
  sourceId?: string;
  sourceIndex?: number;
  sourceTotal?: number;
  chunkIndex?: number;
  chunkTotal?: number;
  routesAcceptedSoFar?: number;
  message: string;
};

export type RunStateDryRunInput = {
  stateCode: string;
  sourceIds?: string[];
  excludeSourceIds?: string[];
  sourceFilter?: "all" | "federal" | "state" | "osm";
  maxRecordsPerSource?: number;
  includeNotAssessedBlm?: boolean;
  chunkConfig?: Partial<typeof DEFAULT_OFFROAD_CHUNK_CONFIG>;
  customBbox?: InventoryBbox;
  onProgress?: (progress: OffroadDryRunProgress) => void;
};

export type BatchDryRunInput = {
  stateCodes: string[];
  sourceFilter?: RunStateDryRunInput["sourceFilter"];
  confirmAllStates?: boolean;
  maxConcurrentStates?: number;
};

function assertDryRunSafe(): void {
  if (isInventoryProductionWriteUnlocked()) {
    throw new Error("offroad_national_dry_run_requires_production_writes_blocked");
  }
}

function resolveSourceIds(
  registry: NonNullable<ReturnType<typeof getOffroadStateRegistry>>,
  input: RunStateDryRunInput
): string[] {
  let ids =
    input.sourceIds ??
    registry.sources
      .filter((s) => isSourceEnabled(registry.stateCode, s.sourceId, registry.defaultEnabledSources.includes(s.sourceId)))
      .map((s) => s.sourceId);

  if (input.sourceFilter === "federal") {
    ids = ids.filter((id) => FEDERAL_SOURCE_IDS.includes(id as (typeof FEDERAL_SOURCE_IDS)[number]));
  } else if (input.sourceFilter === "state") {
    ids = ids.filter((id) => !FEDERAL_SOURCE_IDS.includes(id as (typeof FEDERAL_SOURCE_IDS)[number]));
  } else if (input.sourceFilter === "osm") {
    ids = ids.filter((id) => id === "osm_offroad");
  } else {
    const areaContextIds = registry.sources
      .filter((s) => s.areaContextOnly && s.status === "active")
      .map((s) => s.sourceId);
    ids = [...new Set([...ids, ...areaContextIds])];
  }

  return ids.filter((id) => {
    const entry = registry.sources.find((s) => s.sourceId === id);
    if (!entry) return false;
    if (entry.status === "disabled" || entry.status === "needs_source") return false;
    if (entry.status === "needs_validation") return false;
    return canSourcePublishPublic(entry) || entry.areaContextOnly;
  });
}

function routeCandidateSourceId(route: LocavaInventoryRoute, fallback: string): string {
  if (route.source === "vtrans_public_highway_system") return "vt_vtrans_public_highway_system";
  if (route.source === "openstreetmap") return "osm_offroad";
  if (route.source === "usfs_mvum") return "usfs_mvum";
  if (route.source === "blm_gtlf") return "blm_gtlf";
  return fallback;
}

function mergeStateOffroadRouteCandidates(input: {
  stateCode: string;
  stateBbox: InventoryBbox;
  routeCandidates: Array<{ route: LocavaInventoryRoute; sourceId: string }>;
}): LocavaInventoryRoute[] {
  if (input.stateCode !== "VT") {
    return mergeOffroadRoutesFromSources({ routes: input.routeCandidates }).routes;
  }

  const osmRoutes = input.routeCandidates.filter((c) => c.sourceId === "osm_offroad").map((c) => c.route);
  let vtransRoutes = input.routeCandidates
    .filter((c) => c.sourceId === "vt_vtrans_public_highway_system")
    .map((c) => c.route);
  vtransRoutes = mergeVtransInventoryRoutes(vtransRoutes);
  const otherCandidates = input.routeCandidates.filter(
    (c) => c.sourceId !== "osm_offroad" && c.sourceId !== "vt_vtrans_public_highway_system"
  );

  const osmVtrans = mergeOsmAndVtransOffroadRoutes({
    osmRoutes,
    vtransRoutes,
    bbox: input.stateBbox,
  });

  const combined = mergeOffroadRoutesFromSources({
    routes: [
      ...osmVtrans.routes.map((route) => ({
        route,
        sourceId: routeCandidateSourceId(route, "osm_offroad"),
      })),
      ...otherCandidates,
    ],
  });

  const { routes: explicitOnly } = filterRoutesToExplicitOffroadClasses(combined.routes);
  return explicitOnly;
}

async function fetchSourceForState(input: {
  adapter: NationalOffroadSourceAdapter;
  sourceEntry: OffroadSourceRegistryEntry;
  stateCode: string;
  stateBbox: InventoryBbox;
  importRunId: string;
  chunkConfig: typeof DEFAULT_OFFROAD_CHUNK_CONFIG;
  maxRecordsPerSource?: number;
  includeNotAssessedBlm?: boolean;
  onChunkProgress?: (chunkIndex: number, chunkTotal: number, chunkId: string) => void;
}): Promise<{ features: OffroadRawFeature[]; chunkErrors: string[] }> {
  if (!input.sourceEntry.supportsBbox && !input.sourceEntry.supportsStatewide) {
    return { features: [], chunkErrors: [] };
  }

  const isStateOfficial =
    input.sourceEntry.tier === 2 &&
    (input.sourceEntry.sourceType === "state_arcgis" || input.sourceEntry.sourceId === "nh_class_vi_roads");
  const maxPagesPerChunk = isStateOfficial ? 50 : input.chunkConfig.maxPagesPerChunk;

  const isOsm = input.sourceEntry.sourceId === "osm_offroad";
  const effectiveConfig = isOsm
    ? {
        ...input.chunkConfig,
        chunkSizeDegreesLat: Math.min(input.chunkConfig.chunkSizeDegreesLat, 0.25),
        chunkSizeDegreesLng: Math.min(input.chunkConfig.chunkSizeDegreesLng, 0.25),
        maxConcurrentChunks: Math.min(input.chunkConfig.maxConcurrentChunks, 2),
      }
    : input.chunkConfig;

  const chunks = chunkStateBbox(input.stateBbox, effectiveConfig);
  const chunkErrors: string[] = [];
  let chunkCompleted = 0;
  const features = await fetchChunksWithConcurrency({
    chunks,
    maxConcurrent: effectiveConfig.maxConcurrentChunks,
    onChunkError: (chunk, error) => {
      const msg = error instanceof Error ? error.message : String(error);
      chunkErrors.push(`${chunk.chunkId}:${msg}`);
      chunkCompleted += 1;
      input.onChunkProgress?.(chunkCompleted, chunks.length, chunk.chunkId);
    },
    fetchChunk: async (chunk) => {
      const result = await input.adapter.fetchForState({
        stateCode: input.stateCode,
        bbox: chunk.bbox,
        dryRun: true,
        importRunId: input.importRunId,
        pageSize: effectiveConfig.pageSize,
        maxPagesPerChunk,
        maxRecordsPerSource: input.maxRecordsPerSource,
        includeNotAssessedBlm: input.includeNotAssessedBlm,
      });
      chunkCompleted += 1;
      input.onChunkProgress?.(chunkCompleted, chunks.length, chunk.chunkId);
      return result;
    },
  });

  return { features: dedupeRawFeatures(features), chunkErrors };
}

async function fetchSourceForBbox(input: {
  adapter: NationalOffroadSourceAdapter;
  sourceEntry: OffroadSourceRegistryEntry;
  stateCode: string;
  bbox: InventoryBbox;
  importRunId: string;
  maxRecordsPerSource?: number;
  includeNotAssessedBlm?: boolean;
}): Promise<OffroadRawFeature[]> {
  if (!input.sourceEntry.supportsBbox && !input.sourceEntry.supportsStatewide) {
    return [];
  }

  const isStateOfficial =
    input.sourceEntry.tier === 2 &&
    (input.sourceEntry.sourceType === "state_arcgis" || input.sourceEntry.sourceId === "nh_class_vi_roads");
  const maxPagesPerChunk = isStateOfficial ? 50 : DEFAULT_OFFROAD_CHUNK_CONFIG.maxPagesPerChunk;

  return input.adapter.fetchForState({
    stateCode: input.stateCode,
    bbox: input.bbox,
    dryRun: true,
    importRunId: input.importRunId,
    pageSize: DEFAULT_OFFROAD_CHUNK_CONFIG.pageSize,
    maxPagesPerChunk,
    maxRecordsPerSource: input.maxRecordsPerSource,
    includeNotAssessedBlm: input.includeNotAssessedBlm,
  });
}

export async function fetchOffroadRoutesForBbox(input: {
  stateCode: string;
  bbox: InventoryBbox;
  importRunId: string;
  sourceFilter?: "all" | "federal" | "state" | "osm";
  maxRecordsPerSource?: number;
  includeNotAssessedBlm?: boolean;
}): Promise<{ routes: LocavaInventoryRoute[]; rejectedCount: number; rawCount: number }> {
  const registry = getOffroadStateRegistry(input.stateCode);
  if (!registry) throw new Error(`unknown_state:${input.stateCode}`);

  const sourceIds = resolveSourceIds(registry, {
    stateCode: input.stateCode,
    sourceFilter: input.sourceFilter,
  });

  const routeCandidates: Array<{ route: LocavaInventoryRoute; sourceId: string }> = [];
  let rejectedCount = 0;
  let rawCount = 0;

  for (const sourceId of sourceIds) {
    const sourceEntry = registry.sources.find((s) => s.sourceId === sourceId);
    const adapter = ADAPTERS[sourceId];
    if (!sourceEntry || !adapter) continue;

    try {
      const useChunkedFetch = sourceId === "osm_offroad" || sourceEntry.supportsStatewide;
      const { features: rawFeatures } = useChunkedFetch
        ? await fetchSourceForState({
            adapter,
            sourceEntry,
            stateCode: registry.stateCode,
            stateBbox: input.bbox,
            importRunId: input.importRunId,
            chunkConfig: DEFAULT_OFFROAD_CHUNK_CONFIG,
            maxRecordsPerSource: input.maxRecordsPerSource,
            includeNotAssessedBlm: input.includeNotAssessedBlm,
          })
        : {
            features: await fetchSourceForBbox({
              adapter,
              sourceEntry,
              stateCode: registry.stateCode,
              bbox: input.bbox,
              importRunId: input.importRunId,
              maxRecordsPerSource: input.maxRecordsPerSource,
              includeNotAssessedBlm: input.includeNotAssessedBlm,
            }),
          };
      rawCount += rawFeatures.length;

      for (const raw of rawFeatures) {
        const normalized = adapter.normalizeFeature(raw, {
          importRunId: input.importRunId,
          stateCode: registry.stateCode,
        });
        if (!normalized) continue;
        if ((normalized as RejectedOffroadCandidate).kind === "rejected") {
          rejectedCount += 1;
          continue;
        }
        if ("designation" in normalized && "bbox" in normalized) {
          continue;
        }
        routeCandidates.push({ route: normalized as LocavaInventoryRoute, sourceId });
      }
    } catch {
      // Per-source fetch failures should not block other sources (e.g. VTrans when Overpass is down).
    }
  }

  const merged = mergeStateOffroadRouteCandidates({
    stateCode: registry.stateCode,
    stateBbox: input.bbox,
    routeCandidates,
  });
  const inBbox = filterRoutesToStateBbox(merged, input.bbox);
  const routes = applyOffroadMapReadinessToRoutes(inBbox);

  return { routes, rejectedCount, rawCount };
}

export async function runStateOffroadDryRun(input: RunStateDryRunInput): Promise<OffroadNationalDryRun> {
  assertDryRunSafe();

  const registry = getOffroadStateRegistry(input.stateCode);
  if (!registry) throw new Error(`unknown_state:${input.stateCode}`);

  if (!isStateEnabled(registry.stateCode, registry.enabled)) {
    throw new Error(`state_disabled:${registry.stateCode}`);
  }

  const stateBounds = getStateBounds(registry.stateCode);
  if (!stateBounds) throw new Error(`missing_state_bounds:${registry.stateCode}`);

  const runId = randomUUID();
  const importRunId = runId;
  const stateBbox = input.customBbox ?? stateBounds.bbox;
  const chunkConfig = { ...DEFAULT_OFFROAD_CHUNK_CONFIG, ...input.chunkConfig };
  let sourceIds = resolveSourceIds(registry, input);
  if (input.excludeSourceIds?.length) {
    sourceIds = sourceIds.filter((id) => !input.excludeSourceIds!.includes(id));
  }
  const chunks = chunkStateBbox(stateBbox, chunkConfig);

  const run: OffroadNationalDryRun = {
    runId,
    stateCode: registry.stateCode,
    sourceIds,
    sourceFilter: input.sourceFilter ?? "all",
    status: "running",
    dryRun: true,
    productionWritesBlocked: true,
    startedAt: new Date().toISOString(),
    bbox: stateBbox,
    chunkCount: chunks.length,
    sourceCounts: [],
    routes: [],
    areaContexts: [],
    rejectedCount: 0,
  };
  putOffroadNationalRun(run);

  try {
    const routeCandidates: Array<{ route: LocavaInventoryRoute; sourceId: string }> = [];
    const areaContexts: OffroadAreaContext[] = [];
    let rejectedCount = 0;

    for (let sourceIndex = 0; sourceIndex < sourceIds.length; sourceIndex += 1) {
      const sourceId = sourceIds[sourceIndex]!;
      const sourceEntry = registry.sources.find((s) => s.sourceId === sourceId);
      const adapter = ADAPTERS[sourceId];
      const counts: OffroadSourceRunCounts = {
        sourceId,
        rawFeatures: 0,
        routesAccepted: 0,
        areasAccepted: 0,
        rejected: 0,
        hidden: 0,
        review: 0,
        errors: [],
      };

      input.onProgress?.({
        phase: "source_start",
        sourceId,
        sourceIndex: sourceIndex + 1,
        sourceTotal: sourceIds.length,
        routesAcceptedSoFar: routeCandidates.length,
        message: `Fetching ${sourceId}…`,
      });

      if (!sourceEntry || !adapter) {
        counts.errors.push("no_adapter_or_registry_entry");
        run.sourceCounts.push(counts);
        continue;
      }

      try {
        const { features: rawFeatures, chunkErrors } = await fetchSourceForState({
          adapter,
          sourceEntry,
          stateCode: registry.stateCode,
          stateBbox,
          importRunId,
          chunkConfig,
          maxRecordsPerSource: input.maxRecordsPerSource,
          includeNotAssessedBlm: input.includeNotAssessedBlm,
          onChunkProgress: (chunkIndex, chunkTotal, chunkId) => {
            input.onProgress?.({
              phase: "chunk_complete",
              sourceId,
              sourceIndex: sourceIndex + 1,
              sourceTotal: sourceIds.length,
              chunkIndex,
              chunkTotal,
              routesAcceptedSoFar: routeCandidates.length,
              message: `${sourceId}: chunk ${chunkIndex}/${chunkTotal} (${chunkId})`,
            });
          },
        });
        counts.rawFeatures = rawFeatures.length;
        counts.errors.push(...chunkErrors);

        for (const raw of rawFeatures) {
          const normalized = adapter.normalizeFeature(raw, {
            importRunId,
            stateCode: registry.stateCode,
          });

          if (!normalized) continue;
          if ((normalized as RejectedOffroadCandidate).kind === "rejected") {
            counts.rejected += 1;
            rejectedCount += 1;
            continue;
          }
          if ("designation" in normalized && "bbox" in normalized) {
            areaContexts.push(normalized as OffroadAreaContext);
            counts.areasAccepted += 1;
            continue;
          }

          const route = normalized as LocavaInventoryRoute;
          if (route.displayPriority === "hidden") counts.hidden += 1;
          routeCandidates.push({ route, sourceId });
          counts.routesAccepted += 1;
        }
      } catch (error) {
        counts.errors.push(error instanceof Error ? error.message : String(error));
      }

      input.onProgress?.({
        phase: "source_complete",
        sourceId,
        sourceIndex: sourceIndex + 1,
        sourceTotal: sourceIds.length,
        routesAcceptedSoFar: routeCandidates.length,
        message: `${sourceId}: ${counts.routesAccepted} routes accepted`,
      });

      run.sourceCounts.push(counts);
    }

    input.onProgress?.({
      phase: "merging",
      routesAcceptedSoFar: routeCandidates.length,
      message: "Merging VTrans + USFS routes…",
    });

    const mergedRoutes = mergeStateOffroadRouteCandidates({
      stateCode: registry.stateCode,
      stateBbox,
      routeCandidates,
    });
    const inState = filterRoutesToStateBbox(mergedRoutes, stateBbox);
    run.routes = applyOffroadMapReadinessToRoutes(inState);
    run.routesBounds = unionBoundsForRoutes(inState) ?? undefined;
    run.routesFilteredOutOfState = mergedRoutes.length - inState.length;
    run.areaContexts = areaContexts;
    run.rejectedCount = rejectedCount;
    run.coverageSummary = buildCoverageSummary(registry, run);
    run.stateCoverageDiagnostics = buildStateCoverageDiagnostics();
    run.status = "completed";
    run.completedAt = new Date().toISOString();
    input.onProgress?.({
      phase: "complete",
      routesAcceptedSoFar: run.routes.length,
      message: `Scan complete — ${run.routes.length} routes`,
    });
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : String(error);
    run.completedAt = new Date().toISOString();
  }

  putOffroadNationalRun(run);
  return run;
}

export async function runBatchOffroadDryRun(input: BatchDryRunInput): Promise<{
  batchRunId: string;
  runs: OffroadNationalDryRun[];
  productionWritesBlocked: true;
}> {
  assertDryRunSafe();

  const allStateCodes = listOffroadStateRegistries()
    .filter((s) => s.stateCode !== "DC")
    .map((s) => s.stateCode);

  if (input.stateCodes.length >= allStateCodes.length && !input.confirmAllStates) {
    throw new Error("batch_dry_run_all_states_requires_confirmAllStates");
  }

  const maxConcurrent = input.maxConcurrentStates ?? 3;
  const batchRunId = randomUUID();
  const runs: OffroadNationalDryRun[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < input.stateCodes.length) {
      const i = index;
      index += 1;
      const stateCode = input.stateCodes[i]!;
      const run = await runStateOffroadDryRun({
        stateCode,
        sourceFilter: input.sourceFilter,
      });
      runs.push(run);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrent, input.stateCodes.length) }, () => worker())
  );

  return { batchRunId, runs, productionWritesBlocked: true };
}

function countRoutesBySourcePrefix(routes: LocavaInventoryRoute[], prefixes: string[]): number {
  return routes.filter((r) => prefixes.some((p) => r.source === p || r.source.startsWith(p))).length;
}

function buildCoverageSummary(
  registry: NonNullable<ReturnType<typeof getOffroadStateRegistry>>,
  run: OffroadNationalDryRun
): OffroadNationalDryRun["coverageSummary"] {
  const stateOfficialIds = registry.sources
    .filter((s) => s.tier === 2 && s.status === "active" && !s.areaContextOnly)
    .map((s) => s.sourceId);

  const ranIds = new Set(run.sourceIds);
  const missingStateOfficial = stateOfficialIds.filter((id) => !ranIds.has(id));

  const stateOfficialRoutes = countRoutesBySourcePrefix(run.routes, [
    "vtrans_public_highway_system",
    "nhdot_legislative_class",
  ]);
  const federalRoutes = countRoutesBySourcePrefix(run.routes, ["usfs_mvum", "blm_gtlf"]);
  const osmRoutes = countRoutesBySourcePrefix(run.routes, ["openstreetmap"]);

  const sourceErrors = run.sourceCounts.flatMap((s) =>
    s.errors.length ? s.errors.map((e) => `${s.sourceId}: ${e}`) : []
  );

  const notes: string[] = [];
  if (missingStateOfficial.length) {
    notes.push(`Missing official state source(s): ${missingStateOfficial.join(", ")}`);
  }
  if (sourceErrors.length) {
    notes.push(`Source errors: ${sourceErrors.length} (OSM/BLM may be incomplete)`);
  }
  if (registry.stateCode === "NH" && stateOfficialRoutes === 0) {
    notes.push("NH Class VI (NHDOT) returned 0 — re-fetch after server restart if source was just activated.");
  }
  if (registry.stateCode === "NH" && stateOfficialRoutes > 0) {
    notes.push(`NH Class VI official roads: ${stateOfficialRoutes} (primary NH coverage)`);
  }
  if (federalRoutes > 0 && stateOfficialRoutes === 0 && stateOfficialIds.length === 0) {
    notes.push("No official state road-class source configured — federal + OSM only.");
  }

  return {
    stateOfficialSourceIds: stateOfficialIds,
    stateOfficialRoutes,
    federalRoutes,
    osmRoutes,
    missingStateOfficial,
    sourceErrors,
    completenessNote: notes.length ? notes.join(" · ") : "All configured active sources ran.",
  };
}

export function getOffroadMasterPanelSnapshot(): {
  states: Array<{
    stateCode: string;
    stateName: string;
    enabled: boolean;
    sources: OffroadSourceRegistryEntry[];
    lastDryRun?: OffroadNationalDryRun | null;
    federalSummary: { usfs: string; blm: string; osm: string };
    stateSourceSummary: {
      configured: number;
      active: number;
      needsValidation: number;
      needsSource: number;
    };
    counts?: {
      routes: number;
      hidden: number;
      areas: number;
    };
  }>;
  stateCoverageDiagnostics: ReturnType<typeof buildStateCoverageDiagnostics>;
  stateCatalog: ReturnType<typeof buildOffroadStateCatalog>;
  productionWritesBlocked: true;
} {
  const diagnostics = buildStateCoverageDiagnostics();
  const catalog = buildOffroadStateCatalog();
  const catalogByState = new Map(catalog.map((c) => [c.stateCode, c]));

  const states = listOffroadStateRegistries().map((registry) => {
    const latest = getBestRunForState(registry.stateCode);

    const tier2 = registry.sources.filter((s) => s.tier === 2);
    const federal = registry.sources.filter((s) => s.tier === 1);

    return {
      stateCode: registry.stateCode,
      stateName: registry.stateName,
      enabled: isStateEnabled(registry.stateCode, registry.enabled),
      sources: registry.sources,
      lastDryRun: latest,
      federalSummary: {
        usfs: federal.find((s) => s.sourceId === "usfs_mvum")?.status ?? "unknown",
        blm: federal.find((s) => s.sourceId === "blm_gtlf")?.status ?? "unknown",
        osm: federal.find((s) => s.sourceId === "osm_offroad")?.status ?? "unknown",
      },
      stateSourceSummary: {
        configured: tier2.length,
        active: tier2.filter((s) => s.status === "active").length,
        needsValidation: tier2.filter((s) => s.status === "needs_validation").length,
        needsSource: tier2.filter((s) => s.status === "needs_source").length,
      },
      counts: latest
        ? {
            routes: latest.routes.length,
            hidden: latest.routes.filter((r) => r.displayPriority === "hidden").length,
            areas: latest.areaContexts.length,
          }
        : undefined,
      setup: catalogByState.get(registry.stateCode) ?? null,
    };
  });

  return {
    states,
    stateCoverageDiagnostics: diagnostics,
    stateCatalog: catalog,
    productionWritesBlocked: true,
  };
}
