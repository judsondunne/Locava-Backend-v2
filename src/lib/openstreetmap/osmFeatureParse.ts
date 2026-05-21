import type { InventoryBbox } from "../../contracts/entities/inventory-entities.contract.js";
import {
  centerOfCoordinates,
  parseGeoJsonLineString,
  parseGeoJsonPoint,
  parseGeoJsonPolygonCenter,
  parseOsmNodeLatLng,
  parseOsmWayGeometry,
  roundInventoryLatLng,
} from "../inventory/inventoryCoordinates.js";

export type OsmElementType = "node" | "way" | "relation";

export type OsmFeatureCoordSource = "node" | "way_center" | "line_center" | "polygon_center" | "relation_center";

export type OsmFeatureListItem = {
  id: string;
  osmType: OsmElementType;
  osmId: number;
  name: string;
  hasRealName: boolean;
  featureType: string;
  lat: number;
  lng: number;
  coordSource: OsmFeatureCoordSource;
  geometryKind: "point" | "line" | "polygon" | "unknown";
  coordinates: Array<{ lat: number; lng: number }>;
  closed: boolean;
  tags: Record<string, string>;
};

export type OverpassElement = {
  type: OsmElementType;
  id: number | string;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat?: number; lon?: number; lng?: number }>;
  members?: Array<{ type: string; ref: number | string; role?: string }>;
};

const FEATURE_TAG_KEYS = [
  "amenity",
  "natural",
  "leisure",
  "tourism",
  "historic",
  "waterway",
  "place",
  "man_made",
  "barrier",
  "shop",
  "craft",
  "office",
  "building",
  "landuse",
  "highway",
  "water",
  "wetland",
  "railway",
  "aeroway",
  "power",
  "emergency",
  "healthcare",
  "sport",
  "public_transport",
  "boundary",
  "route",
  "information",
  "mountain_pass",
] as const;

const SKIP_TAG_KEYS = new Set(["source", "source:date", "created_by", "attribution"]);

export function buildHartlandOverpassQuery(bbox: InventoryBbox): string {
  const { minLat, minLng, maxLat, maxLng } = bbox;
  const box = `${minLat},${minLng},${maxLat},${maxLng}`;
  const lines: string[] = [`[out:json][timeout:180];`, `(`];

  for (const key of FEATURE_TAG_KEYS) {
    lines.push(`  node["${key}"](${box});`);
    lines.push(`  way["${key}"](${box});`);
    lines.push(`  relation["${key}"](${box});`);
  }
  lines.push(`  node["name"](${box});`);
  lines.push(`  way["name"](${box});`);
  lines.push(`  relation["name"](${box});`);
  lines.push(`);`);
  lines.push(`out body geom;`);
  return lines.join("\n");
}

function hasMeaningfulTags(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  return Object.keys(tags).some((key) => !SKIP_TAG_KEYS.has(key));
}

function primaryFeatureType(tags: Record<string, string>): string {
  for (const key of FEATURE_TAG_KEYS) {
    const value = tags[key];
    if (value) return `${key}=${value}`;
  }
  if (tags.name) return "name";
  const first = Object.entries(tags).find(([key]) => !SKIP_TAG_KEYS.has(key));
  return first ? `${first[0]}=${first[1]}` : "untagged";
}

function displayName(tags: Record<string, string>): string {
  return (
    tags.name?.trim() ||
    tags["name:en"]?.trim() ||
    tags.ref?.trim() ||
    tags["addr:housenumber"]?.trim() ||
    primaryFeatureType(tags)
  );
}

function hasRealDisplayName(tags: Record<string, string>): boolean {
  const name = tags.name?.trim() || tags["name:en"]?.trim();
  return Boolean(name && name.length >= 2);
}

function isClosedRing(coords: Array<{ lat: number; lng: number }>): boolean {
  if (coords.length < 3) return false;
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  return Math.abs(first.lat - last.lat) < 1e-6 && Math.abs(first.lng - last.lng) < 1e-6;
}

function geometryKindFromCoords(count: number, osmType: OsmElementType): OsmFeatureListItem["geometryKind"] {
  if (osmType === "node" || count <= 1) return "point";
  if (count >= 3) return "polygon";
  if (count >= 2) return "line";
  return "unknown";
}

