/**
 * Build unexploredSpots / unexploredRoutes write payloads from V2 preview docs
 * that were created without the classifier (raw OSM viewport scan).
 */
import type { UnexploredRoute, UnexploredSpot } from "../../../../contracts/entities/osm-national-entities.contract.js";
import { OSM_NATIONAL_PIPELINE_VERSION } from "../../../../contracts/entities/osm-national-entities.contract.js";
import { attachSpotMapTileIndex } from "../../../../lib/map/unexploredSpotTileIndex.js";
import { attachRouteMapTileIndex } from "../../../../lib/map/unexploredRouteTileIndex.js";
import { LOCAVA_CLASSIFIER_ALGORITHM_VERSION } from "../../../../lib/inventory/inventoryLocavaTypes.js";
import {
  distanceMetersForCoords,
  distanceMilesFromMeters,
  distanceLabel,
  type TrailPoint,
} from "../../../../lib/inventory/trails/inventoryTrailGraph.js";
import type { OsmNationalWriteTarget } from "../osmNationalWriteGuard.js";
import {
  buildContentHash,
  buildGeometryHash,
  buildUnexploredRouteId,
  buildUnexploredSpotId,
} from "../osmNationalDeterministicIds.js";
import { inferStateCodeFromFilePath } from "./pbfCopierPathHelpers.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { routeLinePoints, isClass4OrOffroadHighwayRoute } from "./pbfCopierV2RouteEnrichment.js";

function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  out += String.fromCharCode(v + 63);
  return out;
}

