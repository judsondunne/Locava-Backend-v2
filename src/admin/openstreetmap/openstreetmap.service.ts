import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { InventoryBbox } from "../../contracts/entities/inventory-entities.contract.js";
import { resolveAdminViewport, type AdminViewportInput } from "../../lib/inventory/inventoryBbox.js";
import { assertLikelyNotSwapped } from "../../lib/inventory/inventoryCoordinates.js";
import { classifyOsmFeaturesForLocava } from "../../lib/inventory/inventoryLocavaClassifier.js";
import { buildLocavaInventorySpot, dedupeLocavaInventory } from "../../lib/inventory/inventoryLocavaDedupe.js";
import { buildLocavaDiagnosticsJson, diagnosticsJsonString } from "../../lib/inventory/inventoryLocavaDiagnostics.js";
import type { LocavaDiagnosticsJson } from "../../lib/inventory/inventoryLocavaDiagnostics.js";
import { assembleInventoryTrails } from "../../lib/inventory/trails/inventoryTrailAssembler.js";
import { assembleOffroadRoutes } from "../../lib/inventory/offroad/inventoryOffroadAssembler.js";
import { buildOffroadDiagnostics, buildVtransOffroadDiagnostics, buildNhOffroadDiagnostics } from "../../lib/inventory/offroad/inventoryOffroadDiagnostics.js";
import { filterRoutesToExplicitOffroadClasses } from "../../lib/inventory/offroad/offroadExplicitClassFilter.js";
import { mergeOsmAndVtransOffroadRoutes, routeIntersectsBbox } from "../../lib/inventory/offroad/inventoryOffroadMerge.js";
import { importVtransRoutesForBbox } from "../../lib/inventory/offroad/sources/vtransPublicHighwaySystemSource.js";
import { importNhdotClass6RoutesForBbox } from "../../lib/inventory/offroad/sources/nhNhdotLegislativeClassSource.js";
import { applyPlaceHierarchy } from "../../lib/inventory/inventoryPlaceHierarchy.js";
import { attachSpotParking, mergeParkingDiagnostics } from "../../lib/inventory/inventoryParking.js";
import { polishAcceptedSpots } from "../../lib/inventory/inventorySpotPolish.js";
import { buildFinalPolishDiagnostics } from "../../lib/inventory/inventoryFinalPolishDiagnostics.js";
import {
  DEFAULT_LOCAVA_CLASSIFIER_CONFIG,
  type LocavaClassifierConfig,
  type LocavaInventoryRoute,
  type LocavaInventorySpot,
  type LocavaRejectedItem,
} from "../../lib/inventory/inventoryLocavaTypes.js";
import {
  buildHartlandOverpassQuery,
  dedupeOsmFeatures,
  parseGeoJsonFeature,
  parseOverpassRaw,
  type OsmFeatureListItem,
  type OverpassElement,
} from "../../lib/openstreetmap/osmFeatureParse.js";
import { putOpenStreetMapClassificationRun } from "./openstreetmapRunStore.js";
import { refreshExistingMediaBundle, getOrRefreshExistingMediaBundle } from "../inventory/inventoryExistingMedia.service.js";
import { enrichInventoryActivityTitle } from "../../lib/inventory/inventoryActivityTitleEnrichment.js";
import { buildActivityTitleDiagnostics } from "../../lib/inventory/inventoryActivityTitleDiagnostics.js";
import { importVtClass4RoadsGeojson } from "../../lib/inventory/offroad/sources/vtClass4RoadsSource.js";
import { importNhClass6RoadsGeojson } from "../../lib/inventory/offroad/sources/nhClass6RoadsSource.js";

import { fetchOverpassJson } from "../../lib/openstreetmap/overpassFetch.js";
const OVERPASS_USER_AGENT =
  process.env.OVERPASS_USER_AGENT ?? "LocavaBackendV2/0.1 (admin openstreetmap explorer; contact: admin@locava.app)";
