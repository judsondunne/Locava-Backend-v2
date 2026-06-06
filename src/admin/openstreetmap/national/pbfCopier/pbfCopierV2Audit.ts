/**
 * PBF Copier V2 — dev-only audit runner.
 *
 * Wraps the existing raw_osm scan + quality-filter pipeline without changing
 * classifier rules, merge behavior, or Firestore writes.
 */
import { tilesForViewport } from "../../../../lib/inventory/inventoryTileGrid.js";
import { haversineMeters } from "../../../../lib/inventory/inventoryTileGrid.js";
import { materializeV2PreviewDocWritePayload } from "./pbfCopierV2BlankDocBuilder.js";
import { runPbfCopierV2Pipeline } from "./pbfCopierV2Pipeline.js";
import {
  DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
  type PbfQualityFilterSettings,
  type PbfQualityFilteredPreviewDoc,
} from "./pbfCopierV2QualityFilters.js";
import {
  inferAcceptReasonCodes,
  inferOsmTagFamily,
  looksPotentiallyBoring,
  looksPotentiallyInteresting,
  mapClassifierRejectionToCodes,
  mapQualityFilterToRejectCodes,
  mapResidentialRejectCodes,
  type PbfAuditTagFamily,
} from "./pbfCopierV2AuditReasons.js";
import { routeLinePoints } from "./pbfCopierV2RouteEnrichment.js";
import { isHikingTrailPreviewDoc } from "./pbfCopierV2RawDisplay.js";
import { normalizePreviewDisplayName } from "./pbfCopierPreviewQuality.js";
import { validatePbfFile } from "./pbfCopierRunner.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import {
  scanPbfViewportPreview,
  type PbfCopierV2ViewportBbox,
  type PbfCopierV2ViewportPreviewMode,
} from "./pbfCopierV2ViewportPreview.js";
import { inferStateCodeFromFilePath } from "./pbfCopierPathHelpers.js";
import { distanceMetersForCoords } from "../../../../lib/inventory/trails/inventoryTrailGraph.js";

export type PbfCopierV2AuditOptions = {
  pbfPath: string;
  bbox: PbfCopierV2ViewportBbox;
  limit?: number;
  includeRejected?: boolean;
  includeRawTags?: boolean;
  includeGeometry?: boolean;
  includeWritePreview?: boolean;
  dryRun?: boolean;
  sampleMode?: PbfCopierV2ViewportPreviewMode;
  categoryFilter?: string;
  osmIdFilter?: string;
  maxRawObjectsScanned?: number;
  qualitySettings?: Partial<PbfQualityFilterSettings>;
};

export type PbfAuditWritePreview = {
  collection: "unexploredSpots" | "unexploredRoutes";
  docId: string;
  data: Record<string, unknown>;
};

export type PbfAuditGeometryStats = {
  pointCount: number;
  distanceMeters: number;
  segmentCount: number;
  isClosedLoop: boolean;
};

export type PbfAuditFragmentationHints = {
  mayBeFragmented: boolean;
  splitByIntersectionGrouping: boolean;
  mergedFromSegments: boolean;
  segmentSourceCount: number;
  touchesOtherWays: Array<{ osmType: string; osmId: number }>;
  sameNameNearbyWays: Array<{ osmType: string; osmId: number; name: string }>;
  relationParentIds: number[];
};

export type PbfAuditSpotRecord = {
  osmType: "node" | "way" | "relation";
  osmId: number;
  name: string | null;
  lat: number;
  long: number;
  category: string | null;
  tagFamily: PbfAuditTagFamily;
  sourceTags: Record<string, string>;
  acceptReasons: string[];
  qualityScore: number | null;
  filteredBy?: string[];
  filterReason?: string;
  writePreview?: PbfAuditWritePreview;
  geometry?: Array<{ lat: number; lng: number }>;
};