function encodePolyline(coords: TrailPoint[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = "";
  for (const c of coords) {
    const lat = Math.round(c.lat * 1e5);
    const lng = Math.round(c.lng * 1e5);
    result += encodeSigned(lat - lastLat) + encodeSigned(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return result;
}

function osmSourceKey(doc: PbfCopierPreviewDoc): string {
  return doc.sourceKeys?.[0] ?? `${doc.osmType}/${doc.osmId}`;
}

function normalizedCategory(doc: PbfCopierPreviewDoc): string {
  const cat = (doc.primaryCategory || doc.primaryActivity || "osm").trim();
  if (cat === "osm" && doc.kind === "unexplored_route") return "hiking";
  return cat || "osm";
}

function normalizedActivities(doc: PbfCopierPreviewDoc): string[] {
  const acts = [...(doc.activities ?? [])];
  if (doc.primaryActivity && !acts.includes(doc.primaryActivity)) {
    acts.unshift(doc.primaryActivity);
  }
  const cat = normalizedCategory(doc);
  if (acts.length === 0 && cat) acts.push(cat);
  if (acts.length === 0) acts.push("hiking");
  return [...new Set(acts.filter(Boolean))];
}

function routeKindForDoc(doc: PbfCopierPreviewDoc): string {
  if (isClass4OrOffroadHighwayRoute(doc)) return "offroad_class4_road";
  const cat = normalizedCategory(doc);
  if (cat.includes("offroad") || cat.includes("class4")) return "offroad_class4_road";
  if (cat.includes("bike") || cat.includes("bicycle")) return "biking_route";
  return "hiking_trail";
}

export type BuildV2BlankDocInput = {
  runId: string;
  writeTarget: OsmNationalWriteTarget;
  stateCode?: string;
};

export function buildBlankSpotFromV2Preview(
  doc: PbfCopierPreviewDoc,
  input: BuildV2BlankDocInput
): UnexploredSpot | null {
  if (doc.kind !== "unexplored_spot") return null;
  if (!Number.isFinite(doc.lat) || !Number.isFinite(doc.lng)) return null;

  const displayName = doc.displayName?.trim();
  if (!displayName) return null;

  const stateCode = input.stateCode ?? inferStateCodeFromFilePath(doc.pbfFilePath) ?? "VT";
  const sourceKey = osmSourceKey(doc);
  const category = normalizedCategory(doc);
  const activities = normalizedActivities(doc);
  const now = new Date().toISOString();

  const id = buildUnexploredSpotId({
    sourceFamily: "openstreetmap",
    sourceKey,
    displayName,
    lat: doc.lat,
    lng: doc.lng,
    category,
    stateCode,
  });

  const spot: UnexploredSpot = {
    id,
    kind: "unexplored_spot",
    itemType: "undiscovered_spot",
    sourceCollection: "unexploredSpots",
    origin: "generated_osm",
    sourceFamily: "openstreetmap",
    sourceIds: doc.sourceIds?.length ? doc.sourceIds : [String(doc.osmId)],
    sourceKeys: [sourceKey],
    sourceAttribution: { sourceDatasetName: "openstreetmap", sourceProvider: doc.sourceProvider },
    sourceDatasets: ["openstreetmap"],
    displayName,
    title: displayName,
    primaryActivity: doc.primaryActivity ?? activities[0] ?? null,
    activities,
    category,
    categories: [category],
    lat: doc.lat,
    lng: doc.lng,
    location: { lat: doc.lat, lng: doc.lng },
    displayCenter: doc.center ?? { lat: doc.lat, lng: doc.lng },
    bbox: doc.bbox,
    mapReadiness: doc.mapReadiness ?? "review",
    publicMapEligible: doc.publicMapEligible ?? false,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    mediaStatus: "none",
    accessStatus: "unknown",
    confidence: "medium",
    locavaScore: 0,
    displayPriority: "normal",
    showAtZoom: 10,
    sourceTags: doc.sourceTagSample ?? {},
    source: {
      provider: "openstreetmap",
      osmType: doc.osmType,
      osmId: doc.osmId,
      tags: doc.sourceTagSample ?? {},
    },
    status: {
      undiscovered: true,
      needsCapture: true,
      hasUserMedia: false,
      publicMapEligible: doc.publicMapEligible ?? false,
      mapReadiness: doc.mapReadiness ?? "review",
    },
    social: { saveCount: 0, shareCount: 0, viewCount: 0 },
    rawProperties: { tags: doc.sourceTagSample ?? {} },
    classification: {
      algorithmVersion: LOCAVA_CLASSIFIER_ALGORITHM_VERSION,
      reason: "pbf_copier_v2_blank_write",
      tagSignals: [],
      negativeSignals: [],
      warnings: doc.warnings ?? [],
    },
    import: {
      runId: input.runId,
      stateCode,
      chunkId: `pbf_v2_write_${input.runId}`,
      importedAt: now,
      pipelineVersion: OSM_NATIONAL_PIPELINE_VERSION,
      writeMode: input.writeTarget !== "none",
      writeTarget: input.writeTarget,
    },
    audit: {
      createdBy: "pbf_copier_v2",
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      contentHash: "",
      geometryHash: buildGeometryHash({ bbox: doc.bbox }),
    },
    stateCode,
  };

  spot.audit.contentHash = buildContentHash({
    id: spot.id,
    displayName: spot.displayName,
    lat: spot.lat,
    lng: spot.lng,
    category: spot.category,
  });

  return attachSpotMapTileIndex(spot);
}

export function buildBlankRouteFromV2Preview(
  doc: PbfCopierPreviewDoc,
  input: BuildV2BlankDocInput
): UnexploredRoute | null {
  if (doc.kind !== "unexplored_route") return null;

  const coords = routeLinePoints(doc);
  const center =
    doc.routeCenterCoordinate ??
    doc.routeMarkerCoordinate ??
    doc.center ??
    (coords[0] ? { lat: coords[0].lat, lng: coords[0].lng } : { lat: doc.lat, lng: doc.lng });

  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null;

  const displayName = doc.displayName?.trim();
  if (!displayName) return null;

  const stateCode = input.stateCode ?? inferStateCodeFromFilePath(doc.pbfFilePath) ?? "VT";
  const sourceKey = osmSourceKey(doc);
  const category = normalizedCategory(doc);
  const activities = normalizedActivities(doc);
  const now = new Date().toISOString();
  const encodedPolyline =
    doc.encodedPolyline ?? (coords.length >= 2 ? encodePolyline(coords) : undefined);
  const geometryHash = buildGeometryHash({
    encodedPolyline,
    coordinates: coords,
    bbox: doc.bbox,
  });
  const pointCount = coords.length;
  const distanceMeters = doc.distanceMeters ?? (coords.length >= 2 ? distanceMetersForCoords(coords) : 0);
  const distanceMiles = doc.distanceMiles ?? distanceMilesFromMeters(distanceMeters);
  const routeKind = routeKindForDoc(doc);

  const id = buildUnexploredRouteId({
    sourceFamily: "openstreetmap",
    sourceKey,
    displayName,
    geometryHash,
    stateCode,
  });

  const route: UnexploredRoute = {
    id,
    kind: "unexplored_route",
    itemType: "undiscovered_route",
    sourceCollection: "unexploredRoutes",
    routeKind,
    routeType: routeKind.includes("offroad") ? "offroad_class4_road" : "hiking_trail",
    origin: "generated_osm",
    sourceFamily: "openstreetmap",
    sourceIds: doc.sourceIds?.length ? doc.sourceIds : [String(doc.osmId)],
    sourceKeys: doc.sourceKeys?.length ? doc.sourceKeys : [sourceKey],
    sourceAttribution: { sourceDatasetName: "openstreetmap", sourceProvider: doc.sourceProvider },
    sourceDatasets: ["openstreetmap"],
    displayName,
    title: displayName,
    primaryActivity: doc.primaryActivity ?? activities[0] ?? null,
    activities,
    category,
    categories: [category],
    center,
    location: center,
    bbox: doc.bbox ?? {
      minLat: center.lat,
      minLng: center.lng,
      maxLat: center.lat,
      maxLng: center.lng,
    },
    distanceMeters,
    distanceMiles,
    distanceLabel: doc.distanceLabel ?? distanceLabel(distanceMiles),
    routeActivity: doc.primaryActivity ?? activities[0] ?? category,
    confidence: "medium",
    locavaScore: 0,
    displayPriority: "normal",
    showAtZoom: 10,
    geometryType: "LineString",
    encodedPolyline,
    coordinatesPreview: coords.slice(0, 20),
    geometry: {
      pointCount,
      encodedPolyline,
      previewPoints: coords.slice(0, 20),
      geometryChunked: pointCount > 500,
    },
    geometryStorage: {
      mode: pointCount > 500 ? "chunked_subcollection" : "inline",
      pointCount,
      segmentCount: doc.routeLineSegments?.length ?? 1,
      geometryHash,
    },
    mapReadiness: doc.mapReadiness ?? "review",
    publicMapEligible: doc.publicMapEligible ?? false,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    sourceTags: doc.sourceTagSample ?? {},
    source: {
      provider: "openstreetmap",
      osmType: doc.osmType,
      osmId: doc.osmId,
      tags: doc.sourceTagSample ?? {},
    },
    status: {
      undiscovered: true,
      needsCapture: true,
      hasUserMedia: false,
      publicMapEligible: doc.publicMapEligible ?? false,
      mapReadiness: doc.mapReadiness ?? "review",
    },
    social: { saveCount: 0, shareCount: 0, viewCount: 0 },
    rawProperties: { tags: doc.sourceTagSample ?? {} },
    classification: {
      algorithmVersion: LOCAVA_CLASSIFIER_ALGORITHM_VERSION,
      reason: "pbf_copier_v2_blank_write",
      tagSignals: [],
      negativeSignals: [],
      warnings: doc.warnings ?? [],
    },
    import: {
      runId: input.runId,
      stateCode,
      chunkId: `pbf_v2_write_${input.runId}`,
      importedAt: now,
      pipelineVersion: OSM_NATIONAL_PIPELINE_VERSION,
      writeMode: input.writeTarget !== "none",
      writeTarget: input.writeTarget,
    },
    audit: {
      createdBy: "pbf_copier_v2",
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      contentHash: "",
      geometryHash,
    },
    stateCode,
  };

  route.audit.contentHash = buildContentHash({
    id: route.id,
    displayName: route.displayName,
    geometryHash,
    distanceMeters: route.distanceMeters,
  });

  return attachRouteMapTileIndex(route);
}

/** Ensure preview doc has a valid writePayload, building blank docs when missing. */
export function materializeV2PreviewDocWritePayload(
  doc: PbfCopierPreviewDoc,
  input: BuildV2BlankDocInput
): PbfCopierPreviewDoc {
  if (doc.writePayload && typeof doc.writePayload === "object") {
    return doc;
  }
  const blankInput = { ...input, stateCode: input.stateCode ?? inferStateCodeFromFilePath(doc.pbfFilePath) };
  const payload =
    doc.kind === "unexplored_route"
      ? buildBlankRouteFromV2Preview(doc, blankInput)
      : buildBlankSpotFromV2Preview(doc, blankInput);
  if (!payload) return doc;
  return {
    ...doc,
    writePayload: payload as unknown as Record<string, unknown>,
    sourceKeys: doc.sourceKeys?.length ? doc.sourceKeys : [osmSourceKey(doc)],
    origin: "generated_osm",
  };
}