const HARTLAND_FIXTURE_PATH = path.resolve("src/lib/inventory/sources/hartlandMirrorSample.geojson");

export type OpenStreetMapRegionResult = {
  label: string;
  regionKey: string;
  bbox: InventoryBbox;
  center: { lat: number; lng: number };
  source: "overpass" | "fixture";
  fetchedAt: string;
  featureCount: number;
  typeCounts: Record<string, number>;
  features: OsmFeatureListItem[];
};

export type OpenStreetMapClassifyInput = {
  source?: "overpass" | "fixture";
  config?: Partial<LocavaClassifierConfig>;
  viewport?: AdminViewportInput;
  vtClass4GeojsonPath?: string;
  nhClass6GeojsonPath?: string;
  offroadSource?: "osm" | "vtrans" | "osm_vtrans";
  includeClass4?: boolean;
  includeLegalTrails?: boolean;
  includeClass6?: boolean;
  useLiveVtrans?: boolean;
  useLiveNhdot?: boolean;
};

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadVtOffroadRoutes(input: {
  regionBbox: InventoryBbox;
  runId: string;
  label: string;
  vtClass4GeojsonPath?: string;
  includeClass4?: boolean;
  includeLegalTrails?: boolean;
  useLiveVtrans?: boolean;
}): Promise<{
  routes: LocavaInventoryRoute[];
  rawFeatures: Awaited<ReturnType<typeof importVtransRoutesForBbox>>["rawFeatures"];
  missingGeometry: number;
}> {
  const routes: LocavaInventoryRoute[] = [];
  let rawFeatures: Awaited<ReturnType<typeof importVtransRoutesForBbox>>["rawFeatures"] = [];
  let missingGeometry = 0;

  const liveEnabled = input.useLiveVtrans !== false && process.env.VTRANS_OFFROAD_LIVE !== "false";
  if (liveEnabled) {
    try {
      const imported = await importVtransRoutesForBbox({
        bbox: input.regionBbox,
        includeClass4: input.includeClass4 ?? true,
        includeLegalTrails: input.includeLegalTrails ?? true,
        importRunId: input.runId,
        localityLabel: input.label,
        includeRestrictedAsHidden: true,
      });
      routes.push(...imported.routes);
      rawFeatures = imported.rawFeatures;
      missingGeometry = imported.missingGeometry;
    } catch (error) {
      console.warn("vtrans_live_fetch_failed", error instanceof Error ? error.message : String(error));
    }
  }

  if (routes.length === 0) {
    const vtPath = input.vtClass4GeojsonPath?.trim() || process.env.VT_CLASS4_GEOJSON_PATH?.trim();
    if (vtPath && (await fileExists(vtPath))) {
      const imported = await importVtClass4RoadsGeojson({
        filePath: vtPath,
        sourceLabel: "vt_town_highways",
        sourceDatasetName: "vt_class4_roads",
        state: "VT",
        importRunId: input.runId,
      });
      routes.push(...imported.routes);
    }
  }

  return {
    routes: routes.filter((r) => routeIntersectsBbox(r, input.regionBbox)),
    rawFeatures,
    missingGeometry,
  };
}

