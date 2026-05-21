import type { InventoryBbox } from "../../contracts/entities/inventory-entities.contract.js";
import {
  assertLikelyNotSwapped,
  bboxOfCoordinates,
  centerOfCoordinates,
  isLatLngValid,
  parseGeoJsonLineString,
  parseGeoJsonPoint,
  parseGeoJsonPolygonCenter,
  parseOsmNodeLatLng,
  parseOsmWayGeometry,
  roundInventoryLatLng,
  type CoordinateWarning,
  type LatLng,
} from "./inventoryCoordinates.js";
import { classifyInventoryOsmObject } from "./inventoryOsmClassifier.js";
import type { InventoryRawObject } from "./sources/inventorySource.types.js";

export type InventoryIngestRejected = {
  sourceId: string;
  name?: string;
  reason: string;
  tags?: Record<string, unknown>;
  lat?: number;
  lng?: number;
};

export type InventoryIngestResult = {
  objects: InventoryRawObject[];
  rejected: InventoryIngestRejected[];
  coordinateWarnings: CoordinateWarning[];
};

type GeoJsonFeature = {
  type: "Feature";
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
  id?: string | number;
};

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number | string;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon?: number; lng?: number }>;
  members?: Array<{ type: string; ref: number | string; role?: string }>;
};

function featureTags(feature: GeoJsonFeature): Record<string, unknown> {
  return { ...(feature.properties ?? {}) };
}

