import fs from "node:fs/promises";
import { distanceLabel, distanceMilesFromMeters, distanceMetersForCoords } from "../../trails/inventoryTrailGraph.js";
import type { LocavaInventoryRoute } from "../../inventoryLocavaTypes.js";
import { OFFROAD_STATE_SOURCE_WARNINGS } from "../inventoryOffroadSignals.js";
import type { OffroadGeojsonImportResult, OffroadGeojsonSourceInput } from "./offroadSource.types.js";

function propString(props: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = props[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

function isClass6Value(value: string): boolean {
  const v = value.toLowerCase();
  return v === "6" || v === "vi" || v.includes("class 6") || v.includes("class_6") || v.includes("class vi");
}

function detectClass6(props: Record<string, unknown>): boolean {
  const keys = ["class", "road_class", "highway_class", "nh_class", "class6", "class_vi", "road_status", "maintenance", "description"];
  for (const k of keys) {
    const v = propString(props, [k]);
    if (v && isClass6Value(v)) return true;
  }
  return false;
}

function lineCoords(geometry: { type?: string; coordinates?: unknown }): Array<{ lat: number; lng: number }> {
  if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
    return (geometry.coordinates as number[][]).map(([lng, lat]) => ({ lat: lat!, lng: lng! }));
  }
  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    const first = (geometry.coordinates as number[][][])[0];
    return first ? first.map(([lng, lat]) => ({ lat: lat!, lng: lng! })) : [];
  }
  return [];
}

export async function importNhClass6RoadsGeojson(input: OffroadGeojsonSourceInput): Promise<OffroadGeojsonImportResult> {
  const raw = await fs.readFile(input.filePath, "utf8");
  const geo = JSON.parse(raw) as { features?: Array<{ properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }> };
  const routes: LocavaInventoryRoute[] = [];
  const rejected: OffroadGeojsonImportResult["rejected"] = [];

  for (const feature of geo.features ?? []) {
    const props = feature.properties ?? {};
    if (propString(props, ["access"]).toLowerCase() === "private") {
      rejected.push({ reason: "private_access", properties: props });
      continue;
    }
    if (!detectClass6(props)) {
      rejected.push({ reason: "not_class6", properties: props });
      continue;
    }
    const coords = lineCoords(feature.geometry ?? {});
    if (coords.length < 2) {
      rejected.push({ reason: "missing_geometry", properties: props });
      continue;
    }
    const dist = distanceMetersForCoords(coords);
    const name = propString(props, ["name", "road_name"]) || "Unmaintained Road";
    const town = propString(props, ["town", "municipality", "city"]);
    const lats = coords.map((c) => c.lat);
    const lngs = coords.map((c) => c.lng);
    const bbox = { minLat: Math.min(...lats), minLng: Math.min(...lngs), maxLat: Math.max(...lats), maxLng: Math.max(...lngs) };
    routes.push({
      id: `route:state:nh6:${routes.length}`,
      kind: "inventory_route",
      routeKind: "offroad_class6_road",
      name: town ? `${name} (${town})` : name,
      normalizedName: name.toLowerCase(),
      activity: "offroading",
      categories: ["class6_road", "offroading"],
      activities: ["offroading"],
      center: { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 },
      bbox,
      distanceMeters: dist,
      distanceMiles: distanceMilesFromMeters(dist),
      distanceLabel: distanceLabel(dist),
      geometryType: "LineString",
      coordinates: coords,
      segments: [coords],
      source: "state_geojson",
      sourceType: "geojson",
      sourceId: propString(props, ["id", "OBJECTID"]) || String(routes.length),
      sourceKey: `state/nh6/${routes.length}`,
      sourceKeys: [`state/nh6/${routes.length}`],
      memberWayIds: [],
      hasMedia: false,
      status: "active",
      locavaScore: 85,
      confidence: "high",
      displayPriority: "medium",
      showAtZoom: 12,
      selectedTrailhead: null,
      selectedParking: null,
      parkingCandidates: [],
      trailheadCandidates: [],
      offroad: {
        legalDisplayLabel: "Unmaintained road",
        offroadCategory: "class6_road",
        offroadConfidence: "explicit",
        accessStatus: "unknown",
        accessWarnings: [...OFFROAD_STATE_SOURCE_WARNINGS],
        seasonalWarnings: [],
        sourceSignals: ["state:nh_class6"],
        vehicleSignals: {},
        roadClassSignals: { nhClass6: true, classTagRaw: propString(props, ["class", "road_class"]) },
      },
      assemblyWarnings: OFFROAD_STATE_SOURCE_WARNINGS,
      classificationReason: "state_nh_class6",
      tagSignals: ["state_geojson"],
      negativeSignals: [],
      rejectionReason: null,
      tags: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, String(v)])),
      attribution: { provider: "openstreetmap", license: "ODbL" },
      importRunId: input.importRunId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return { routes, rejected };
}
