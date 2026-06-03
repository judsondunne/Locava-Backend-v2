import { describe, expect, it } from "vitest";
import { classifyOpenStreetMapFeaturesForInventory } from "../../openstreetmap.service.js";
import { buildUnexploredDocsFromClassification } from "../osmNationalDocBuilder.js";
import type { OsmFeatureListItem } from "../../../../lib/openstreetmap/osmFeatureParse.js";

function trailWay(id: number, name: string, coords: Array<{ lat: number; lng: number }>): OsmFeatureListItem {
  return {
    id: `way/${id}`,
    osmType: "way",
    osmId: id,
    name,
    hasRealName: true,
    featureType: "highway=path",
    lat: coords[0]!.lat,
    lng: coords[0]!.lng,
    coordSource: "line_center",
    geometryKind: "line",
    coordinates: coords,
    closed: false,
    tags: { highway: "path", name, sac_scale: "hiking" },
  };
}

describe("pbfCopier route support via inventory pipeline", () => {
  it("assembles named hiking path ways into accepted routes", async () => {
    const features = [
      trailWay(1, "Juniper Hill Trail", [
        { lat: 43.54, lng: -72.39 },
        { lat: 43.541, lng: -72.389 },
        { lat: 43.542, lng: -72.388 },
      ]),
      trailWay(2, "Juniper Hill Trail", [
        { lat: 43.542, lng: -72.388 },
        { lat: 43.543, lng: -72.387 },
        { lat: 43.544, lng: -72.386 },
      ]),
    ];
    const result = await classifyOpenStreetMapFeaturesForInventory({
      bbox: { minLat: 43.53, minLng: -72.4, maxLat: 43.55, maxLng: -72.38 },
      stateCode: "VT",
      runId: "route-test",
      source: "fixture",
      rawFeatures: features,
      includeOsmSpots: true,
      includeOsmRoutes: true,
      includeOsmOffroad: false,
    });
    expect(result.acceptedRoutes.length).toBeGreaterThanOrEqual(1);
    expect(result.acceptedRoutes[0]?.mapReadiness).toBe("ready");

    const built = buildUnexploredDocsFromClassification({
      spots: result.acceptedSpots,
      routes: result.acceptedRoutes,
      stateCode: "VT",
      runId: "route-test",
      chunkId: "fixture",
      writeMode: false,
      writeTarget: "none",
      includePublicOnly: true,
      includeReviewItems: false,
      includeOsmSpots: true,
      includeOsmRoutes: true,
      includeOffroad: false,
    });
    expect(built.routes.length).toBeGreaterThanOrEqual(1);
    expect(built.routes[0]?.encodedPolyline || built.routes[0]?.geometry?.encodedPolyline).toBeTruthy();
  });

  it("builds public route docs for typical named path without sac_scale (PBF runner config)", async () => {
    const features = [
      {
        id: "way/10",
        osmType: "way" as const,
        osmId: 10,
        name: "Mount Mansfield Trail",
        hasRealName: true,
        featureType: "highway=path",
        lat: 44.54,
        lng: -72.81,
        coordSource: "line_center" as const,
        geometryKind: "line" as const,
        coordinates: [
          { lat: 44.54, lng: -72.81 },
          { lat: 44.541, lng: -72.809 },
          { lat: 44.542, lng: -72.808 },
          { lat: 44.543, lng: -72.807 },
        ],
        closed: false,
        tags: { highway: "path", name: "Mount Mansfield Trail", foot: "yes" },
      },
    ];
    const result = await classifyOpenStreetMapFeaturesForInventory({
      bbox: { minLat: 44.53, minLng: -72.82, maxLat: 44.55, maxLng: -72.8 },
      stateCode: "VT",
      runId: "route-test-2",
      source: "fixture",
      rawFeatures: features,
      includeOsmSpots: true,
      includeOsmRoutes: true,
      includeOsmOffroad: true,
      offroadSource: "osm",
    });
    expect(result.acceptedRoutes.length).toBeGreaterThanOrEqual(1);
    const route = result.acceptedRoutes[0]!;
    expect(route.mapReadiness).toBe("ready");
    const built = buildUnexploredDocsFromClassification({
      spots: result.acceptedSpots,
      routes: result.acceptedRoutes,
      stateCode: "VT",
      runId: "route-test-2",
      chunkId: "fixture",
      writeMode: false,
      writeTarget: "none",
      includePublicOnly: true,
      includeReviewItems: false,
      includeOsmSpots: true,
      includeOsmRoutes: true,
      includeOffroad: true,
    });
    expect(built.routes.length).toBe(1);
  });

  it("does not accept tertiary road as route", async () => {
    const features: OsmFeatureListItem[] = [
      {
        id: "way/99",
        osmType: "way",
        osmId: 99,
        name: "Main Road",
        hasRealName: true,
        featureType: "highway=tertiary",
        lat: 43.54,
        lng: -72.39,
        coordSource: "line_center",
        geometryKind: "line",
        coordinates: [
          { lat: 43.54, lng: -72.39 },
          { lat: 43.55, lng: -72.38 },
        ],
        closed: false,
        tags: { highway: "tertiary", name: "Main Road" },
      },
    ];
    const result = await classifyOpenStreetMapFeaturesForInventory({
      bbox: { minLat: 43.53, minLng: -72.4, maxLat: 43.56, maxLng: -72.37 },
      stateCode: "VT",
      runId: "road-test",
      source: "fixture",
      rawFeatures: features,
      includeOsmRoutes: true,
    });
    expect(result.acceptedRoutes.every((r) => !r.tags?.highway || r.tags.highway !== "tertiary")).toBe(true);
    expect(result.acceptedRoutes.every((r) => r.name !== "Main Road")).toBe(true);
  });

  it("rejects generic forest roads on track and keeps foot-designated paths", async () => {
    const features: OsmFeatureListItem[] = [
      {
        id: "way/19687761",
        osmType: "way",
        osmId: 19687761,
        name: "Moose Bog Trail",
        hasRealName: true,
        featureType: "highway=path",
        lat: 44.7629,
        lng: -71.73357,
        coordSource: "line_center",
        geometryKind: "line",
        coordinates: [
          { lat: 44.7629, lng: -71.73357 },
          { lat: 44.7635, lng: -71.733 },
          { lat: 44.764, lng: -71.7325 },
        ],
        closed: false,
        tags: { highway: "path", foot: "designated", name: "Moose Bog Trail" },
      },
      {
        id: "way/19688307",
        osmType: "way",
        osmId: 19688307,
        name: "South Road",
        hasRealName: true,
        featureType: "highway=track",
        lat: 44.92868,
        lng: -71.88657,
        coordSource: "line_center",
        geometryKind: "line",
        coordinates: [
          { lat: 44.92868, lng: -71.88657 },
          { lat: 44.929, lng: -71.886 },
          { lat: 44.9295, lng: -71.8855 },
        ],
        closed: false,
        tags: { highway: "track", snowmobile: "designated", name: "South Road" },
      },
      {
        id: "way/19688543",
        osmType: "way",
        osmId: 19688543,
        name: "Broadway",
        hasRealName: true,
        featureType: "highway=track",
        lat: 44.42288,
        lng: -72.85722,
        coordSource: "line_center",
        geometryKind: "line",
        coordinates: [
          { lat: 44.42288, lng: -72.85722 },
          { lat: 44.4232, lng: -72.8568 },
          { lat: 44.4236, lng: -72.8564 },
        ],
        closed: false,
        tags: { highway: "track", motor_vehicle: "private", name: "Broadway" },
      },
    ];
    const result = await classifyOpenStreetMapFeaturesForInventory({
      bbox: { minLat: 44.4, minLng: -72.9, maxLat: 45.0, maxLng: -71.6 },
      stateCode: "VT",
      runId: "track-filter-test",
      source: "fixture",
      rawFeatures: features,
      includeOsmRoutes: true,
      includeOsmOffroad: true,
      offroadSource: "osm",
    });
    const names = result.acceptedRoutes.map((r) => r.name);
    expect(names).toContain("Moose Bog Trail");
    expect(names).not.toContain("South Road");
    expect(names).not.toContain("Broadway");
    const moose = result.acceptedRoutes.find((r) => r.name === "Moose Bog Trail")!;
    expect(moose.primaryActivity).toBe("hiking");
    expect(moose.categories[0]).toBe("hiking");
  });

  it("aligns offroad route category with offroading primary activity", async () => {
    const features: OsmFeatureListItem[] = [
      {
        id: "way/200",
        osmType: "way",
        osmId: 200,
        name: "Class 4 Road",
        hasRealName: true,
        featureType: "highway=track",
        lat: 44.5,
        lng: -72.5,
        coordSource: "line_center",
        geometryKind: "line",
        coordinates: [
          { lat: 44.5, lng: -72.5 },
          { lat: 44.501, lng: -72.499 },
          { lat: 44.502, lng: -72.498 },
        ],
        closed: false,
        tags: { highway: "track", surface: "gravel", access: "public", name: "Class 4 Road" },
      },
    ];
    const result = await classifyOpenStreetMapFeaturesForInventory({
      bbox: { minLat: 44.49, minLng: -72.51, maxLat: 44.51, maxLng: -72.49 },
      stateCode: "VT",
      runId: "class4-test",
      source: "fixture",
      rawFeatures: features,
      includeOsmRoutes: true,
      includeOsmOffroad: true,
      offroadSource: "osm",
    });
    expect(result.acceptedRoutes.length).toBe(1);
    const route = result.acceptedRoutes[0]!;
    expect(route.primaryActivity).toBe("offroading");
    expect(route.categories[0]).toBe("offroading");
    const built = buildUnexploredDocsFromClassification({
      spots: [],
      routes: result.acceptedRoutes,
      stateCode: "VT",
      runId: "class4-test",
      chunkId: "fixture",
      writeMode: false,
      writeTarget: "none",
      includePublicOnly: true,
      includeReviewItems: false,
      includeOsmSpots: false,
      includeOsmRoutes: true,
      includeOffroad: true,
    });
    expect(built.routes[0]?.category).toBe("offroading");
    expect(built.routes[0]?.primaryActivity).toBe("offroading");
  });
});