function resolveElementCoordinates(
  element: OverpassElement
): {
  lat: number;
  lng: number;
  coordSource: OsmFeatureCoordSource;
  geometryKind: OsmFeatureListItem["geometryKind"];
  coordinates: Array<{ lat: number; lng: number }>;
  closed: boolean;
} | null {
  if (element.type === "node") {
    const point = parseOsmNodeLatLng(element);
    if (!point) return null;
    const rounded = roundInventoryLatLng(point);
    return {
      ...rounded,
      coordSource: "node",
      geometryKind: "point",
      coordinates: [rounded],
      closed: false,
    };
  }

  const wayCoords = parseOsmWayGeometry(element);
  if (wayCoords.length > 0) {
    const center = centerOfCoordinates(wayCoords);
    if (!center) return null;
    const rounded = roundInventoryLatLng(center);
    const closed = isClosedRing(wayCoords);
    const geometryKind = closed ? "polygon" : geometryKindFromCoords(wayCoords.length, element.type);
    return {
      ...rounded,
      coordSource: element.type === "relation" ? "relation_center" : geometryKind === "polygon" ? "polygon_center" : "line_center",
      geometryKind,
      coordinates: wayCoords.map((c) => roundInventoryLatLng(c)),
      closed,
    };
  }

  return null;
}

export function parseOverpassElement(element: OverpassElement): OsmFeatureListItem | null {
  if (!element?.type || element.id == null) return null;
  const tags = element.tags ?? {};
  if (!hasMeaningfulTags(tags)) return null;

  const coords = resolveElementCoordinates(element);
  if (!coords) return null;

  const osmId = Number(element.id);
  if (!Number.isFinite(osmId)) return null;

  return {
    id: `${element.type}/${osmId}`,
    osmType: element.type,
    osmId,
    name: displayName(tags),
    hasRealName: hasRealDisplayName(tags),
    featureType: primaryFeatureType(tags),
    lat: coords.lat,
    lng: coords.lng,
    coordSource: coords.coordSource,
    geometryKind: coords.geometryKind,
    coordinates: coords.coordinates,
    closed: coords.closed,
    tags,
  };
}

export function parseGeoJsonFeature(feature: {
  type?: string;
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown };
}): OsmFeatureListItem | null {
  if (feature.type !== "Feature") return null;
  const props = feature.properties ?? {};
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    tags[key] = String(value);
  }
  if (!hasMeaningfulTags(tags)) return null;

  const point = parseGeoJsonPoint(feature);
  const line = parseGeoJsonLineString(feature);
  const polygonCenter = parseGeoJsonPolygonCenter(feature);

  let lat: number;
  let lng: number;
  let coordSource: OsmFeatureCoordSource;
  let geometryKind: OsmFeatureListItem["geometryKind"];
  let coordinates: Array<{ lat: number; lng: number }>;
  let closed = false;

  if (point) {
    ({ lat, lng } = roundInventoryLatLng(point));
    coordSource = "node";
    geometryKind = "point";
    coordinates = [{ lat, lng }];
  } else if (line.length > 0) {
    const center = centerOfCoordinates(line);
    if (!center) return null;
    ({ lat, lng } = roundInventoryLatLng(center));
    coordSource = "line_center";
    coordinates = line.map((c) => roundInventoryLatLng(c));
    closed = isClosedRing(coordinates);
    geometryKind = closed ? "polygon" : "line";
  } else if (polygonCenter) {
    ({ lat, lng } = roundInventoryLatLng(polygonCenter));
    coordSource = "polygon_center";
    geometryKind = "polygon";
    coordinates = [{ lat, lng }];
    closed = true;
  } else {
    return null;
  }

  const rawId = feature.id ?? tags["@id"] ?? tags.id ?? `${tags.name ?? "feature"}-${lat}-${lng}`;
  const id = String(rawId);

  return {
    id,
    osmType: geometryKind === "point" ? "node" : "way",
    osmId: Number(String(rawId).replace(/\D/g, "")) || 0,
    name: displayName(tags),
    hasRealName: hasRealDisplayName(tags),
    featureType: primaryFeatureType(tags),
    lat,
    lng,
    coordSource,
    geometryKind,
    coordinates,
    closed,
    tags,
  };
}

export function dedupeOsmFeatures(features: OsmFeatureListItem[]): OsmFeatureListItem[] {
  const byId = new Map<string, OsmFeatureListItem>();
  for (const feature of features) {
    byId.set(feature.id, feature);
  }
  return [...byId.values()].sort((a, b) => {
    const typeCmp = a.featureType.localeCompare(b.featureType);
    if (typeCmp !== 0) return typeCmp;
    return a.name.localeCompare(b.name);
  });
}

export function parseOverpassJson(raw: { elements?: OverpassElement[] }): OsmFeatureListItem[] {
  return parseOverpassRaw(raw).features;
}

export function parseOverpassRaw(raw: { elements?: OverpassElement[] }): {
  features: OsmFeatureListItem[];
  elementsById: Map<string, OverpassElement>;
} {
  const elements = Array.isArray(raw.elements) ? raw.elements : [];
  const elementsById = new Map<string, OverpassElement>();
  for (const el of elements) {
    if (el?.type && el.id != null) elementsById.set(`${el.type}/${el.id}`, el);
  }
  const parsed = elements.map(parseOverpassElement).filter((item): item is OsmFeatureListItem => item != null);
  return { features: dedupeOsmFeatures(parsed), elementsById };
}
