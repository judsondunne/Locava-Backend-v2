/**
 * PBF Copier V2 — read-only viewport coverage scanner.
 *
 * Scans a local .osm.pbf for every OSM candidate in the map viewport, runs the
 * same Locava classifier + unexplored doc builder as the master PBF copier's
 * exhaustive bbox mode, and returns preview docs for the admin map.
 *
 * No max-accepted cap, no activity quotas, no early stop, no Firebase writes.
 */
import type { InventoryBbox } from "../../../../contracts/entities/inventory-entities.contract.js";
import {
  bboxFromCoordinates,
  bboxIntersects,
  isPointInBbox,
} from "../../../../lib/inventory/inventoryBbox.js";
import {
  createHillPeakTrailSpatialIndex,
  evaluateHillPeakSpatialGate,
  hillOrPeakHasOnTagTrailContext,
  isOsmBareHillOrPeakTags,
  isOsmHikingTrailTags,
  isOsmObservationTowerTags,
  isOsmViewpointTags,
  registerHikingTrailOnSpatialIndex,
  registerViewpointOnSpatialIndex,
  type HillPeakTrailSpatialIndex,
} from "../../../../lib/inventory/inventoryHillPeakGate.js";
import {
  evaluateNameInference,
  getSupportingDestinationTags,
} from "../../../../lib/inventory/inventoryNameInference.js";
import { dedupeLocavaInventory } from "../../../../lib/inventory/inventoryLocavaDedupe.js";
import type {
  LocavaInventoryRoute,
  LocavaInventorySpot,
} from "../../../../lib/inventory/inventoryLocavaTypes.js";
import {
  parseOverpassElement,
  type OsmFeatureListItem,
  type OverpassElement,
} from "../../../../lib/openstreetmap/osmFeatureParse.js";
import {
  adaptPbfEntityToOverpassElement,
  isPbfEntitySupportedForCopier,
  type PbfAdapterMetadata,
  type PbfRawEntity,
  type PbfRawNode,
  type PbfRawWay,
} from "../../../../lib/openstreetmap/pbf/pbfElementAdapter.js";
import {
  buildPbfAdapterMetadata,
  defaultPbfFeatureReaderFactory,
  type PbfFeatureReaderFactory,
} from "../../../../lib/openstreetmap/pbf/pbfFeatureReader.js";
import {
  cachePbfNodeCoords,
  enrichPbfWayWithGeometry,
  type PbfNodeCoordCache,
} from "../../../../lib/openstreetmap/pbf/pbfWayGeometryResolver.js";
import {
  createPbfTagFilter,
  resolvePbfTagFilterPolicy,
} from "../../../../lib/openstreetmap/pbf/pbfTagFilter.js";
import { classifyOpenStreetMapFeaturesForInventory } from "../../openstreetmap.service.js";
import { buildUnexploredDocsFromClassification } from "../osmNationalDocBuilder.js";
import {
  validateUnexploredRouteForCopier,
  validateUnexploredSpotForCopier,
} from "../copier/osmNationalCopierRunner.js";
import type { UnexploredRoute, UnexploredSpot } from "../../../../contracts/entities/osm-national-entities.contract.js";
import {
  finalizePreviewDocsQuality,
  normalizePreviewDisplayName,
} from "./pbfCopierPreviewQuality.js";
import { resolveRoutePostAnchor } from "./pbfCopierRouteGeometry.js";
import {
  buildRoutePreviewDoc,
  buildSpotPreviewDoc,
  validatePbfFile,
} from "./pbfCopierRunner.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { DEFAULT_PBF_COPIER_CONFIG } from "./pbfCopierTypes.js";
import { postProcessRawOsmPreviewDocs } from "./pbfCopierV2RawDisplay.js";
import { enrichRoutePreviewDoc } from "./pbfCopierV2RouteEnrichment.js";

const CLASSIFY_BATCH_SIZE = DEFAULT_PBF_COPIER_CONFIG.classifyBatchSize;
const V2_RUN_ID_PREFIX = "pbf-copier-v2-viewport";
/** Keep full trail geometry for display/write; only downsample very long ways. */
const ROUTE_LINE_POINT_CAP = 8000;
const PREVIEW_TAG_SAMPLE_FIELDS = 12;

/** Woodstock VT — Mt Tom, Billings/Faulkner parks, The Pogue (integration / audit bbox). */
export const MT_TOM_WOODSTOCK_VT_BBOX: PbfCopierV2ViewportBbox = {
  westLng: -72.58,
  southLat: 43.6,
  eastLng: -72.48,
  northLat: 43.66,
};

/** Marsh-Billings-Rockefeller NHP — McKnight Trail, Barrette interpretive platform. */
export const MARSH_BILLINGS_ROCKEFELLER_VT_BBOX: PbfCopierV2ViewportBbox = {
  westLng: -72.42,
  southLat: 43.63,
  eastLng: -72.38,
  northLat: 43.65,
};

/** Lake Pinneo / Howland Dam / Westgate Rd area (user-reported empty viewport). */
export const HOWLAND_DAM_VT_BBOX: PbfCopierV2ViewportBbox = {
  westLng: -72.52,
  southLat: 43.44,
  eastLng: -72.47,
  northLat: 43.48,
};

export type PbfCopierV2ViewportBbox = {
  westLng: number;
  southLat: number;
  eastLng: number;
  northLat: number;
};

