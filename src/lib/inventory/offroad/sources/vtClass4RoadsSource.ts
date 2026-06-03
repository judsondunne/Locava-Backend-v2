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

function isClass4Value(value: string | number): boolean {
  if (value === 4 || value === "4" || value === "04") return true;
  const v = String(value).toLowerCase();
  return v === "iv" || v.includes("class 4") || v.includes("class_4") || v.includes("class iv") || v.includes("town highway class 4");
}

function numericOrStringClass(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function detectClass4(props: Record<string, unknown>): boolean {
  for (const key of ["AOTCLASS", "aotclass", "AotClass", "RPCCLASS", "rpcclass"]) {
    const raw = numericOrStringClass(props[key]);
    if (raw != null && isClass4Value(raw)) return true;
  }
  const keys = ["class", "road_class", "highway_class", "town_highway_class", "highwayclass", "vtclass", "th_class", "local_class", "description", "AOTCLASS", "RPCCLASS"];
  for (const k of keys) {
    const v = propString(props, [k]);
    if (v && isClass4Value(v)) return true;
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

export async function importVtClass4RoadsGeojson(input: OffroadGeojsonSourceInput): Promise<OffroadGeojsonImportResult> {
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
    if (!detectClass4(props)) {
      rejected.push({ reason: "not_class4", properties: props });
      continue;
    }
    const coords = lineCoords(feature.geometry ?? {});
    if (coords.length < 2) {
      rejected.push({ reason: "missing_geometry", properties: props });
      continue;
    }
    const dist = distanceMetersForCoords(coords);
    const name = propString(props, ["name", "road_name", "rd_name", "PRIMARYNAME", "primaryname"]) || "Unmaintained Road";
    const town = propString(props, ["town", "municipality", "city", "TOWNGEOID", "towngeoid"]);
    const lats = coords.map((c) => c.lat);
    const lngs = coords.map((c) => c.lng);
    const bbox = { minLat: Math.min(...lats), minLng: Math.min(...lngs), maxLat: Math.max(...lats), maxLng: Math.max(...lngs) };
    routes.push({
      id: `route:state:vt4:${routes.length}`,
      kind: "inventory_route",
      routeKind: "offroad_class4_road",
      name: town ? `${name} (${town})` : name,
      normalizedName: name.toLowerCase(),
      activity: "offroading",
      categories: ["class4_road", "offroading"],
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
      sourceId: propString(props, ["id", "OBJECTID", "fid"]) || String(routes.length),
      sourceKey: `state/vt4/${routes.length}`,
      sourceKeys: [`state/vt4/${routes.length}`],
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
        offroadCategory: "class4_road",
        offroadConfidence: "explicit",
        accessStatus: "unknown",
        accessWarnings: [...OFFROAD_STATE_SOURCE_WARNINGS],
        seasonalWarnings: [],
        sourceSignals: ["state:vt_class4"],
        vehicleSignals: {},
        roadClassSignals: { vtClass4: true, classTagRaw: propString(props, ["class", "road_class"]) },
      },
      assemblyWarnings: OFFROAD_STATE_SOURCE_WARNINGS,
      classificationReason: "state_vt_class4",
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