export type PbfAuditRejectedSpotRecord = {
  osmType: "node" | "way" | "relation";
  osmId: number;
  name: string | null;
  lat: number;
  long: number;
  tagFamily: PbfAuditTagFamily;
  sourceTags: Record<string, string>;
  rejectReasons: string[];
  wouldHaveCategory: string | null;
  filteredBy?: string[];
  filterReason?: string;
  rejectStage: "residential_filter" | "quality_filter" | "classifier" | "validation";
};

export type PbfAuditRouteRecord = {
  osmType: "way" | "relation";
  osmId: number;
  name: string | null;
  routeType: string | null;
  tagFamily: PbfAuditTagFamily;
  sourceTags: Record<string, string>;
  geometryStats: PbfAuditGeometryStats;
  fragmentationHints: PbfAuditFragmentationHints;
  acceptReasons: string[];
  filteredBy?: string[];
  filterReason?: string;
  writePreview?: PbfAuditWritePreview;
  geometry?: Array<{ lat: number; lng: number }>;
};

export type PbfAuditRejectedRouteRecord = {
  osmType: "way" | "relation";
  osmId: number;
  name: string | null;
  tagFamily: PbfAuditTagFamily;
  sourceTags: Record<string, string>;
  rejectReasons: string[];
  rejectStage: "quality_filter" | "classifier" | "validation";
  fragmentationHints: Partial<PbfAuditFragmentationHints>;
  filteredBy?: string[];
  filterReason?: string;
};

export type PbfAuditBorderlineRecord = {
  osmType: string;
  osmId: number;
  name: string | null;
  sourceTags: Record<string, string>;
  whyCursorShouldReview: string;
};

export type PbfCopierV2AuditResult = {
  ok: true;
  mode: "audit";
  dryRun: boolean;
  pipelineMode: PbfCopierV2ViewportPreviewMode;
  firestoreWrites: false;
  pbfPath: string;
  resolvedPbfPath: string;
  bbox: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
  summary: {
    rawElementsScanned: number;
    rawNodes: number;
    rawWays: number;
    rawRelations: number;
    residentialHomesFiltered: number;
    hikingTrailGroupsMerged: number;
    hikingTrailSegmentsCollapsed: number;
    candidateSpots: number;
    acceptedSpots: number;
    rejectedSpots: number;
    candidateRoutes: number;
    acceptedRoutes: number;
    rejectedRoutes: number;
    tilesTouched: number;
    qualityFilterHidden: number;
    qualityFilterVisible: number;
    byTagFamily: Record<PbfAuditTagFamily, { accepted: number; rejected: number }>;
    elapsedMs: number;
  };
  acceptedSpots: PbfAuditSpotRecord[];
  rejectedSpots: PbfAuditRejectedSpotRecord[];
  acceptedRoutes: PbfAuditRouteRecord[];
  rejectedRoutes: PbfAuditRejectedRouteRecord[];
  potentialFalseNegatives: PbfAuditBorderlineRecord[];
  potentialFalsePositives: PbfAuditBorderlineRecord[];
  limitations: string[];
};

const ENDPOINT_TOUCH_TOLERANCE_METERS = 45;

function emptyTagFamilyCounts(): Record<PbfAuditTagFamily, { accepted: number; rejected: number }> {
  return {
    amenity: { accepted: 0, rejected: 0 },
    tourism: { accepted: 0, rejected: 0 },
    leisure: { accepted: 0, rejected: 0 },
    shop: { accepted: 0, rejected: 0 },
    craft: { accepted: 0, rejected: 0 },
    office: { accepted: 0, rejected: 0 },
    building: { accepted: 0, rejected: 0 },
    historic: { accepted: 0, rejected: 0 },
    natural: { accepted: 0, rejected: 0 },
    sport: { accepted: 0, rejected: 0 },
    man_made: { accepted: 0, rejected: 0 },
    government_civic: { accepted: 0, rejected: 0 },
    industrial_warehouse: { accepted: 0, rejected: 0 },
    highway_trail: { accepted: 0, rejected: 0 },
    other: { accepted: 0, rejected: 0 },
  };
}