export type PbfCopierV2ViewportPreviewStats = {
  /** raw_osm = unfiltered PBF dump; locava_filtered = classifier + tag coverage (legacy). */
  previewMode: "raw_osm" | "locava_filtered";
  rawObjectsScanned: number;
  nodesScanned: number;
  waysScanned: number;
  relationsScanned: number;
  tagFilterSkipped: number;
  adapterSkipped: number;
  geometrySkipped: number;
  outsideBboxSkipped: number;
  candidatesSentToClassifier: number;
  classifierAcceptedSpots: number;
  classifierAcceptedRoutes: number;
  rejectedByClassifier: number;
  /** Tag-filter OSM objects added after classifier (parking, trails classifier skipped, etc.). */
  tagCoverageItemsAdded: number;
  classifierItemsReturned: number;
  /** Homes/buildings-only spots removed from raw display. */
  residentialHomesFiltered?: number;
  /** Named hiking trails after segment merge. */
  hikingTrailGroupsMerged?: number;
  /** Hiking way segments folded into merged trails. */
  hikingTrailSegmentsCollapsed?: number;
  itemsReturned: number;
  elapsedMs: number;
};

export type PbfCopierV2ViewportPreviewMode = "raw_osm" | "locava_filtered";

export type PbfCopierV2ViewportPreviewResult = {
  ok: true;
  bbox: PbfCopierV2ViewportBbox;
  items: PbfCopierPreviewDoc[];
  stats: PbfCopierV2ViewportPreviewStats;
};

export type PbfCopierV2ViewportPreviewHooks = {
  readerFactory?: PbfFeatureReaderFactory;
  classify?: typeof classifyOpenStreetMapFeaturesForInventory;
};

let viewportPreviewHooks: PbfCopierV2ViewportPreviewHooks = {};

export function setPbfCopierV2ViewportPreviewHooks(
  hooks: PbfCopierV2ViewportPreviewHooks | null
): void {
  viewportPreviewHooks = hooks ?? {};
}

export function clearPbfCopierV2ViewportPreviewHooks(): void {
  viewportPreviewHooks = {};
}

type CandidateFeature = {
  feature: OsmFeatureListItem;
  osmType: "node" | "way" | "relation";
  osmId: number;
  element?: OverpassElement;
};

function classifyFn(): typeof classifyOpenStreetMapFeaturesForInventory {
  return viewportPreviewHooks.classify ?? classifyOpenStreetMapFeaturesForInventory;
}

/** Pre-load all node coordinates so ways resolve full geometry (avoids truncated lines). */
export async function buildPbfNodeCoordinateCache(
  filePath: string,
  readerFactory: PbfFeatureReaderFactory = defaultPbfFeatureReaderFactory
): Promise<PbfNodeCoordCache> {
  const cache: PbfNodeCoordCache = new Map();
  const reader = await readerFactory({ filePath });
  await reader.open({ filePath });
  try {
    for await (const chunk of reader.read()) {
      for (const entity of chunk.entities) {
        if (entity.type === "node") cachePbfNodeCoords(cache, entity as PbfRawNode);
      }
    }
  } finally {
    await reader.close();
  }
  return cache;
}

function withFullWayGeometry(entity: PbfRawEntity, nodeCache: PbfNodeCoordCache): PbfRawEntity {
  if (entity.type !== "way") return entity;
  return enrichPbfWayWithGeometry(entity as PbfRawWay, nodeCache);
}

export function viewportBboxToInventoryBbox(bbox: PbfCopierV2ViewportBbox): InventoryBbox {
  return {
    minLat: bbox.southLat,
    minLng: bbox.westLng,
    maxLat: bbox.northLat,
    maxLng: bbox.eastLng,
  };
}

export function validateViewportBbox(bbox: PbfCopierV2ViewportBbox): void {
  const { westLng, southLat, eastLng, northLat } = bbox;
  if (![westLng, southLat, eastLng, northLat].every((n) => Number.isFinite(n))) {
    throw new Error("invalid_bbox: all bbox fields must be finite numbers");
  }
  if (westLng >= eastLng) throw new Error("invalid_bbox: westLng must be less than eastLng");
  if (southLat >= northLat) throw new Error("invalid_bbox: southLat must be less than northLat");
  const latSpan = northLat - southLat;
  const lngSpan = eastLng - westLng;
  if (latSpan > 15 || lngSpan > 15) {
    throw new Error("invalid_bbox: viewport too large (max ~15° per axis for V2)");
  }
}

function intersectsBbox(
  coords: Array<{ lat: number; lng: number }>,
  centerFallback: { lat: number; lng: number },
  bbox: InventoryBbox
): boolean {
  if (coords.length === 0) {
    return isPointInBbox(centerFallback.lat, centerFallback.lng, bbox);
  }
  for (const p of coords) {
    if (isPointInBbox(p.lat, p.lng, bbox)) return true;
  }
  const featureBbox = bboxFromCoordinates(coords);
  if (featureBbox && bboxIntersects(featureBbox, bbox)) return true;
  return isPointInBbox(centerFallback.lat, centerFallback.lng, bbox);
}

export function osmFeatureWithinViewportBbox(
  feature: { lat: number; lng: number; coordinates?: Array<{ lat: number; lng: number }> },
  bbox: InventoryBbox
): boolean {
  const coords = feature.coordinates?.length ? feature.coordinates : [];
  return intersectsBbox(coords, { lat: feature.lat, lng: feature.lng }, bbox);
}