async function loadNhOffroadRoutes(input: {
  regionBbox: InventoryBbox;
  runId: string;
  label: string;
  nhClass6GeojsonPath?: string;
  includeClass6?: boolean;
  useLiveNhdot?: boolean;
}): Promise<{
  routes: LocavaInventoryRoute[];
  rawFeatures: Awaited<ReturnType<typeof importNhdotClass6RoutesForBbox>>["rawFeatures"];
  missingGeometry: number;
}> {
  const routes: LocavaInventoryRoute[] = [];
  let rawFeatures: Awaited<ReturnType<typeof importNhdotClass6RoutesForBbox>>["rawFeatures"] = [];
  let missingGeometry = 0;

  if (input.includeClass6 === false) {
    return { routes, rawFeatures, missingGeometry };
  }

  const liveEnabled = input.useLiveNhdot !== false && process.env.NHDOT_OFFROAD_LIVE !== "false";
  if (liveEnabled) {
    try {
      const imported = await importNhdotClass6RoutesForBbox({
        bbox: input.regionBbox,
        includeClass6: true,
        importRunId: input.runId,
        localityLabel: input.label,
      });
      routes.push(...imported.routes);
      rawFeatures = imported.rawFeatures;
      missingGeometry = imported.missingGeometry;
    } catch (error) {
      console.warn("nhdot_live_fetch_failed", error instanceof Error ? error.message : String(error));
    }
  }

  if (routes.length === 0) {
    const nhPath = input.nhClass6GeojsonPath?.trim() || process.env.NH_CLASS6_GEOJSON_PATH?.trim();
    if (nhPath && (await fileExists(nhPath))) {
      const imported = await importNhClass6RoadsGeojson({
        filePath: nhPath,
        sourceLabel: "nh_class6_roads",
        sourceDatasetName: "nh_class6_roads",
        state: "NH",
        importRunId: input.runId,
      });
      routes.push(...imported.routes);
    }
  }

  return {
    routes: routes.filter((r) => routeIntersectsBbox(r, input.regionBbox)),
    rawFeatures,
    missingGeometry,
  };
}

export type OpenStreetMapClassificationResult = {
  label: string;
  regionKey: string;
  bbox: InventoryBbox;
  center: { lat: number; lng: number };
  source: "overpass" | "fixture";
  fetchedAt: string;
  runId: string;
  config: LocavaClassifierConfig;
  rawObjects: number;
  acceptedSpots: LocavaInventorySpot[];
  acceptedRoutes: LocavaInventoryRoute[];
  rejected: LocavaRejectedItem[];
  duplicatesSuppressed: number;
  productionWritesBlocked: true;
  diagnostics: LocavaDiagnosticsJson;
  diagnosticsJson: string;
  rawFeatures: OsmFeatureListItem[];
};

export type ChunkClassificationResult = {
  bbox: InventoryBbox;
  stateCode: string;
  runId: string;
  source: "overpass" | "fixture";
  config: LocavaClassifierConfig;
  rawObjectCount: number;
  acceptedSpots: LocavaInventorySpot[];
  acceptedRoutes: LocavaInventoryRoute[];
  rejected: LocavaRejectedItem[];
  duplicatesSuppressed: number;
  diagnostics: LocavaDiagnosticsJson;
  rawFeatures: OsmFeatureListItem[];
};

export type ClassifyOpenStreetMapForBboxInput = {
  bbox: InventoryBbox;
  stateCode: string;
  runId: string;
  label?: string;
  regionKey?: string;
  source?: "overpass" | "fixture";
  config?: Partial<LocavaClassifierConfig>;
  includeOsmSpots?: boolean;
  includeOsmRoutes?: boolean;
  includeOsmOffroad?: boolean;
  offroadSource?: "osm" | "vtrans" | "osm_vtrans";
  vtClass4GeojsonPath?: string;
  nhClass6GeojsonPath?: string;
  includeClass4?: boolean;
  includeLegalTrails?: boolean;
  includeClass6?: boolean;
  useLiveVtrans?: boolean;
  useLiveNhdot?: boolean;
};

async function fetchOverpassRaw(bbox: InventoryBbox): Promise<{
  features: OsmFeatureListItem[];
  elementsById: Map<string, OverpassElement>;
}> {
  const query = buildHartlandOverpassQuery(bbox);
  const json = (await fetchOverpassJson({ query, userAgent: OVERPASS_USER_AGENT })) as {
    elements?: OverpassElement[];
  };
  return parseOverpassRaw(json);
}