function parseOsmIdFilter(filter: string | undefined): { osmType?: string; osmId?: number } | null {
  if (!filter?.trim()) return null;
  const trimmed = filter.trim();
  const slash = trimmed.match(/^(node|way|relation)\/(\d+)$/i);
  if (slash) return { osmType: slash[1]!.toLowerCase(), osmId: Number.parseInt(slash[2]!, 10) };
  const num = Number.parseInt(trimmed, 10);
  if (Number.isFinite(num)) return { osmId: num };
  return null;
}

function matchesOsmIdFilter(
  doc: PbfCopierPreviewDoc,
  filter: ReturnType<typeof parseOsmIdFilter>
): boolean {
  if (!filter) return true;
  if (filter.osmId != null && doc.osmId !== filter.osmId) return false;
  if (filter.osmType && doc.osmType !== filter.osmType) return false;
  return true;
}

function matchesCategoryFilter(doc: PbfCopierPreviewDoc, categoryFilter: string | undefined): boolean {
  if (!categoryFilter?.trim()) return true;
  const needle = categoryFilter.trim().toLowerCase();
  const cat = (doc.primaryCategory ?? doc.primaryActivity ?? "").toLowerCase();
  const family = inferOsmTagFamily(doc.sourceTagSample ?? {});
  return cat.includes(needle) || family.includes(needle);
}

function isClosedLoop(coords: Array<{ lat: number; lng: number }>): boolean {
  if (coords.length < 3) return false;
  const start = coords[0]!;
  const end = coords[coords.length - 1]!;
  return haversineMeters(start, end) <= 85;
}

function parseOsmIdsFromSourceKeys(sourceKeys: string[] | undefined): Array<{ osmType: string; osmId: number }> {
  const out: Array<{ osmType: string; osmId: number }> = [];
  for (const key of sourceKeys ?? []) {
    const m = key.match(/^(node|way|relation)\/(\d+)$/i);
    if (m) out.push({ osmType: m[1]!.toLowerCase(), osmId: Number.parseInt(m[2]!, 10) });
  }
  return out;
}

function buildRouteIndex(docs: PbfCopierPreviewDoc[]): Map<string, PbfCopierPreviewDoc[]> {
  const byName = new Map<string, PbfCopierPreviewDoc[]>();
  for (const doc of docs) {
    if (doc.kind !== "unexplored_route") continue;
    const key = normalizePreviewDisplayName(doc.displayName);
    if (!key) continue;
    const bucket = byName.get(key) ?? [];
    bucket.push(doc);
    byName.set(key, bucket);
  }
  return byName;
}

function findTouchingWays(
  doc: PbfCopierPreviewDoc,
  allRoutes: PbfCopierPreviewDoc[]
): Array<{ osmType: string; osmId: number }> {
  const coords = routeLinePoints(doc);
  if (coords.length < 2) return [];
  const start = coords[0]!;
  const end = coords[coords.length - 1]!;
  const touches: Array<{ osmType: string; osmId: number }> = [];

  for (const other of allRoutes) {
    if (other.id === doc.id) continue;
    if (other.kind !== "unexplored_route") continue;
    const otherCoords = routeLinePoints(other);
    if (otherCoords.length < 2) continue;
    const oStart = otherCoords[0]!;
    const oEnd = otherCoords[otherCoords.length - 1]!;

    const endpoints = [start, end];
    const otherEndpoints = [oStart, oEnd];
    let touch = false;
    for (const a of endpoints) {
      for (const b of otherEndpoints) {
        if (haversineMeters(a, b) <= ENDPOINT_TOUCH_TOLERANCE_METERS) {
          touch = true;
          break;
        }
      }
      if (touch) break;
    }
    if (touch) {
      touches.push({ osmType: other.osmType, osmId: other.osmId });
    }
  }
  return touches;
}