/** Keep preview docs whose anchor or trail line intersects the viewport. */
export function previewDocWithinViewportBbox(
  doc: PbfCopierPreviewDoc,
  bbox: InventoryBbox
): boolean {
  if (doc.kind === "unexplored_route") {
    const line = doc.routeLineCoordinates ?? [];
    return intersectsBbox(line, { lat: doc.lat, lng: doc.lng }, bbox);
  }
  return isPointInBbox(doc.lat, doc.lng, bbox);
}

function osmSourceKey(osmType: string, osmId: number): string {
  return `${osmType}/${osmId}`;
}

function indexCoveredOsmKeys(items: PbfCopierPreviewDoc[]): Set<string> {
  const keys = new Set<string>();
  for (const doc of items) {
    keys.add(osmSourceKey(doc.osmType, doc.osmId));
  }
  return keys;
}

function downsampleLine(
  points: Array<{ lat: number; lng: number }>,
  maxPoints: number
): Array<{ lat: number; lng: number }> {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]!);
  const last = points[points.length - 1];
  if (last && out[out.length - 1] !== last) out.push(last);
  return out;
}

function trimTags(tags: Record<string, string> | undefined): Record<string, string> {
  if (!tags) return {};
  const out: Record<string, string> = {};
  let i = 0;
  for (const [k, v] of Object.entries(tags)) {
    if (i >= PREVIEW_TAG_SAMPLE_FIELDS) break;
    out[k] = v;
    i += 1;
  }
  return out;
}

function isRawRouteCandidateTags(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  const highway = tags.highway?.toLowerCase();
  const route = tags.route?.toLowerCase();
  if (route && ["hiking", "foot", "walking", "bicycle", "mtb", "running"].includes(route)) return true;
  if (highway && ["path", "footway", "cycleway", "bridleway", "track", "steps"].includes(highway)) {
    return true;
  }
  if (tags.sac_scale || tags.trail_visibility) return true;
  return false;
}

function isTagCoverageRouteFeature(feature: OsmFeatureListItem, tags: Record<string, string>): boolean {
  if (feature.osmType === "relation" && tags.route) return true;
  if (feature.geometryKind === "line" && feature.coordinates.length >= 2) {
    if (isRawRouteCandidateTags(tags)) return true;
    if (tags.highway && feature.osmType === "way") return true;
  }
  return false;
}

function inferPrimaryCategory(tags: Record<string, string>, feature: OsmFeatureListItem): string {
  const explicit = getSupportingDestinationTags(tags)[0];
  if (explicit) return explicit;
  if (tags["piste:type"]) return "ski_run";
  if (tags.aerialway === "chair_lift") return "chair_lift";
  if (tags.amenity === "parking" || tags.parking) return "parking";
  if (tags.leisure) return tags.leisure;
  if (tags.tourism) return tags.tourism;
  if (tags.natural) return tags.natural;
  if (tags.amenity) return tags.amenity;
  if (tags.highway) return tags.highway;
  return feature.featureType || "osm";
}

function inferActivities(tags: Record<string, string>, category: string): string[] {
  const acts = new Set<string>();
  if (tags.amenity === "parking" || tags.parking) acts.add("parking");
  if (tags["piste:type"] || tags.aerialway === "chair_lift") acts.add("skiing");
  const route = tags.route?.toLowerCase();
  const highway = tags.highway?.toLowerCase();
  if (route === "hiking" || route === "foot" || highway === "path" || highway === "footway") {
    acts.add("hiking");
  }
  if (tags.natural === "peak" || tags.natural === "hill") acts.add("hiking");
  if (acts.size === 0 && category) acts.add(category);
  return [...acts];
}

function buildRawOsmDisplayName(input: {
  feature: OsmFeatureListItem;
  osmType: "node" | "way" | "relation";
  osmId: number;
  tags: Record<string, string>;
}): string {
  const named = input.feature.name?.trim();
  if (named) return named;
  const labelKeys = [
    "amenity",
    "shop",
    "tourism",
    "leisure",
    "natural",
    "highway",
    "building",
    "landuse",
    "man_made",
    "historic",
    "waterway",
    "office",
    "craft",
    "railway",
    "aeroway",
    "aerialway",
    "piste:type",
    "place",
  ] as const;
  for (const key of labelKeys) {
    const value = input.tags[key];
    if (value) return `${key}=${value}`;
  }
  return `OSM ${input.osmType}/${input.osmId}`;
}

function isRawOsmRouteFeature(
  feature: OsmFeatureListItem,
  osmType: "node" | "way" | "relation",
  tags: Record<string, string>
): boolean {
  if (feature.coordinates.length >= 2) {
    if (feature.geometryKind === "line") return true;
    // Open ways mis-tagged polygon still draw as polylines (footway/path trails).
    if (osmType === "way" && !feature.closed) return true;
  }
  if (tags["piste:type"] && feature.coordinates.length >= 2) return true;
  if (tags.aerialway === "chair_lift" && feature.coordinates.length >= 2) return true;
  if (osmType === "relation" && (tags.type === "route" || tags.route)) return true;
  return false;
}

