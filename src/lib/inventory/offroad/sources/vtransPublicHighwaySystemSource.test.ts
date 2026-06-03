import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildVtransAotclassWhere,
  buildVtransDisplayName,
  buildVtransPhsQueryParams,
  geoJsonCoordsToTrailPoints,
  normalizeVtransRoadFeatureToInventoryRoute,
  resolveVtransDistance,
  VTRANS_PHS_LOCAL_ROADS_ENDPOINT,
} from "./vtransPublicHighwaySystemSource.js";
import { mergeOsmAndVtransOffroadRoutes, routesLikelySameRoad } from "../inventoryOffroadMerge.js";
import type { LocavaInventoryRoute } from "../../inventoryLocavaTypes.js";

const hartlandBbox = { minLat: 43.45, minLng: -72.55, maxLat: 43.63, maxLng: -72.25 };

describe("vtransPublicHighwaySystemSource", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("query params use bbox as minLng,minLat,maxLng,maxLat", () => {
    const params = buildVtransPhsQueryParams({ bbox: hartlandBbox, includeClass4: true, includeLegalTrails: true });
    expect(params.get("geometry")).toBe("-72.55,43.45,-72.25,43.63");
    expect(params.get("where")).toBe("AOTCLASS IN (4,7)");
    expect(params.get("geometryType")).toBe("esriGeometryEnvelope");
    expect(`${VTRANS_PHS_LOCAL_ROADS_ENDPOINT}?${params.toString()}`).toContain("PublicHighwaySystem/MapServer/6/query");
  });

  it("where clause supports class4 only", () => {
    expect(buildVtransAotclassWhere(true, false)).toBe("AOTCLASS=4");
    expect(buildVtransAotclassWhere(false, true)).toBe("AOTCLASS=7");
  });

  it("GeoJSON LineString converts lng,lat to lat,lng", () => {
    const { flat } = geoJsonCoordsToTrailPoints({
      type: "LineString",
      coordinates: [
        [-72.39, 43.54],
        [-72.388, 43.541],
      ],
    });
    expect(flat[0]).toEqual({ lat: 43.54, lng: -72.39 });
  });

  it("GeoJSON MultiLineString converts to segments", () => {
    const { segments } = geoJsonCoordsToTrailPoints({
      type: "MultiLineString",
      coordinates: [
        [
          [-72.39, 43.54],
          [-72.388, 43.541],
        ],
        [
          [-72.387, 43.542],
          [-72.385, 43.543],
        ],
      ],
    });
    expect(segments.length).toBe(2);
    expect(segments[0]![0]!.lat).toBe(43.54);
  });

  it("AOTCLASS=4 becomes class4_road offroading route", () => {
    const route = normalizeVtransRoadFeatureToInventoryRoute(
      {
        type: "Feature",
        properties: { OBJECTID: 11, AOTCLASS: 4, RDFLNAME: "FERRY RD", AOTMILES: 0.15 },
        geometry: { type: "LineString", coordinates: [[-72.39, 43.54], [-72.388, 43.541]] },
      },
      { importRunId: "test" }
    );
    expect(route?.activity).toBe("offroading");
    expect(route?.offroad?.offroadCategory).toBe("class4_road");
    expect(route?.routeKind).toBe("offroad_class4_road");
    expect(route?.offroad?.legalDisplayLabel).toBe("Unmaintained road");
    expect(route?.source).toBe("vtrans_public_highway_system");
    expect(route?.sourceKey).toBe("vtrans_phs_local_roads/11");
  });

  it("AOTCLASS=7 becomes legal_trail", () => {
    const route = normalizeVtransRoadFeatureToInventoryRoute(
      {
        type: "Feature",
        properties: { OBJECTID: 279, AOTCLASS: 7, RDFLNAME: "LT 1", AOTMILES: 0.32 },
        geometry: { type: "LineString", coordinates: [[-72.39, 43.54], [-72.388, 43.541]] },
      },
      { importRunId: "test" }
    );
    expect(route?.offroad?.offroadCategory).toBe("legal_trail");
    expect(route?.routeKind).toBe("offroad_legal_trail");
  });

  it("uses AOTMILES then ARCMILES then geometry", () => {
    expect(resolveVtransDistance({ aotMiles: 1.2, arcMiles: 2, coords: [{ lat: 43.54, lng: -72.39 }, { lat: 43.541, lng: -72.388 }] }).source).toBe("AOTMILES");
    expect(resolveVtransDistance({ aotMiles: 0, arcMiles: 0.8, coords: [{ lat: 43.54, lng: -72.39 }, { lat: 43.541, lng: -72.388 }] }).source).toBe("ARCMILES");
    expect(resolveVtransDistance({ coords: [{ lat: 43.54, lng: -72.39 }, { lat: 43.55, lng: -72.38 }] }).source).toBe("geometry");
  });

  it("ROADCLOSED marks limited access with warning (not hidden)", () => {
    const route = normalizeVtransRoadFeatureToInventoryRoute(
      {
        type: "Feature",
        properties: { OBJECTID: 99, AOTCLASS: 4, ROADCLOSED: "closed", RDFLNAME: "CLOSED RD" },
        geometry: { type: "LineString", coordinates: [[-72.39, 43.54], [-72.388, 43.541]] },
      },
      { importRunId: "test", includeRestrictedAsHidden: true }
    );
    expect(route?.offroad?.accessStatus).toBe("limited");
    expect(route?.displayPriority).toBe("high");
    expect(route?.offroad?.accessWarnings.some((w) => w.includes("closed"))).toBe(true);
  });

  it("PENT adds warning", () => {
    const route = normalizeVtransRoadFeatureToInventoryRoute(
      {
        type: "Feature",
        properties: { OBJECTID: 100, AOTCLASS: 4, PENT: "Y", RDFLNAME: "PENT RD" },
        geometry: { type: "LineString", coordinates: [[-72.39, 43.54], [-72.388, 43.541]] },
      },
      { importRunId: "test" }
    );
    expect(route?.offroad?.accessWarnings.some((w) => w.includes("Pent road"))).toBe(true);
  });

  it("display name prefers RDFLNAME and title-cases ALL CAPS", () => {
    expect(buildVtransDisplayName({ RDFLNAME: "FERRY RD", PRIMARYNAME: "OTHER" }, 4)).toBe("Ferry Rd");
    expect(buildVtransDisplayName({ RDFLNAME: "TOWN HWY 5" }, 4)).toBe("Town Hwy 5");
  });

  it("merge prefers VTrans over OSM duplicate", () => {
    const osm: LocavaInventoryRoute = {
      id: "route:offroad:way/1",
      kind: "inventory_route",
      routeKind: "offroad_unmaintained_road",
      name: "Ferry Rd",
      normalizedName: "ferry rd",
      activity: "offroading",
      categories: ["offroading"],
      activities: ["offroading"],
      center: { lat: 43.5405, lng: -72.389 },
      bbox: hartlandBbox,
      distanceMeters: 200,
      distanceMiles: 0.12,
      distanceLabel: "0.12 mi",
      geometryType: "LineString",
      coordinates: [
        { lat: 43.54, lng: -72.39 },
        { lat: 43.541, lng: -72.388 },
      ],
      source: "openstreetmap",
      sourceType: "way",
      sourceId: "1",
      sourceKey: "way/1",
      sourceKeys: ["way/1"],
      memberWayIds: ["1"],
      hasMedia: false,
      status: "active",
      locavaScore: 70,
      confidence: "medium",
      displayPriority: "medium",
      showAtZoom: 13,
      selectedTrailhead: null,
      selectedParking: null,
      parkingCandidates: [],
      trailheadCandidates: [],
      assemblyWarnings: [],
      classificationReason: "offroad",
      tagSignals: [],
      negativeSignals: [],
      rejectionReason: null,
      tags: { highway: "track" },
      attribution: { provider: "openstreetmap", license: "ODbL" },
      importRunId: "osm",
      createdAt: "",
      updatedAt: "",
    };

    const vtrans = normalizeVtransRoadFeatureToInventoryRoute(
      {
        type: "Feature",
        properties: { OBJECTID: 11, AOTCLASS: 4, RDFLNAME: "FERRY RD", AOTMILES: 0.15 },
        geometry: { type: "LineString", coordinates: [[-72.39, 43.54], [-72.388, 43.541]] },
      },
      { importRunId: "vtrans" }
    )!;

    expect(routesLikelySameRoad(osm, vtrans)).toBe(true);
    const merged = mergeOsmAndVtransOffroadRoutes({ osmRoutes: [osm], vtransRoutes: [vtrans], bbox: hartlandBbox });
    expect(merged.routes.length).toBe(1);
    expect(merged.routes[0]?.source).toBe("vtrans_public_highway_system");
    expect(merged.routes[0]?.sourceKeys).toContain("way/1");
    expect(merged.duplicatesMergedWithOsm).toBe(1);
  });
});
