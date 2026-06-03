import { createHash } from "node:crypto";

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

export function normalizeForId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildUnexploredSpotId(input: {
  sourceFamily: string;
  sourceKey: string;
  displayName: string;
  lat: number;
  lng: number;
  category: string;
  stateCode: string;
}): string {
  const material = [
    input.sourceFamily,
    input.sourceKey,
    normalizeForId(input.displayName),
    input.lat.toFixed(5),
    input.lng.toFixed(5),
    normalizeForId(input.category),
    input.stateCode.toUpperCase(),
  ].join("|");
  return `unx_spot_${shortHash(material)}`;
}

export function buildUnexploredRouteId(input: {
  sourceFamily: string;
  sourceKey: string;
  displayName: string;
  geometryHash: string;
  stateCode: string;
}): string {
  const material = [
    input.sourceFamily,
    input.sourceKey,
    normalizeForId(input.displayName),
    input.geometryHash,
    input.stateCode.toUpperCase(),
  ].join("|");
  return `unx_route_${shortHash(material)}`;
}

export function buildGeometryHash(input: {
  encodedPolyline?: string;
  coordinates?: Array<{ lat: number; lng: number }>;
  bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
}): string {
  if (input.encodedPolyline) {
    return shortHash(`poly:${input.encodedPolyline.slice(0, 500)}`);
  }
  if (input.coordinates && input.coordinates.length > 0) {
    const first = input.coordinates[0]!;
    const last = input.coordinates[input.coordinates.length - 1]!;
    return shortHash(
      `coords:${input.coordinates.length}:${first.lat.toFixed(5)},${first.lng.toFixed(5)}:${last.lat.toFixed(5)},${last.lng.toFixed(5)}`
    );
  }
  if (input.bbox) {
    return shortHash(
      `bbox:${input.bbox.minLat.toFixed(5)}:${input.bbox.minLng.toFixed(5)}:${input.bbox.maxLat.toFixed(5)}:${input.bbox.maxLng.toFixed(5)}`
    );
  }
  return shortHash("empty_geometry");
}

export function buildContentHash(doc: Record<string, unknown>): string {
  return shortHash(JSON.stringify(doc));
}

export function buildOsmNationalRunId(): string {
  const ts = Date.now().toString(36);
  const rand = createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 8);
  return `osm_nat_${ts}_${rand}`;
}

export function buildOsmNationalEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Fields owned by the national importer — safe to overwrite on merge. */
export const IMPORTER_OWNED_SPOT_FIELDS = [
  "origin",
  "sourceFamily",
  "sourceIds",
  "sourceKeys",
  "sourceAttribution",
  "sourceDatasets",
  "displayName",
  "subtitle",
  "rawName",
  "titleQuality",
  "primaryActivity",
  "activities",
  "activityWeights",
  "searchableAliases",
  "searchText",
  "searchBoostTerms",
  "category",
  "categories",
  "placeKind",
  "parentPlaceId",
  "parentPlaceName",
  "childFeatureTypes",
  "lat",
  "lng",
  "displayCenter",
  "areaCenter",
  "bbox",
  "geohash",
  "mapReadiness",
  "publicMapEligible",
  "undiscovered",
  "needsCapture",
  "hasUserMedia",
  "mediaStatus",
  "parking",
  "trailhead",
  "accessStatus",
  "accessWarnings",
  "seasonalWarnings",
  "confidence",
  "locavaScore",
  "displayPriority",
  "showAtZoom",
  "sourceTags",
  "rawProperties",
  "classification",
  "import",
  "audit",
  "stateCode",
] as const;

export const IMPORTER_OWNED_ROUTE_FIELDS = [
  ...IMPORTER_OWNED_SPOT_FIELDS,
  "routeKind",
  "routeActivity",
  "legalDisplayLabel",
  "offroadCategory",
  "offroadConfidence",
  "center",
  "distanceMeters",
  "distanceMiles",
  "distanceLabel",
  "geometryType",
  "encodedPolyline",
  "simplifiedPolylines",
  "coordinatesPreview",
  "geometryStorage",
  "selectedTrailhead",
  "selectedParking",
  "parkingCandidatesSummary",
  "trailheadCandidatesSummary",
] as const;