/** Every OSM object with geometry in the viewport — no classifier, no tag filter, no dedupe. */
function buildRawOsmPreviewDoc(input: {
  feature: OsmFeatureListItem;
  osmType: "node" | "way" | "relation";
  osmId: number;
  pbfFilePath: string;
  metadata: PbfAdapterMetadata;
}): PbfCopierPreviewDoc {
  const { feature, osmType, osmId, pbfFilePath, metadata } = input;
  const tags = feature.tags ?? {};
  const displayName = buildRawOsmDisplayName({ feature, osmType, osmId, tags });
  const category = inferPrimaryCategory(tags, feature);
  const activities = inferActivities(tags, category);
  const primaryActivity = activities[0] ?? category;
  const sourceKey = `${osmType}/${osmId}`;
  const isRoute = isRawOsmRouteFeature(feature, osmType, tags);
  const routeLineCoordinates =
    isRoute && feature.coordinates.length >= 2
      ? downsampleLine(feature.coordinates, ROUTE_LINE_POINT_CAP)
      : undefined;
  const anchor = { lat: feature.lat, lng: feature.lng };

  return {
    id: `raw:${feature.id || sourceKey}`,
    kind: isRoute ? "unexplored_route" : "unexplored_spot",
    collection: isRoute ? "unexploredRoutes" : "unexploredSpots",
    displayName,
    primaryActivity,
    activities,
    primaryCategory: category,
    lat: anchor.lat,
    lng: anchor.lng,
    center: anchor,
    sourceFamily: "openstreetmap_pbf_v2_raw",
    sourceKeys: [sourceKey],
    sourceIds: [String(osmId)],
    osmType,
    osmId,
    origin: "generated_osm",
    mapReadiness: "review",
    publicMapEligible: false,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: V2_RUN_ID_PREFIX,
    importPipelineVersion: V2_RUN_ID_PREFIX,
    pbfFilePath,
    sourceProvider: metadata.sourceProvider,
    sourceTagSample: trimTags(tags),
    warnings: ["v2_raw_osm_unfiltered"],
    routeLineCoordinates,
    hasRouteGeometry: Boolean(routeLineCoordinates && routeLineCoordinates.length >= 2),
    geometryPointCount: routeLineCoordinates?.length ?? 0,
  };
}

/** Classifier-skipped OSM object — still drawn on the V2 coverage map. */
function buildTagCoveragePreviewDoc(input: {
  feature: OsmFeatureListItem;
  osmType: "node" | "way" | "relation";
  osmId: number;
  pbfFilePath: string;
  metadata: PbfAdapterMetadata;
}): PbfCopierPreviewDoc {
  const { feature, osmType, osmId, pbfFilePath, metadata } = input;
  const tags = feature.tags ?? {};
  const category = inferPrimaryCategory(tags, feature);
  const activities = inferActivities(tags, category);
  const primaryActivity = activities[0] ?? category;
  const displayName =
    feature.name?.trim() ||
    (tags.amenity === "parking" ? "Parking" : null) ||
    (tags.natural === "peak" ? "Peak" : null) ||
    `OSM ${osmType}/${osmId}`;
  const sourceKey = `${osmType}/${osmId}`;
  const isRoute = isTagCoverageRouteFeature(feature, tags);
  const routeLineCoordinates =
    isRoute && feature.coordinates.length >= 2
      ? downsampleLine(feature.coordinates, ROUTE_LINE_POINT_CAP)
      : undefined;
  const anchor =
    isRoute && routeLineCoordinates && routeLineCoordinates.length > 0
      ? routeLineCoordinates[0]!
      : { lat: feature.lat, lng: feature.lng };

  const nameEval = evaluateNameInference(tags, displayName);

  return {
    id: `coverage:${feature.id || sourceKey}`,
    kind: isRoute ? "unexplored_route" : "unexplored_spot",
    collection: isRoute ? "unexploredRoutes" : "unexploredSpots",
    displayName,
    primaryActivity,
    activities,
    primaryCategory: category,
    lat: anchor.lat,
    lng: anchor.lng,
    center: anchor,
    sourceFamily: "openstreetmap_pbf_v2_tag_coverage",
    sourceKeys: [sourceKey],
    sourceIds: [String(osmId)],
    osmType,
    osmId,
    origin: "generated_osm",
    mapReadiness: "review",
    publicMapEligible: false,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: V2_RUN_ID_PREFIX,
    importPipelineVersion: V2_RUN_ID_PREFIX,
    pbfFilePath,
    sourceProvider: metadata.sourceProvider,
    sourceTagSample: trimTags(tags),
    warnings: ["v2_tag_coverage_only"],
    nameInferenceUsed: nameEval.nameInferenceUsed,
    nameInferenceReason: nameEval.nameInferenceReason,
    nameInferenceBlockedReason: nameEval.nameInferenceBlockedReason,
    routeLineCoordinates,
    hasRouteGeometry: Boolean(routeLineCoordinates && routeLineCoordinates.length >= 2),
    geometryPointCount: routeLineCoordinates?.length ?? 0,
  };
}

function enrichRouteDocFromCandidate(
  doc: PbfCopierPreviewDoc,
  candidate: CandidateFeature | undefined
): PbfCopierPreviewDoc {
  if (!candidate?.feature.coordinates || candidate.feature.coordinates.length < 2) return doc;
  if (doc.routeLineCoordinates && doc.routeLineCoordinates.length >= 2) return doc;
  const line = downsampleLine(candidate.feature.coordinates, ROUTE_LINE_POINT_CAP);
  if (line.length < 2) return doc;
  const routePayload = doc.writePayload as UnexploredRoute | undefined;
  const anchor = routePayload
    ? resolveRoutePostAnchor(routePayload, line)
    : resolveRoutePostAnchor(
        {
          center: doc.center ?? { lat: line[0]!.lat, lng: line[0]!.lng },
          selectedParking: null,
          selectedTrailhead: null,
        },
        line
      );
  return {
    ...doc,
    routeLineCoordinates: line,
    hasRouteGeometry: true,
    geometryPointCount: line.length,
    lat: anchor.lat,
    lng: anchor.lng,
    center: anchor,
  };
}