async function loadFixtureRaw(): Promise<{
  features: OsmFeatureListItem[];
  elementsById: Map<string, OverpassElement>;
}> {
  const raw = await fs.readFile(HARTLAND_FIXTURE_PATH, "utf8");
  const parsed = JSON.parse(raw) as { features?: unknown[] };
  const features = Array.isArray(parsed.features) ? parsed.features : [];
  const items = features
    .map((feature) => parseGeoJsonFeature(feature as Parameters<typeof parseGeoJsonFeature>[0]))
    .filter((item): item is OsmFeatureListItem => item != null);
  return { features: dedupeOsmFeatures(items), elementsById: new Map() };
}

function summarizeTypeCounts(features: OsmFeatureListItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const feature of features) {
    counts[feature.featureType] = (counts[feature.featureType] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export async function loadHartlandOpenStreetMapFeatures(input?: {
  source?: "overpass" | "fixture";
  viewport?: AdminViewportInput;
}): Promise<OpenStreetMapRegionResult> {
  const region = resolveAdminViewport(input?.viewport);
  const source = input?.source ?? "overpass";
  let features: OsmFeatureListItem[];
  if (source === "fixture") {
    features = (await loadFixtureRaw()).features;
  } else {
    try {
      features = (await fetchOverpassRaw(region.bbox)).features;
    } catch (error) {
      throw new Error(`openstreetmap_fetch_failed:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    label: region.label,
    regionKey: region.regionKey,
    bbox: region.bbox,
    center: region.center,
    source,
    fetchedAt: new Date().toISOString(),
    featureCount: features.length,
    typeCounts: summarizeTypeCounts(features),
    features,
  };
}

export async function classifyOpenStreetMapForBbox(
  input: ClassifyOpenStreetMapForBboxInput
): Promise<ChunkClassificationResult> {
  const source = input.source ?? "overpass";
  let rawParsed: Awaited<ReturnType<typeof fetchOverpassRaw>> | null = null;
  if (source === "fixture") {
    rawParsed = await loadFixtureRaw();
  } else {
    try {
      rawParsed = await fetchOverpassRaw(input.bbox);
    } catch (error) {
      throw new Error(`openstreetmap_fetch_failed:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!rawParsed) {
    throw new Error("openstreetmap_fetch_failed:empty_overpass_response");
  }

  return classifyOpenStreetMapFeaturesForInventory({
    ...input,
    source,
    rawFeatures: rawParsed.features,
    elementsById: rawParsed.elementsById,
  });
}

/**
 * Pure feature-based variant of the OSM classification pipeline.
 *
 * Identical to the body of `classifyOpenStreetMapForBbox` after the raw
 * fetch — accepts pre-parsed `OsmFeatureListItem[]` (plus the optional
 * `elementsById` map relations need) and runs the full Locava
 * classifier + dedupe + polish + parking + offroad + activity-title
 * pipeline.
 *
 * This is what the PBF importer calls, so we never have to weaken the
 * classifier or change scoring. Behavior is preserved 1:1 with the bbox
 * path.
 */
export type ClassifyOpenStreetMapFeaturesForInventoryInput = ClassifyOpenStreetMapForBboxInput & {
  rawFeatures: OsmFeatureListItem[];
  elementsById?: Map<string, OverpassElement>;
};

export async function classifyOpenStreetMapFeaturesForInventory(
  input: ClassifyOpenStreetMapFeaturesForInventoryInput
): Promise<ChunkClassificationResult> {
  const source = input.source ?? "overpass";
  const config: LocavaClassifierConfig = { ...DEFAULT_LOCAVA_CLASSIFIER_CONFIG, ...input.config };
  const includeOsmSpots = input.includeOsmSpots !== false;
  const includeOsmRoutes = input.includeOsmRoutes !== false;
  const includeOsmOffroad = input.includeOsmOffroad !== false;
  const label = input.label ?? `${input.stateCode} chunk`;
  const regionKey = input.regionKey ?? `${input.stateCode.toLowerCase()}_chunk`;

  const rawFeatures = input.rawFeatures;
  const elementsById = input.elementsById ?? new Map<string, OverpassElement>();

  let coordinateWarnings = 0;
  let likelySwappedCoordinates = 0;

  const classifierInputs = rawFeatures.map((feature) => {
    const swapWarning = assertLikelyNotSwapped({ lat: feature.lat, lng: feature.lng }, feature.id);
    if (swapWarning) {
      coordinateWarnings += 1;
      likelySwappedCoordinates += 1;
    }
    return {
      sourceKey: feature.id,
      sourceType: feature.osmType,
      sourceId: String(feature.osmId),
      name: feature.hasRealName ? feature.name : null,
      tags: feature.tags,
      geometryKind: feature.geometryKind,
      lat: feature.lat,
      lng: feature.lng,
      coordinates: feature.coordinates,
      closed: feature.closed,
      rawTypeLabel: feature.featureType,
      coordValid: !swapWarning,
      coordSwapped: Boolean(swapWarning),
      nearbyHikingTrail: feature.nearbyHikingTrail,
    };
  });

  const classifications = classifyOsmFeaturesForLocava(classifierInputs, config);
  const spots: LocavaInventorySpot[] = [];
  const rejected: LocavaRejectedItem[] = [];

  for (let i = 0; i < classifications.length; i += 1) {
    const classification = classifications[i]!;
    const feature = rawFeatures[i]!;
    if (classification.decision === "spot" && includeOsmSpots) {
      spots.push(
        buildLocavaInventorySpot(classification, {
          lat: feature.lat,
          lng: feature.lng,
          tags: feature.tags,
          sourceType: feature.osmType,
          sourceId: String(feature.osmId),
        })
      );
      continue;
    }
    if (classification.decision !== "spot") {
      rejected.push({
      sourceKey: classification.sourceKey,
      sourceId: classification.sourceId,
      name: classification.name,
      sourceType: classification.sourceType,
      coordinatesSummary: `${feature.lat},${feature.lng}`,
      rawTypeLabel: feature.featureType,
      topTags: Object.fromEntries(Object.entries(feature.tags).slice(0, 8)),
      locavaScore: classification.locavaScore,
      decision: "reject",
      rejectionReason: classification.rejectionReason ?? "below_threshold",
      tagSignals: classification.tagSignals,
      negativeSignals: classification.negativeSignals,
      warnings: classification.warnings,
      lat: feature.lat,
      lng: feature.lng,
      coordinates: feature.geometryKind === "line" ? feature.coordinates : undefined,
    });
    }
  }

  const dedupedSpots = dedupeLocavaInventory({ spots, routes: [] });
  const polished = polishAcceptedSpots({ spots: dedupedSpots.spots, rawFeatures });
  const finalPolishDiagnostics = buildFinalPolishDiagnostics({ spots: polished.spots, rejected });

  const accessFeatures = rawFeatures
    .filter((f) => {
      const t = f.tags;
      const amenity = t.amenity?.toLowerCase();
      const highway = t.highway?.toLowerCase();
      const tourism = t.tourism?.toLowerCase();
      const parking = t.parking?.toLowerCase();
      if (amenity === "parking") return true;
      if (highway === "trailhead") return true;
      if (tourism === "information") return true;
      if (parking === "trailhead" || parking === "surface" || parking === "access") return true;
      if (/trailhead|parking/i.test(f.name ?? "")) return true;
      return false;
    })
    .map((f) => ({
      lat: f.lat,
      lng: f.lng,
      name: f.hasRealName ? f.name : null,
      sourceKey: f.id,
      tags: f.tags,
    }));

  const trailAssembly = includeOsmRoutes
    ? assembleInventoryTrails({
        features: rawFeatures,
        elementsById,
        accessFeatures,
        importRunId: input.runId,
      })
    : { routes: [], diagnostics: {}, suppressedTinySegments: 0 };

  const offroadSource = input.offroadSource ?? "osm_vtrans";
  const usedTrailKeys = new Set(trailAssembly.routes.flatMap((r) => r.sourceKeys));
  const offroadAssembly =
    !includeOsmOffroad || offroadSource === "vtrans"
      ? { routes: [], classifications: [], rejected: [] }
      : assembleOffroadRoutes({
          features: rawFeatures,
          usedSourceKeys: usedTrailKeys,
          accessFeatures,
          importRunId: input.runId,
        });

  const vtransLoaded =
    includeOsmOffroad && offroadSource !== "osm"
      ? await loadVtOffroadRoutes({
          regionBbox: input.bbox,
          runId: input.runId,
          label,
          vtClass4GeojsonPath: input.vtClass4GeojsonPath,
          includeClass4: input.includeClass4,
          includeLegalTrails: input.includeLegalTrails,
          useLiveVtrans: input.useLiveVtrans,
        })
      : { routes: [], rawFeatures: [], missingGeometry: 0 };

  const nhLoaded =
    includeOsmOffroad && offroadSource !== "osm" && offroadSource !== "vtrans" && (input.includeClass6 ?? true)
      ? await loadNhOffroadRoutes({
          regionBbox: input.bbox,
          runId: input.runId,
          label,
          nhClass6GeojsonPath: input.nhClass6GeojsonPath,
          includeClass6: input.includeClass6 ?? true,
          useLiveNhdot: input.useLiveNhdot,
        })
      : { routes: [], rawFeatures: [], missingGeometry: 0 };

  const stateOffroadRoutes = [...vtransLoaded.routes, ...nhLoaded.routes];

  const explicitOsmOffroad = filterRoutesToExplicitOffroadClasses(offroadAssembly.routes);
  const mergedOffroadResult =
    offroadSource === "osm"
      ? { routes: explicitOsmOffroad.routes, duplicatesMergedWithOsm: 0, mergedPairs: [] as Array<{ vtransSourceKey: string; osmSourceKey: string }> }
      : offroadSource === "vtrans"
        ? { routes: vtransLoaded.routes, duplicatesMergedWithOsm: 0, mergedPairs: [] as Array<{ vtransSourceKey: string; osmSourceKey: string }> }
        : mergeOsmAndVtransOffroadRoutes({
            osmRoutes: explicitOsmOffroad.routes,
            vtransRoutes: stateOffroadRoutes,
            bbox: input.bbox,
          });

  const mergedOffroad = mergedOffroadResult.routes;
  const vtransDiagnostics = buildVtransOffroadDiagnostics({
    enabled: offroadSource !== "osm",
    rawFeatures: vtransLoaded.rawFeatures,
    routes: mergedOffroad,
    missingGeometry: vtransLoaded.missingGeometry,
    duplicatesMergedWithOsm: mergedOffroadResult.duplicatesMergedWithOsm,
    mergedPairs: mergedOffroadResult.mergedPairs,
  });
  const nhDiagnostics = buildNhOffroadDiagnostics({
    enabled: nhLoaded.routes.length > 0 || (input?.includeClass6 ?? true),
    rawFeatures: nhLoaded.rawFeatures,
    routes: mergedOffroad,
    missingGeometry: nhLoaded.missingGeometry,
  });

  const allRoutes = [...trailAssembly.routes, ...mergedOffroad];
  const offroadDiagnostics = buildOffroadDiagnostics({
    classifications: offroadAssembly.classifications,
    routes: mergedOffroad,
    stateRouteCount: stateOffroadRoutes.length,
    osmOffroadRouteCount: offroadAssembly.routes.length,
    vtransDiagnostics: { ...vtransDiagnostics, nh: nhDiagnostics },
  });

  const parkingAttached = attachSpotParking({ spots: polished.spots, accessFeatures });
  const hierarchy = applyPlaceHierarchy({
    spots: parkingAttached.spots,
    routes: allRoutes,
    rawFeatures,
  });
  const parkingDiagnostics = mergeParkingDiagnostics(parkingAttached.diagnostics, allRoutes);

  const enriched = enrichInventoryActivityTitle({ spots: hierarchy.spots, routes: hierarchy.routes });
  const activityTitleDiagnostics = buildActivityTitleDiagnostics(enriched);

  const diagnostics = buildLocavaDiagnosticsJson({
    runId: input.runId,
    source,
    region: { regionKey, label, bbox: input.bbox },
    config,
    rawObjects: rawFeatures.length,
    spots: enriched.spots,
    routes: enriched.routes,
    rejected,
    classifications,
    duplicatesSuppressed: dedupedSpots.duplicatesSuppressed,
    duplicateDiagnostics: dedupedSpots.duplicateDiagnostics,
    coordinateWarnings,
    likelySwappedCoordinates,
    trailDiagnostics: trailAssembly.diagnostics,
    finalPolishDiagnostics,
    offroadDiagnostics,
    placeHierarchyDiagnostics: hierarchy.diagnostics,
    parkingDiagnostics,
    activityTitleDiagnostics,
  });

  return {
    bbox: input.bbox,
    stateCode: input.stateCode,
    runId: input.runId,
    source,
    config,
    rawObjectCount: rawFeatures.length,
    acceptedSpots: enriched.spots,
    acceptedRoutes: enriched.routes,
    rejected,
    duplicatesSuppressed: dedupedSpots.duplicatesSuppressed + trailAssembly.suppressedTinySegments,
    diagnostics,
    rawFeatures,
  };
}

export async function classifyHartlandOpenStreetMapFeatures(input?: OpenStreetMapClassifyInput): Promise<OpenStreetMapClassificationResult> {
  const region = resolveAdminViewport(input?.viewport);
  const source = input?.source ?? "overpass";
  const runId = randomUUID();

  const chunkResult = await classifyOpenStreetMapForBbox({
    bbox: region.bbox,
    stateCode: "VT",
    runId,
    label: region.label,
    regionKey: region.regionKey,
    source,
    config: input?.config,
    includeOsmSpots: true,
    includeOsmRoutes: true,
    includeOsmOffroad: true,
    offroadSource: input?.offroadSource,
    vtClass4GeojsonPath: input?.vtClass4GeojsonPath,
    nhClass6GeojsonPath: input?.nhClass6GeojsonPath,
    includeClass4: input?.includeClass4,
    includeLegalTrails: input?.includeLegalTrails,
    includeClass6: input?.includeClass6,
    useLiveVtrans: input?.useLiveVtrans,
    useLiveNhdot: input?.useLiveNhdot,
  });

  const result: OpenStreetMapClassificationResult = {
    label: region.label,
    regionKey: region.regionKey,
    bbox: region.bbox,
    center: region.center,
    source,
    fetchedAt: new Date().toISOString(),
    runId,
    config: chunkResult.config,
    rawObjects: chunkResult.rawObjectCount,
    acceptedSpots: chunkResult.acceptedSpots,
    acceptedRoutes: chunkResult.acceptedRoutes,
    rejected: chunkResult.rejected,
    duplicatesSuppressed: chunkResult.duplicatesSuppressed,
    productionWritesBlocked: true,
    diagnostics: chunkResult.diagnostics,
    diagnosticsJson: diagnosticsJsonString(chunkResult.diagnostics),
    rawFeatures: chunkResult.rawFeatures,
  };

  putOpenStreetMapClassificationRun(result);
  refreshExistingMediaBundle(result.runId);
  const mediaBundle = getOrRefreshExistingMediaBundle(result.runId);
  if (mediaBundle) {
    result.diagnostics = { ...result.diagnostics, existingMediaDiagnostics: mediaBundle.diagnostics };
    result.diagnosticsJson = diagnosticsJsonString(result.diagnostics);
  }
  return result;
}
