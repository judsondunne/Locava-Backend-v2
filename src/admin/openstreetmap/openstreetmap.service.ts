import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { InventoryBbox } from "../../contracts/entities/inventory-entities.contract.js";
import { INVENTORY_MVP_DEFAULT_VIEWPORT } from "../../lib/inventory/inventoryBbox.js";
import { assertLikelyNotSwapped } from "../../lib/inventory/inventoryCoordinates.js";
import { classifyOsmFeaturesForLocava } from "../../lib/inventory/inventoryLocavaClassifier.js";
import { buildLocavaInventorySpot, dedupeLocavaInventory } from "../../lib/inventory/inventoryLocavaDedupe.js";
import { buildLocavaDiagnosticsJson, diagnosticsJsonString } from "../../lib/inventory/inventoryLocavaDiagnostics.js";
import type { LocavaDiagnosticsJson } from "../../lib/inventory/inventoryLocavaDiagnostics.js";
import { assembleInventoryTrails } from "../../lib/inventory/trails/inventoryTrailAssembler.js";
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

const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
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

async function fetchOverpassRaw(bbox: InventoryBbox): Promise<{
  features: OsmFeatureListItem[];
  elementsById: Map<string, OverpassElement>;
}> {
  const query = buildHartlandOverpassQuery(bbox);
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": OVERPASS_USER_AGENT,
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`overpass_failed:${res.status}`);
  const json = (await res.json()) as { elements?: OverpassElement[] };
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
}): Promise<OpenStreetMapRegionResult> {
  const region = INVENTORY_MVP_DEFAULT_VIEWPORT;
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

export async function classifyHartlandOpenStreetMapFeatures(input?: {
  source?: "overpass" | "fixture";
  config?: Partial<LocavaClassifierConfig>;
}): Promise<OpenStreetMapClassificationResult> {
  const region = INVENTORY_MVP_DEFAULT_VIEWPORT;
  const source = input?.source ?? "overpass";
  const config: LocavaClassifierConfig = { ...DEFAULT_LOCAVA_CLASSIFIER_CONFIG, ...input?.config };
  const runId = randomUUID();

  const rawParsed =
    source === "fixture" ? await loadFixtureRaw() : await fetchOverpassRaw(region.bbox).catch(() => null);
  if (!rawParsed) {
    throw new Error("openstreetmap_fetch_failed");
  }
  const rawFeatures = rawParsed.features;

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
    };
  });

  const classifications = classifyOsmFeaturesForLocava(classifierInputs, config);
  const spots: LocavaInventorySpot[] = [];
  const rejected: LocavaRejectedItem[] = [];

  for (let i = 0; i < classifications.length; i += 1) {
    const classification = classifications[i]!;
    const feature = rawFeatures[i]!;
    if (classification.decision === "spot") {
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

  const dedupedSpots = dedupeLocavaInventory({ spots, routes: [] });

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

  const trailAssembly = assembleInventoryTrails({
    features: rawFeatures,
    elementsById: rawParsed.elementsById,
    accessFeatures,
    importRunId: runId,
  });

  const diagnostics = buildLocavaDiagnosticsJson({
    runId,
    source,
    region: { regionKey: region.regionKey, label: region.label, bbox: region.bbox },
    config,
    rawObjects: rawFeatures.length,
    spots: dedupedSpots.spots,
    routes: trailAssembly.routes,
    rejected,
    classifications,
    duplicatesSuppressed: dedupedSpots.duplicatesSuppressed,
    duplicateDiagnostics: dedupedSpots.duplicateDiagnostics,
    coordinateWarnings,
    likelySwappedCoordinates,
    trailDiagnostics: trailAssembly.diagnostics,
  });

  const result: OpenStreetMapClassificationResult = {
    label: region.label,
    regionKey: region.regionKey,
    bbox: region.bbox,
    center: region.center,
    source,
    fetchedAt: new Date().toISOString(),
    runId,
    config,
    rawObjects: rawFeatures.length,
    acceptedSpots: dedupedSpots.spots,
    acceptedRoutes: trailAssembly.routes,
    rejected,
    duplicatesSuppressed: dedupedSpots.duplicatesSuppressed + trailAssembly.suppressedTinySegments,
    productionWritesBlocked: true,
    diagnostics,
    diagnosticsJson: diagnosticsJsonString(diagnostics),
    rawFeatures,
  };

  putOpenStreetMapClassificationRun(result);
  return result;
}