/** Tag-filter hits the classifier skipped — spots only. Never add raw OSM way segments as routes (causes junction pins). */
function isInterestingTagCoverageCandidate(feature: OsmFeatureListItem, tags: Record<string, string>): boolean {
  if (isTagCoverageRouteFeature(feature, tags)) return false;
  if (tags.building && !tags.tourism && !tags.amenity) return false;
  if (tags.amenity === "parking" || tags.parking) return true;
  if (tags.highway === "trailhead") return true;
  if (isOsmObservationTowerTags(tags)) return true;
  if (tags.waterway === "waterfall" || tags.waterway === "dam") return true;
  if (tags.natural === "water" || tags.landuse === "reservoir") return true;
  if (
    tags.natural &&
    ["peak", "hill", "spring", "waterfall", "beach", "cave", "arch", "cliff", "wood"].includes(
      tags.natural
    )
  ) {
    return true;
  }
  if (
    tags.tourism &&
    ["viewpoint", "picnic_site", "camp_site", "trailhead", "attraction", "museum", "information"].includes(
      tags.tourism
    )
  ) {
    return true;
  }
  if (tags.leisure && ["park", "nature_reserve", "swimming_area", "track"].includes(tags.leisure)) {
    return true;
  }
  return false;
}

function routePreviewLineLength(doc: PbfCopierPreviewDoc): number {
  return doc.routeLineCoordinates?.length ?? 0;
}

/** One preview route per trail name — longest stitched line; prefer classifier over tag-coverage segment. */
export function collapseRoutePreviewDocsByTrailName(docs: PbfCopierPreviewDoc[]): PbfCopierPreviewDoc[] {
  const spots = docs.filter((d) => d.kind !== "unexplored_route");
  const routes = docs.filter((d) => d.kind === "unexplored_route");
  const unlabeled: PbfCopierPreviewDoc[] = [];
  const byName = new Map<string, PbfCopierPreviewDoc[]>();

  for (const doc of routes) {
    const key = normalizePreviewDisplayName(doc.displayName);
    if (!key) {
      unlabeled.push(doc);
      continue;
    }
    const bucket = byName.get(key) ?? [];
    bucket.push(doc);
    byName.set(key, bucket);
  }

  const keptRoutes: PbfCopierPreviewDoc[] = [];
  for (const bucket of byName.values()) {
    bucket.sort((a, b) => {
      const classifierA = a.warnings?.includes("v2_tag_coverage_only") ? 0 : 1;
      const classifierB = b.warnings?.includes("v2_tag_coverage_only") ? 0 : 1;
      if (classifierB !== classifierA) return classifierB - classifierA;
      return routePreviewLineLength(b) - routePreviewLineLength(a);
    });
    keptRoutes.push(bucket[0]!);
  }

  return [...spots, ...keptRoutes, ...unlabeled];
}

function appendTagCoverageFromBatch(input: {
  items: PbfCopierPreviewDoc[];
  batch: CandidateFeature[];
  coveredKeys: Set<string>;
  inventoryBbox: InventoryBbox;
  pbfFilePath: string;
  metadata: PbfAdapterMetadata;
}): number {
  let added = 0;
  for (const candidate of input.batch) {
    const key = osmSourceKey(candidate.osmType, candidate.osmId);
    if (input.coveredKeys.has(key)) continue;
    if (!isInterestingTagCoverageCandidate(candidate.feature, candidate.feature.tags ?? {})) continue;
    const doc = buildTagCoveragePreviewDoc({
      feature: candidate.feature,
      osmType: candidate.osmType,
      osmId: candidate.osmId,
      pbfFilePath: input.pbfFilePath,
      metadata: input.metadata,
    });
    if (!previewDocWithinViewportBbox(doc, input.inventoryBbox)) continue;
    input.items.push(doc);
    input.coveredKeys.add(key);
    added += 1;
  }
  return added;
}

function inferStateCodeFromPath(filePath: string): string {
  const base = filePath.toLowerCase();
  if (base.includes("vermont") || base.includes("/vt")) return "VT";
  if (base.includes("new-hampshire") || base.includes("/nh")) return "NH";
  return "US";
}