function buildFragmentationHints(
  doc: PbfCopierPreviewDoc,
  allPostPipelineRoutes: PbfCopierPreviewDoc[],
  routesByName: Map<string, PbfCopierPreviewDoc[]>
): PbfAuditFragmentationHints {
  const sourceParts = parseOsmIdsFromSourceKeys(doc.sourceKeys);
  const merged = doc.warnings?.includes("v2_hiking_trail_merged") ?? false;
  const segmentCount = doc.routeLineSegments?.length ?? (merged ? sourceParts.length : 1);
  const nameKey = normalizePreviewDisplayName(doc.displayName);
  const sameName = nameKey
    ? (routesByName.get(nameKey) ?? [])
        .filter((r) => r.id !== doc.id)
        .map((r) => ({
          osmType: r.osmType,
          osmId: r.osmId,
          name: r.displayName,
        }))
    : [];

  const touches = findTouchingWays(doc, allPostPipelineRoutes);
  const relationParentIds: number[] = [];
  if (doc.osmType === "relation") relationParentIds.push(doc.osmId);

  const mayBeFragmented =
    !merged &&
    (segmentCount > 1 ||
      sameName.length > 0 ||
      (touches.length > 0 && isHikingTrailPreviewDoc(doc) && Boolean(doc.displayName?.trim())));

  return {
    mayBeFragmented,
    splitByIntersectionGrouping: Boolean(
      doc.warnings?.includes("v2_line_no_marker") && touches.length > 0 && sameName.length > 0
    ),
    mergedFromSegments: merged,
    segmentSourceCount: Math.max(sourceParts.length, segmentCount),
    touchesOtherWays: touches,
    sameNameNearbyWays: sameName,
    relationParentIds,
  };
}

function buildGeometryStats(doc: PbfCopierPreviewDoc): PbfAuditGeometryStats {
  const coords = routeLinePoints(doc);
  const pointCount = coords.length;
  const distanceMeters = doc.distanceMeters ?? (pointCount >= 2 ? distanceMetersForCoords(coords) : 0);
  const segmentCount = doc.routeLineSegments?.filter((s) => s.length >= 2).length ?? (pointCount >= 2 ? 1 : 0);
  return {
    pointCount,
    distanceMeters: Math.round(distanceMeters),
    segmentCount,
    isClosedLoop: isClosedLoop(coords),
  };
}

function buildWritePreview(
  doc: PbfCopierPreviewDoc,
  runId: string,
  includeWritePreview: boolean
): PbfAuditWritePreview | undefined {
  if (!includeWritePreview) return undefined;
  const materialized = materializeV2PreviewDocWritePayload(doc, {
    runId,
    writeTarget: "none",
    stateCode: inferStateCodeFromFilePath(doc.pbfFilePath ?? ""),
  });
  const payload = materialized.writePayload as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== "object") return undefined;
  const collection =
    doc.kind === "unexplored_route" ? ("unexploredRoutes" as const) : ("unexploredSpots" as const);
  const docId = String(payload.id ?? doc.id);
  return { collection, docId, data: payload };
}

function trimTags(tags: Record<string, string>, includeRawTags: boolean): Record<string, string> {
  if (includeRawTags) return { ...tags };
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(tags)) {
    out[k] = v;
    n += 1;
    if (n >= 24) break;
  }
  return out;
}

function trimGeometry(
  doc: PbfCopierPreviewDoc,
  includeGeometry: boolean
): Array<{ lat: number; lng: number }> | undefined {
  if (!includeGeometry) return undefined;
  const coords = routeLinePoints(doc);
  if (coords.length >= 2) {
    if (coords.length <= 40) return coords;
    const step = Math.ceil(coords.length / 40);
    const sampled: Array<{ lat: number; lng: number }> = [];
    for (let i = 0; i < coords.length; i += step) sampled.push(coords[i]!);
    const last = coords[coords.length - 1]!;
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
    return sampled;
  }
  if (Number.isFinite(doc.lat) && Number.isFinite(doc.lng)) {
    return [{ lat: doc.lat, lng: doc.lng }];
  }
  return undefined;
}

function bumpTagFamily(
  counts: Record<PbfAuditTagFamily, { accepted: number; rejected: number }>,
  family: PbfAuditTagFamily,
  accepted: boolean
): void {
  const bucket = counts[family] ?? counts.other;
  if (accepted) bucket.accepted += 1;
  else bucket.rejected += 1;
}