function featureName(tags: Record<string, unknown>): string | undefined {
  const name = tags.name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

function featureSourceId(feature: GeoJsonFeature, index: number): string {
  const props = feature.properties ?? {};
  return String(feature.id ?? props.id ?? props["@id"] ?? `geojson-${index}`);
}

function geometryKind(geometryType?: string): "point" | "line" | "polygon" | "relation" | undefined {
  if (!geometryType) return undefined;
  if (geometryType === "Point") return "point";
  if (geometryType === "LineString" || geometryType === "MultiLineString") return "line";
  if (geometryType === "Polygon" || geometryType === "MultiPolygon") return "polygon";
  return undefined;
}

function isClosedLine(coords: LatLng[]): boolean {
  if (coords.length < 4) return false;
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  return first.lat === last.lat && first.lng === last.lng;
}

function buildAttribution(sourceId: string, tags: Record<string, unknown>) {
  return {
    source: "osm",
    sourceId,
    license: typeof tags.license === "string" ? tags.license : "ODbL",
    url: typeof tags.url === "string" ? tags.url : undefined,
  };
}

function pushCoordinateWarnings(
  warnings: CoordinateWarning[],
  point: LatLng,
  context: string
): LatLng {
  const warning = assertLikelyNotSwapped(point, context);
  if (warning) warnings.push(warning);
  return point;
}

export function ingestGeoJsonFeature(feature: GeoJsonFeature, index: number): InventoryIngestResult {
  const out: InventoryRawObject[] = [];
  const rejected: InventoryIngestRejected[] = [];
  const coordinateWarnings: CoordinateWarning[] = [];
  const tags = featureTags(feature);
  const sourceId = featureSourceId(feature, index);
  const name = featureName(tags);
  const geometry = feature.geometry;
  const kind = geometryKind(geometry?.type);

  if (!geometry || !kind) {
    rejected.push({ sourceId, name, reason: "missing_geometry", tags });
    return { objects: out, rejected, coordinateWarnings };
  }

  const classification = classifyInventoryOsmObject({
    tags,
    geometryKind: kind,
    closed: kind === "line" ? isClosedLine(parseGeoJsonLineString(feature)) : kind === "polygon",
    hasName: Boolean(name),
  });

  if (classification.kind === "reject") {
    rejected.push({ sourceId, name, reason: classification.reason ?? "rejected", tags });
    return { objects: out, rejected, coordinateWarnings };
  }

  if (classification.kind === "spot") {
    let point: LatLng | null = null;
    let sourceType: "node" | "way" | "relation" = "node";
    let areaBbox: InventoryBbox | undefined;

    if (kind === "point") {
      point = parseGeoJsonPoint(feature);
      sourceType = "node";
    } else if (kind === "polygon") {
      point = parseGeoJsonPolygonCenter(feature);
      sourceType = "way";
      const ring = parseGeoJsonLineString({ geometry: { type: "Polygon", coordinates: geometry.coordinates } });
      areaBbox = bboxOfCoordinates(ring) ?? undefined;
    } else {
      const line = parseGeoJsonLineString(feature);
      point = centerOfCoordinates(line);
      sourceType = "way";
      areaBbox = bboxOfCoordinates(line) ?? undefined;
    }

    if (!point || !isLatLngValid(point)) {
      rejected.push({ sourceId, name, reason: "missing_geometry", tags });
      return { objects: out, rejected, coordinateWarnings };
    }

    point = pushCoordinateWarnings(coordinateWarnings, roundInventoryLatLng(point), sourceId);
    out.push({
      kind: "spot",
      source: "osm",
      sourceType,
      sourceId,
      name,
      lat: point.lat,
      lng: point.lng,
      bbox: areaBbox,
      tags,
      attribution: buildAttribution(sourceId, tags),
    });
    return { objects: out, rejected, coordinateWarnings };
  }

  const coordinates = parseGeoJsonLineString(feature).map((c) => roundInventoryLatLng(c));
  if (coordinates.length < 2) {
    rejected.push({ sourceId, name, reason: "missing_route_geometry", tags });
    return { objects: out, rejected, coordinateWarnings };
  }

  for (const c of coordinates) {
    pushCoordinateWarnings(coordinateWarnings, c, sourceId);
  }

  out.push({
    kind: "route",
    source: "osm",
    sourceType: "way",
    sourceId,
    name,
    coordinates,
    tags,
    attribution: buildAttribution(sourceId, tags),
  });
  return { objects: out, rejected, coordinateWarnings };
}

export function ingestOverpassElement(element: OverpassElement): InventoryIngestResult {
  const out: InventoryRawObject[] = [];
  const rejected: InventoryIngestRejected[] = [];
  const coordinateWarnings: CoordinateWarning[] = [];
  const tags: Record<string, unknown> = { ...(element.tags ?? {}) };
  const sourceId = String(element.id);
  const name = featureName(tags);

  if (element.type === "node") {
    const pointRaw = parseOsmNodeLatLng(element);
    if (!pointRaw || !isLatLngValid(pointRaw)) {
      rejected.push({ sourceId, name, reason: "missing_geometry", tags });
      return { objects: out, rejected, coordinateWarnings };
    }
    const classification = classifyInventoryOsmObject({
      tags,
      geometryKind: "point",
      hasName: Boolean(name),
    });
    if (classification.kind !== "spot") {
      rejected.push({ sourceId, name, reason: classification.reason ?? "node_not_spot", tags });
      return { objects: out, rejected, coordinateWarnings };
    }
    const point = pushCoordinateWarnings(coordinateWarnings, roundInventoryLatLng(pointRaw), sourceId);
    out.push({
      kind: "spot",
      source: "osm",
      sourceType: "node",
      sourceId,
      name,
      lat: point.lat,
      lng: point.lng,
      tags,
      attribution: buildAttribution(sourceId, tags),
    });
    return { objects: out, rejected, coordinateWarnings };
  }

  if (element.type === "way") {
    const coords = parseOsmWayGeometry(element).map((c) => roundInventoryLatLng(c));
    if (coords.length === 0) {
      rejected.push({ sourceId, name, reason: "missing_geometry", tags });
      return { objects: out, rejected, coordinateWarnings };
    }
    const closed = isClosedLine(coords);
    const classification = classifyInventoryOsmObject({
      tags,
      geometryKind: closed ? "polygon" : "line",
      closed,
      hasName: Boolean(name),
    });

    if (classification.kind === "reject") {
      rejected.push({ sourceId, name, reason: classification.reason ?? "rejected", tags });
      return { objects: out, rejected, coordinateWarnings };
    }

    if (classification.kind === "spot") {
      const center = centerOfCoordinates(coords);
      if (!center || !isLatLngValid(center)) {
        rejected.push({ sourceId, name, reason: "missing_geometry", tags });
        return { objects: out, rejected, coordinateWarnings };
      }
      const point = pushCoordinateWarnings(coordinateWarnings, roundInventoryLatLng(center), sourceId);
      out.push({
        kind: "spot",
        source: "osm",
        sourceType: "way",
        sourceId,
        name,
        lat: point.lat,
        lng: point.lng,
        bbox: bboxOfCoordinates(coords) ?? undefined,
        tags,
        attribution: buildAttribution(sourceId, tags),
      });
      return { objects: out, rejected, coordinateWarnings };
    }

    if (coords.length < 2) {
      rejected.push({ sourceId, name, reason: "missing_route_geometry", tags });
      return { objects: out, rejected, coordinateWarnings };
    }
    for (const c of coords) pushCoordinateWarnings(coordinateWarnings, c, sourceId);
    out.push({
      kind: "route",
      source: "osm",
      sourceType: "way",
      sourceId,
      name,
      coordinates: coords,
      tags,
      attribution: buildAttribution(sourceId, tags),
    });
    return { objects: out, rejected, coordinateWarnings };
  }

  const classification = classifyInventoryOsmObject({
    tags,
    geometryKind: "relation",
    hasName: Boolean(name),
  });
  if (classification.kind === "reject") {
    rejected.push({ sourceId, name, reason: classification.reason ?? "rejected", tags });
    return { objects: out, rejected, coordinateWarnings };
  }

  const memberCoords: LatLng[] = [];
  if (Array.isArray(element.geometry)) {
    for (const point of element.geometry) {
      const parsed = parseOsmNodeLatLng(point);
      if (parsed) memberCoords.push(roundInventoryLatLng(parsed));
    }
  }

  if (classification.kind === "spot") {
    const center = centerOfCoordinates(memberCoords);
    if (!center || !isLatLngValid(center)) {
      rejected.push({ sourceId, name, reason: "missing_geometry", tags });
      return { objects: out, rejected, coordinateWarnings };
    }
    const point = pushCoordinateWarnings(coordinateWarnings, roundInventoryLatLng(center), sourceId);
    out.push({
      kind: "spot",
      source: "osm",
      sourceType: "relation",
      sourceId,
      name,
      lat: point.lat,
      lng: point.lng,
      bbox: bboxOfCoordinates(memberCoords) ?? undefined,
      tags,
      attribution: buildAttribution(sourceId, tags),
    });
    return { objects: out, rejected, coordinateWarnings };
  }

  if (memberCoords.length < 2) {
    rejected.push({ sourceId, name, reason: "missing_route_geometry", tags });
    return { objects: out, rejected, coordinateWarnings };
  }
  for (const c of memberCoords) pushCoordinateWarnings(coordinateWarnings, c, sourceId);
  out.push({
    kind: "route",
    source: "osm",
    sourceType: "relation",
    sourceId,
    name,
    coordinates: memberCoords,
    tags,
    attribution: buildAttribution(sourceId, tags),
  });
  return { objects: out, rejected, coordinateWarnings };
}

export function mergeIngestResults(results: InventoryIngestResult[]): InventoryIngestResult {
  return results.reduce(
    (acc, result) => ({
      objects: acc.objects.concat(result.objects),
      rejected: acc.rejected.concat(result.rejected),
      coordinateWarnings: acc.coordinateWarnings.concat(result.coordinateWarnings),
    }),
    { objects: [], rejected: [], coordinateWarnings: [] } as InventoryIngestResult
  );
}