async function processViewportCandidateBatch(input: {
  candidates: CandidateFeature[];
  runId: string;
  stateCode: string;
  metadata: PbfAdapterMetadata;
}): Promise<{
  spots: UnexploredSpot[];
  routes: UnexploredRoute[];
  rejectedCount: number;
  spotSourceMap: Map<string, { osmType: "node" | "way" | "relation"; osmId: number }>;
  routeSourceMap: Map<string, { osmType: "node" | "way" | "relation"; osmId: number }>;
}> {
  const { candidates, runId, stateCode, metadata } = input;
  if (candidates.length === 0) {
    return {
      spots: [],
      routes: [],
      rejectedCount: 0,
      spotSourceMap: new Map(),
      routeSourceMap: new Map(),
    };
  }

  let minLat = 90;
  let minLng = 180;
  let maxLat = -90;
  let maxLng = -180;
  for (const candidate of candidates) {
    minLat = Math.min(minLat, candidate.feature.lat);
    maxLat = Math.max(maxLat, candidate.feature.lat);
    minLng = Math.min(minLng, candidate.feature.lng);
    maxLng = Math.max(maxLng, candidate.feature.lng);
  }
  const chunkBbox = { minLat, minLng, maxLat, maxLng };

  const elementsById = new Map<string, OverpassElement>();
  for (const candidate of candidates) {
    if (candidate.element) {
      elementsById.set(`${candidate.osmType}/${candidate.osmId}`, candidate.element);
    }
  }

  const classification = await classifyFn()({
    bbox: chunkBbox,
    stateCode,
    runId,
    source: "fixture",
    rawFeatures: candidates.map((c) => c.feature),
    elementsById,
    includeOsmSpots: true,
    includeOsmRoutes: true,
    includeOsmOffroad: true,
    offroadSource: "osm",
    useLiveVtrans: false,
    useLiveNhdot: false,
    includeClass4: false,
    includeLegalTrails: false,
    includeClass6: false,
  });

  const dedupedRoutes = dedupeLocavaInventory({
    spots: [],
    routes: classification.acceptedRoutes as LocavaInventoryRoute[],
  });

  const { spots, routes } = buildUnexploredDocsFromClassification({
    spots: classification.acceptedSpots as LocavaInventorySpot[],
    routes: dedupedRoutes.routes,
    stateCode,
    runId,
    chunkId: `pbf_v2_${metadata.pbfFilePath}`,
    writeMode: false,
    writeTarget: "none",
    includePublicOnly: false,
    includeReviewItems: true,
    includeOsmSpots: true,
    includeOsmRoutes: true,
    includeOffroad: true,
  });

  const validSpots: UnexploredSpot[] = [];
  const validRoutes: UnexploredRoute[] = [];
  let invalidCount = 0;

  for (const spot of spots) {
    if (validateUnexploredSpotForCopier(spot).length === 0) validSpots.push(spot);
    else invalidCount += 1;
  }
  for (const route of routes) {
    if (validateUnexploredRouteForCopier(route).length === 0) validRoutes.push(route);
    else invalidCount += 1;
  }

  const sourceKeyIndex = new Map<string, { osmType: "node" | "way" | "relation"; osmId: number }>();
  for (const candidate of candidates) {
    sourceKeyIndex.set(candidate.feature.id, {
      osmType: candidate.osmType,
      osmId: candidate.osmId,
    });
  }

  const spotSourceMap = new Map<string, { osmType: "node" | "way" | "relation"; osmId: number }>();
  for (const spot of validSpots) {
    for (const sourceKey of spot.sourceKeys ?? []) {
      const found = sourceKeyIndex.get(sourceKey);
      if (found) {
        spotSourceMap.set(spot.id, found);
        break;
      }
    }
  }

  const routeSourceMap = new Map<string, { osmType: "node" | "way" | "relation"; osmId: number }>();
  for (const route of validRoutes) {
    for (const sourceKey of route.sourceKeys ?? []) {
      const found = sourceKeyIndex.get(sourceKey);
      if (found) {
        routeSourceMap.set(route.id, found);
        break;
      }
    }
  }

  return {
    spots: validSpots,
    routes: validRoutes,
    rejectedCount: classification.rejected.length + invalidCount,
    spotSourceMap,
    routeSourceMap,
  };
}

function appendPreviewDocsFromBatch(input: {
  items: PbfCopierPreviewDoc[];
  batch: CandidateFeature[];
  result: Awaited<ReturnType<typeof processViewportCandidateBatch>>;
  inventoryBbox: InventoryBbox;
  pbfFilePath: string;
  metadata: PbfAdapterMetadata;
}): void {
  const { items, batch, result, inventoryBbox, pbfFilePath, metadata } = input;
  const candidateBySource = new Map<string, CandidateFeature>();
  for (const c of batch) {
    candidateBySource.set(osmSourceKey(c.osmType, c.osmId), c);
  }

  for (const spot of result.spots) {
    const source = result.spotSourceMap.get(spot.id);
    if (!source) continue;
    let doc = buildSpotPreviewDoc({
      spot,
      source,
      pbfFilePath,
      sourceProvider: metadata.sourceProvider,
    });
    if (!previewDocWithinViewportBbox(doc, inventoryBbox)) continue;
    items.push(doc);
  }

  for (const route of result.routes) {
    const source = result.routeSourceMap.get(route.id);
    if (!source) continue;
    let doc = buildRoutePreviewDoc({
      route,
      source,
      pbfFilePath,
      sourceProvider: metadata.sourceProvider,
      allowMissingLineGeometry: true,
    });
    if (!doc) continue;
    doc = enrichRouteDocFromCandidate(doc, candidateBySource.get(osmSourceKey(source.osmType, source.osmId)));
    if (!previewDocWithinViewportBbox(doc, inventoryBbox)) continue;
    items.push(doc);
  }
}