function capArray<T>(items: T[], limit: number | undefined): T[] {
  if (limit == null || limit <= 0) return items;
  return items.slice(0, limit);
}

/** Run bounded PBF V2 audit — never writes Firestore. */
export async function runPbfCopierV2Audit(
  options: PbfCopierV2AuditOptions
): Promise<PbfCopierV2AuditResult> {
  const dryRun = options.dryRun !== false;
  const includeRejected = options.includeRejected !== false;
  const includeRawTags = options.includeRawTags !== false;
  const includeGeometry = options.includeGeometry === true;
  const includeWritePreview = options.includeWritePreview !== false;
  const pipelineMode: PbfCopierV2ViewportPreviewMode = options.sampleMode ?? "raw_osm";
  const osmFilter = parseOsmIdFilter(options.osmIdFilter);
  const runId = `pbf-v2-audit-${Date.now()}`;

  const validation = await validatePbfFile(options.pbfPath);
  if (!validation.exists || !validation.readable) {
    throw new Error(`pbf_not_readable: ${validation.resolvedPath}`);
  }

  const scan = await scanPbfViewportPreview({
    pbfPath: validation.resolvedPath,
    bbox: options.bbox,
    mode: pipelineMode,
    maxRawObjectsScanned: options.maxRawObjectsScanned,
  });

  const qualitySettings: PbfQualityFilterSettings = {
    ...DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
    ...(options.qualitySettings ?? {}),
    hideUnnamedPaths: false,
  };
  const filtered = runPbfCopierV2Pipeline({
    rawItems: scan.items,
    qualitySettings,
  });

  const visibleById = new Map<string, PbfQualityFilteredPreviewDoc>();
  const hiddenById = new Map<string, PbfQualityFilteredPreviewDoc>();
  for (const item of filtered.items) {
    if (item.filteredOut) hiddenById.set(item.id, item);
    else visibleById.set(item.id, item);
  }

  const routesByName = buildRouteIndex(filtered.items.filter((d) => d.kind === "unexplored_route"));
  const allRoutes = filtered.items.filter((d) => d.kind === "unexplored_route");

  const acceptedSpots: PbfAuditSpotRecord[] = [];
  const rejectedSpots: PbfAuditRejectedSpotRecord[] = [];
  const acceptedRoutes: PbfAuditRouteRecord[] = [];
  const rejectedRoutes: PbfAuditRejectedRouteRecord[] = [];
  let totalAcceptedSpots = 0;
  let totalRejectedSpots = 0;
  let totalAcceptedRoutes = 0;
  let totalRejectedRoutes = 0;
  let totalCandidateSpots = 0;
  let totalCandidateRoutes = 0;
  const potentialFalseNegatives: PbfAuditBorderlineRecord[] = [];
  const potentialFalsePositives: PbfAuditBorderlineRecord[] = [];
  const byTagFamily = emptyTagFamilyCounts();

  const residentialFiltered = scan.stats.residentialHomesFiltered ?? 0;

  for (const doc of filtered.items) {
    if (!matchesOsmIdFilter(doc, osmFilter)) continue;
    if (!matchesCategoryFilter(doc, options.categoryFilter)) continue;

    const tags = doc.sourceTagSample ?? {};
    const tagFamily = inferOsmTagFamily(tags);
    const isRoute = doc.kind === "unexplored_route";
    const isVisible = !doc.filteredOut;

    if (isRoute) {
      totalCandidateRoutes += 1;
      if (isVisible) {
        totalAcceptedRoutes += 1;
        bumpTagFamily(byTagFamily, tagFamily, true);
        if (acceptedRoutes.length < detailCap) {
        acceptedRoutes.push({
          osmType: doc.osmType as "way" | "relation",
          osmId: doc.osmId,
          name: doc.displayName ?? null,
          routeType: doc.primaryCategory ?? doc.primaryActivity ?? null,
          tagFamily,
          sourceTags: trimTags(tags, includeRawTags),
          geometryStats: buildGeometryStats(doc),
          fragmentationHints: buildFragmentationHints(doc, allRoutes, routesByName),
          acceptReasons: inferAcceptReasonCodes(doc),
          filteredBy: doc.filteredBy,
          filterReason: doc.filterReason,
          writePreview: buildWritePreview(doc, runId, includeWritePreview),
          geometry: trimGeometry(doc, includeGeometry),
        });
        }
        if (looksPotentiallyBoring(tags) && potentialFalsePositives.length < 25) {
          potentialFalsePositives.push({
            osmType: doc.osmType,
            osmId: doc.osmId,
            name: doc.displayName ?? null,
            sourceTags: trimTags(tags, includeRawTags),
            whyCursorShouldReview: "Looks like it may be boring/irrelevant but was accepted.",
          });
        }
      } else if (includeRejected) {
        totalRejectedRoutes += 1;
        bumpTagFamily(byTagFamily, tagFamily, false);
        if (rejectedRoutes.length < detailCap) {
        rejectedRoutes.push({
          osmType: doc.osmType as "way" | "relation",
          osmId: doc.osmId,
          name: doc.displayName ?? null,
          tagFamily,
          sourceTags: trimTags(tags, includeRawTags),
          rejectReasons: mapQualityFilterToRejectCodes(doc.filteredBy, doc.filterReason),
          rejectStage: "quality_filter",
          fragmentationHints: buildFragmentationHints(doc, allRoutes, routesByName),
          filteredBy: doc.filteredBy,
          filterReason: doc.filterReason,
        });
        }
        if (looksPotentiallyInteresting(tags) && potentialFalseNegatives.length < 25) {
          potentialFalseNegatives.push({
            osmType: doc.osmType,
            osmId: doc.osmId,
            name: doc.displayName ?? null,
            sourceTags: trimTags(tags, includeRawTags),
            whyCursorShouldReview:
              "Looks like a potentially good Locava trail/route but was rejected by quality filter.",
          });
        }
      }
      continue;
    }

    totalCandidateSpots += 1;
    if (isVisible) {
      totalAcceptedSpots += 1;
      bumpTagFamily(byTagFamily, tagFamily, true);
      if (acceptedSpots.length < detailCap) {
      acceptedSpots.push({
        osmType: doc.osmType,
        osmId: doc.osmId,
        name: doc.displayName ?? null,
        lat: doc.lat,
        long: doc.lng,
        category: doc.primaryCategory ?? doc.primaryActivity ?? null,
        tagFamily,
        sourceTags: trimTags(tags, includeRawTags),
        acceptReasons: inferAcceptReasonCodes(doc),
        qualityScore: null,
        filteredBy: doc.filteredBy,
        filterReason: doc.filterReason,
        writePreview: buildWritePreview(doc, runId, includeWritePreview),
        geometry: trimGeometry(doc, includeGeometry),
      });
      }
      if (looksPotentiallyBoring(tags) && potentialFalsePositives.length < 25) {
        potentialFalsePositives.push({
          osmType: doc.osmType,
          osmId: doc.osmId,
          name: doc.displayName ?? null,
          sourceTags: trimTags(tags, includeRawTags),
          whyCursorShouldReview: "Looks like it may be boring/irrelevant but was accepted.",
        });
      }
    } else if (includeRejected) {
      totalRejectedSpots += 1;
      bumpTagFamily(byTagFamily, tagFamily, false);
      if (rejectedSpots.length < detailCap) {
      rejectedSpots.push({
        osmType: doc.osmType,
        osmId: doc.osmId,
        name: doc.displayName ?? null,
        lat: doc.lat,
        long: doc.lng,
        tagFamily,
        sourceTags: trimTags(tags, includeRawTags),
        rejectReasons: mapQualityFilterToRejectCodes(doc.filteredBy, doc.filterReason),
        wouldHaveCategory: doc.primaryCategory ?? doc.primaryActivity ?? null,
        filteredBy: doc.filteredBy,
        filterReason: doc.filterReason,
        rejectStage: "quality_filter",
      });
      }
      if (looksPotentiallyInteresting(tags) && potentialFalseNegatives.length < 25) {
        potentialFalseNegatives.push({
          osmType: doc.osmType,
          osmId: doc.osmId,
          name: doc.displayName ?? null,
          sourceTags: trimTags(tags, includeRawTags),
          whyCursorShouldReview:
            "Looks like a potentially good Locava spot/business/trail but was rejected by quality filter.",
        });
      }
    }
  }

  if (includeRejected && residentialFiltered > 0) {
    bumpTagFamily(byTagFamily, "building", false);
    rejectedSpots.push({
      osmType: "way",
      osmId: 0,
      name: null,
      lat: 0,
      long: 0,
      tagFamily: "building",
      sourceTags: {},
      rejectReasons: mapResidentialRejectCodes(),
      wouldHaveCategory: null,
      rejectStage: "residential_filter",
      filterReason: `${residentialFiltered} residential-only homes removed in raw display post-process`,
    });
  }

  const inventoryBbox = {
    minLat: options.bbox.southLat,
    minLng: options.bbox.westLng,
    maxLat: options.bbox.northLat,
    maxLng: options.bbox.eastLng,
  };
  const tileKeys = tilesForViewport(inventoryBbox, 14);

  const perKindLimit = options.limit;
  const detailCap = perKindLimit ?? 200;
  const limitations: string[] = [
    "Audit uses the same raw_osm scan + runPbfCopierV2Pipeline path as production full-run tiles.",
    "Classifier rejection detail is only available when sampleMode=locava_filtered.",
    "Residential home drops are counted in summary but individual docs are not enumerated.",
    "Firestore writes are disabled; writePreview uses writeTarget=none.",
    "Trail merge/split diagnostics are inferred from sourceKeys, warnings, and endpoint proximity — not from internal graph state.",
  ];
  if (scan.stats.rawObjectsScanned >= (options.maxRawObjectsScanned ?? Infinity)) {
    limitations.push("PBF scan stopped early due to maxRawObjectsScanned cap.");
  }

  return {
    ok: true,
    mode: "audit",
    dryRun,
    pipelineMode,
    firestoreWrites: false,
    pbfPath: options.pbfPath,
    resolvedPbfPath: validation.resolvedPath,
    bbox: {
      west: options.bbox.westLng,
      south: options.bbox.southLat,
      east: options.bbox.eastLng,
      north: options.bbox.northLat,
    },
    summary: {
      rawElementsScanned: scan.stats.rawObjectsScanned,
      rawNodes: scan.stats.nodesScanned,
      rawWays: scan.stats.waysScanned,
      rawRelations: scan.stats.relationsScanned,
      residentialHomesFiltered: residentialFiltered,
      hikingTrailGroupsMerged: scan.stats.hikingTrailGroupsMerged ?? 0,
      hikingTrailSegmentsCollapsed: scan.stats.hikingTrailSegmentsCollapsed ?? 0,
      candidateSpots: totalCandidateSpots,
      acceptedSpots: totalAcceptedSpots,
      rejectedSpots: totalRejectedSpots,
      candidateRoutes: totalCandidateRoutes,
      acceptedRoutes: totalAcceptedRoutes,
      rejectedRoutes: totalRejectedRoutes,
      tilesTouched: tileKeys.length,
      qualityFilterHidden: filtered.summary.hiddenItems,
      qualityFilterVisible: filtered.summary.visibleItems,
      byTagFamily,
      elapsedMs: scan.stats.elapsedMs,
    },
    acceptedSpots,
    rejectedSpots,
    acceptedRoutes,
    rejectedRoutes,
    potentialFalseNegatives: capArray(potentialFalseNegatives, 25),
    potentialFalsePositives: capArray(potentialFalsePositives, 25),
    limitations,
  };
}

export { mapClassifierRejectionToCodes };
