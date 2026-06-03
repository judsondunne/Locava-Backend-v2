import type { InventoryBbox } from "../../../../contracts/entities/inventory-entities.contract.js";
import type { LocavaInventoryRoute } from "../../inventoryLocavaTypes.js";
import { assembleOffroadRoutes } from "../inventoryOffroadAssembler.js";
import { fetchOverpassJson } from "../../../openstreetmap/overpassFetch.js";
import {
  dedupeOsmFeatures,
  parseOverpassRaw,
  type OsmFeatureListItem,
} from "../../../openstreetmap/osmFeatureParse.js";
import type {
  NationalOffroadSourceAdapter,
  OffroadBboxFetchInput,
  OffroadNormalizeContext,
  OffroadRawFeature,
  OffroadStateFetchInput,
  RejectedOffroadCandidate,
} from "./nationalOffroadSource.types.js";
import { OSM_OFFROAD_WARNINGS } from "./nationalOffroadSource.types.js";

const OVERPASS_USER_AGENT =
  process.env.OVERPASS_USER_AGENT ?? "LocavaBackendV2/0.1 (national offroad; contact: admin@locava.app)";

async function fetchOsmFeaturesForBbox(bbox: InventoryBbox): Promise<OsmFeatureListItem[]> {
  const query = buildOffroadOverpassQuery(bbox);
  const json = (await fetchOverpassJson({ query, userAgent: OVERPASS_USER_AGENT })) as {
    elements?: Parameters<typeof parseOverpassRaw>[0]["elements"];
  };
  const parsed = parseOverpassRaw(json as { elements?: Parameters<typeof parseOverpassRaw>[0]["elements"] });
  return dedupeOsmFeatures(parsed.features);
}

export function buildOffroadOverpassQuery(bbox: InventoryBbox): string {
  const { minLat, minLng, maxLat, maxLng } = bbox;
  const box = `${minLat},${minLng},${maxLat},${maxLng}`;
  const latSpanKm = ((maxLat - minLat) / 2) * 111.32;
  const lngSpanKm = ((maxLng - minLng) / 2) * 111.32 * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const timeoutSec = Math.min(180, Math.max(60, Math.round(Math.max(latSpanKm, lngSpanKm) * 8)));
  const lines: string[] = [`[out:json][timeout:${timeoutSec}];`, `(`];
  const offroadKeys = [
    "atv",
    "ohv",
    "ohrv",
    "4wd_only",
    "motorcycle",
    "motor_vehicle",
    "tracktype",
    "smoothness",
    "surface",
    "maintenance",
    "seasonal",
    "legal_trail",
    "class",
    "road_class",
    "highway_class",
    "town_highway_class",
    "vt_class",
    "nh_class",
  ];
  for (const key of offroadKeys) {
    lines.push(`  way["${key}"](${box});`);
    lines.push(`  relation["${key}"](${box});`);
  }
  for (const highway of ["track", "service", "unclassified"]) {
    lines.push(`  way["highway"="${highway}"](${box});`);
  }
  lines.push(`  way["highway"="path"]["motor_vehicle"](${box});`);
  lines.push(`  way["highway"="path"]["atv"](${box});`);
  lines.push(`);`);
  lines.push(`out body geom;`);
  return lines.join("\n");
}

function osmFeatureToRaw(f: OsmFeatureListItem): OffroadRawFeature {
  return {
    sourceId: "osm_offroad",
    sourceType: "osm_offroad",
    featureId: f.id,
    geometryType: f.geometryKind === "line" ? "LineString" : "unknown",
    geometry: { coordinates: f.coordinates, closed: f.closed },
    properties: { ...f.tags, _name: f.name, _featureType: f.featureType },
  };
}

export const osmOffroadAdapter: NationalOffroadSourceAdapter = {
  sourceId: "osm_offroad",
  sourceName: "OpenStreetMap offroad signals",
  supportsState: () => true,

  async fetchForBbox(input: OffroadBboxFetchInput): Promise<OffroadRawFeature[]> {
    const features = await fetchOsmFeaturesForBbox(input.bbox);
    return features.map(osmFeatureToRaw);
  },

  async fetchForState(input: OffroadStateFetchInput): Promise<OffroadRawFeature[]> {
    if (!input.bbox) return [];
    return this.fetchForBbox({ bbox: input.bbox, dryRun: true, importRunId: input.importRunId });
  },

  normalizeFeature(
    feature: OffroadRawFeature,
    context: OffroadNormalizeContext
  ): LocavaInventoryRoute | RejectedOffroadCandidate | null {
    const coords = (feature.geometry as { coordinates?: Array<{ lat: number; lng: number }> })?.coordinates;
    if (!coords || coords.length < 2) {
      return { kind: "rejected", sourceId: "osm_offroad", reason: "insufficient_geometry", properties: feature.properties };
    }

    const osmItem: OsmFeatureListItem = {
      id: feature.featureId,
      osmType: feature.featureId.includes("relation") ? "relation" : "way",
      osmId: Number.parseInt(feature.featureId.split("/").pop() ?? "0", 10) || 0,
      name: String(feature.properties._name ?? "Offroad segment"),
      hasRealName: Boolean(feature.properties._name),
      featureType: String(feature.properties._featureType ?? "highway=track"),
      lat: coords[0]!.lat,
      lng: coords[0]!.lng,
      coordSource: "line_center",
      geometryKind: "line",
      coordinates: coords,
      closed: false,
      tags: Object.fromEntries(
        Object.entries(feature.properties)
          .filter(([k]) => !k.startsWith("_"))
          .map(([k, v]) => [k, String(v)])
      ),
    };

    const assembly = assembleOffroadRoutes({
      features: [osmItem],
      usedSourceKeys: new Set(),
      accessFeatures: [],
      importRunId: context.importRunId,
    });

    const route = assembly.routes[0];
    if (!route) {
      const rejected = assembly.rejected[0];
      return {
        kind: "rejected",
        sourceId: "osm_offroad",
        reason: rejected?.rejectionReason ?? "osm_not_offroad",
        properties: feature.properties,
      };
    }

    const explicit =
      route.offroad?.offroadConfidence === "explicit" || route.offroad?.offroadConfidence === "strong";
    const legalLabel = explicit ? "Unmaintained road" : "Offroad candidate";
    route.offroad = {
      ...route.offroad!,
      legalDisplayLabel: legalLabel,
      accessWarnings: [...new Set([...(route.offroad?.accessWarnings ?? []), ...OSM_OFFROAD_WARNINGS])],
      sourceSignals: [...new Set([...(route.offroad?.sourceSignals ?? []), "osm_offroad_national"])],
    };
    route.tags = { ...route.tags, state: context.stateCode };
    return route;
  },
};