async function scanPbfViewportPreviewRaw(input: {
  pbfPath: string;
  bbox: PbfCopierV2ViewportBbox;
}): Promise<PbfCopierV2ViewportPreviewResult> {
  validateViewportBbox(input.bbox);
  const inventoryBbox = viewportBboxToInventoryBbox(input.bbox);
  const startMs = Date.now();

  const validation = await validatePbfFile(input.pbfPath);
  if (!validation.exists) {
    throw new Error(`pbf_not_found: ${validation.resolvedPath}`);
  }
  if (!validation.readable) {
    throw new Error(`pbf_not_readable: ${validation.warnings.join("; ")}`);
  }

  const stats: PbfCopierV2ViewportPreviewStats = {
    previewMode: "raw_osm",
    rawObjectsScanned: 0,
    nodesScanned: 0,
    waysScanned: 0,
    relationsScanned: 0,
    tagFilterSkipped: 0,
    adapterSkipped: 0,
    geometrySkipped: 0,
    outsideBboxSkipped: 0,
    candidatesSentToClassifier: 0,
    classifierAcceptedSpots: 0,
    classifierAcceptedRoutes: 0,
    rejectedByClassifier: 0,
    tagCoverageItemsAdded: 0,
    classifierItemsReturned: 0,
    itemsReturned: 0,
    elapsedMs: 0,
  };

  const items: PbfCopierPreviewDoc[] = [];
  const readerFactory = viewportPreviewHooks.readerFactory ?? defaultPbfFeatureReaderFactory;
  const nodeCache = await buildPbfNodeCoordinateCache(validation.resolvedPath, readerFactory);
  const reader = await readerFactory({ filePath: validation.resolvedPath });
  const opened = await reader.open({ filePath: validation.resolvedPath });
  const metadata = buildPbfAdapterMetadata({
    filePath: validation.resolvedPath,
    parserVersion: opened.parserVersion,
    sourceTimestamp: opened.sourceTimestamp,
  });

  try {
    for await (const chunk of reader.read()) {
      for (const entity of chunk.entities) {
        stats.rawObjectsScanned += 1;
        if (entity.type === "node") stats.nodesScanned += 1;
        else if (entity.type === "way") stats.waysScanned += 1;
        else if (entity.type === "relation") stats.relationsScanned += 1;

        const resolvedEntity = withFullWayGeometry(entity, nodeCache);
        if (!isPbfEntitySupportedForCopier(resolvedEntity)) continue;

        const adapted = adaptPbfEntityToOverpassElement(resolvedEntity as PbfRawEntity, metadata);
        if (!adapted) {
          stats.adapterSkipped += 1;
          continue;
        }

        const feature = parseOverpassElement(adapted.element);
        if (!feature) {
          stats.geometrySkipped += 1;
          continue;
        }

        if (!osmFeatureWithinViewportBbox(feature, inventoryBbox)) {
          stats.outsideBboxSkipped += 1;
          continue;
        }

        let doc = buildRawOsmPreviewDoc({
          feature,
          osmType: adapted.sourceMetadata.osmType,
          osmId: adapted.sourceMetadata.osmId,
          pbfFilePath: validation.resolvedPath,
          metadata,
        });
        doc = enrichRoutePreviewDoc(doc);
        if (!previewDocWithinViewportBbox(doc, inventoryBbox)) continue;
        items.push(doc);
      }
    }
  } finally {
    await reader.close();
  }

  const processed = postProcessRawOsmPreviewDocs(items);
  const finalItems = processed.items.map((doc) =>
    doc.kind === "unexplored_route" ? enrichRoutePreviewDoc(doc) : doc
  );
  stats.residentialHomesFiltered = processed.residentialHomesFiltered;
  stats.hikingTrailGroupsMerged = processed.hikingTrailGroupsMerged;
  stats.hikingTrailSegmentsCollapsed = processed.hikingTrailSegmentsCollapsed;
  stats.itemsReturned = finalItems.length;
  stats.classifierItemsReturned = 0;
  stats.classifierAcceptedSpots = finalItems.filter((d) => d.kind === "unexplored_spot").length;
  stats.classifierAcceptedRoutes = finalItems.filter((d) => d.kind === "unexplored_route").length;
  stats.elapsedMs = Date.now() - startMs;

  return {
    ok: true,
    bbox: input.bbox,
    items: finalItems,
    stats,
  };
}

export async function scanPbfViewportPreview(input: {
  pbfPath: string;
  bbox: PbfCopierV2ViewportBbox;
  mode?: PbfCopierV2ViewportPreviewMode;
}): Promise<PbfCopierV2ViewportPreviewResult> {
  if (input.mode !== "locava_filtered") {
    return scanPbfViewportPreviewRaw(input);
  }

  validateViewportBbox(input.bbox);
  const inventoryBbox = viewportBboxToInventoryBbox(input.bbox);
  const startMs = Date.now();
  const runId = `${V2_RUN_ID_PREFIX}_${startMs}`;
  const stateCode = inferStateCodeFromPath(input.pbfPath);

  const validation = await validatePbfFile(input.pbfPath);
  if (!validation.exists) {
    throw new Error(`pbf_not_found: ${validation.resolvedPath}`);
  }
  if (!validation.readable) {
    throw new Error(`pbf_not_readable: ${validation.warnings.join("; ")}`);
  }

  const stats: PbfCopierV2ViewportPreviewStats = {
    previewMode: "locava_filtered",
    rawObjectsScanned: 0,
    nodesScanned: 0,
    waysScanned: 0,
    relationsScanned: 0,
    tagFilterSkipped: 0,
    adapterSkipped: 0,
    geometrySkipped: 0,
    outsideBboxSkipped: 0,
    candidatesSentToClassifier: 0,
    classifierAcceptedSpots: 0,
    classifierAcceptedRoutes: 0,
    rejectedByClassifier: 0,
    tagCoverageItemsAdded: 0,
    classifierItemsReturned: 0,
    itemsReturned: 0,
    elapsedMs: 0,
  };

  const items: PbfCopierPreviewDoc[] = [];
  const readerFactory = viewportPreviewHooks.readerFactory ?? defaultPbfFeatureReaderFactory;
  const tagFilter = createPbfTagFilter(resolvePbfTagFilterPolicy(DEFAULT_PBF_COPIER_CONFIG));
  const hillPeakSpatialIndex: HillPeakTrailSpatialIndex = createHillPeakTrailSpatialIndex();
  const pendingBareHillPeaks: CandidateFeature[] = [];

  const reader = await readerFactory({ filePath: validation.resolvedPath });
  const opened = await reader.open({ filePath: validation.resolvedPath });
  const metadata = buildPbfAdapterMetadata({
    filePath: validation.resolvedPath,
    parserVersion: opened.parserVersion,
    sourceTimestamp: opened.sourceTimestamp,
  });

  const batch: CandidateFeature[] = [];

  async function flushBatch(): Promise<void> {
    if (batch.length === 0) return;
    stats.candidatesSentToClassifier += batch.length;
    const result = await processViewportCandidateBatch({
      candidates: [...batch],
      runId,
      stateCode,
      metadata,
    });
    stats.classifierAcceptedSpots += result.spots.length;
    stats.classifierAcceptedRoutes += result.routes.length;
    stats.rejectedByClassifier += result.rejectedCount;
    appendPreviewDocsFromBatch({
      items,
      batch,
      result,
      inventoryBbox,
      pbfFilePath: validation.resolvedPath,
      metadata,
    });
    const coveredKeys = indexCoveredOsmKeys(items);
    stats.tagCoverageItemsAdded += appendTagCoverageFromBatch({
      items,
      batch: [...batch],
      coveredKeys,
      inventoryBbox,
      pbfFilePath: validation.resolvedPath,
      metadata,
    });
    batch.length = 0;
  }

  try {
    for await (const chunk of reader.read()) {
      for (const entity of chunk.entities) {
        stats.rawObjectsScanned += 1;
        if (entity.type === "node") stats.nodesScanned += 1;
        else if (entity.type === "way") stats.waysScanned += 1;
        else if (entity.type === "relation") stats.relationsScanned += 1;

        if (!isPbfEntitySupportedForCopier(entity)) continue;
        if (!tagFilter.isCandidate(entity.tags)) {
          stats.tagFilterSkipped += 1;
          continue;
        }

        const adapted = adaptPbfEntityToOverpassElement(entity as PbfRawEntity, metadata);
        if (!adapted) {
          stats.adapterSkipped += 1;
          continue;
        }

        const feature = parseOverpassElement(adapted.element);
        if (!feature) {
          stats.geometrySkipped += 1;
          continue;
        }

        if (!osmFeatureWithinViewportBbox(feature, inventoryBbox)) {
          stats.outsideBboxSkipped += 1;
          continue;
        }

        if (isOsmViewpointTags(feature.tags)) {
          registerViewpointOnSpatialIndex(hillPeakSpatialIndex, feature.lat, feature.lng);
        }
        if (isOsmHikingTrailTags(feature.tags)) {
          registerHikingTrailOnSpatialIndex(hillPeakSpatialIndex, feature);
        }

        const deferBareHillPeak =
          isOsmBareHillOrPeakTags(feature.tags) && !hillOrPeakHasOnTagTrailContext(feature.tags);
        if (deferBareHillPeak) {
          pendingBareHillPeaks.push({
            feature,
            osmType: adapted.sourceMetadata.osmType,
            osmId: adapted.sourceMetadata.osmId,
            element: adapted.element,
          });
          continue;
        }

        batch.push({
          feature,
          osmType: adapted.sourceMetadata.osmType,
          osmId: adapted.sourceMetadata.osmId,
          element: adapted.element,
        });

        if (batch.length >= CLASSIFY_BATCH_SIZE) {
          await flushBatch();
        }
      }
    }

    if (batch.length > 0) {
      await flushBatch();
    }

    if (pendingBareHillPeaks.length > 0) {
      const hillPeakBatch: CandidateFeature[] = [];
      for (const candidate of pendingBareHillPeaks) {
        const gate = evaluateHillPeakSpatialGate(
          hillPeakSpatialIndex,
          candidate.feature.lat,
          candidate.feature.lng
        );
        if (gate.accept) {
          hillPeakBatch.push({
            ...candidate,
            feature: { ...candidate.feature, nearbyHikingTrail: true },
          });
        }
      }
      if (hillPeakBatch.length > 0) {
        stats.candidatesSentToClassifier += hillPeakBatch.length;
        const result = await processViewportCandidateBatch({
          candidates: hillPeakBatch,
          runId,
          stateCode,
          metadata,
        });
        stats.classifierAcceptedSpots += result.spots.length;
        stats.classifierAcceptedRoutes += result.routes.length;
        stats.rejectedByClassifier += result.rejectedCount;
        appendPreviewDocsFromBatch({
          items,
          batch: hillPeakBatch,
          result,
          inventoryBbox,
          pbfFilePath: validation.resolvedPath,
          metadata,
        });
      }
    }
  } finally {
    await reader.close();
  }

  stats.classifierItemsReturned = items.filter((d) => !d.warnings?.includes("v2_tag_coverage_only")).length;

  const collapsed = collapseRoutePreviewDocsByTrailName(items);
  const finalized = finalizePreviewDocsQuality(collapsed, { skipDisplayNameDedupe: true });
  const finalItems = finalized.previewDocs;

  stats.itemsReturned = finalItems.length;
  stats.classifierAcceptedSpots = finalItems.filter(
    (d) => d.kind === "unexplored_spot" && !d.warnings?.includes("v2_tag_coverage_only")
  ).length;
  stats.classifierAcceptedRoutes = finalItems.filter(
    (d) => d.kind === "unexplored_route" && !d.warnings?.includes("v2_tag_coverage_only")
  ).length;
  stats.elapsedMs = Date.now() - startMs;

  return {
    ok: true,
    bbox: input.bbox,
    items: finalItems,
    stats,
  };
}
