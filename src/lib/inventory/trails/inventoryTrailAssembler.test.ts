import { describe, expect, it } from "vitest";
import { stitchSegments, distanceMetersForCoords, trailStartPoint } from "./inventoryTrailGraph.js";
import { assembleInventoryTrails } from "./inventoryTrailAssembler.js";
import type { OsmFeatureListItem } from "../../openstreetmap/osmFeatureParse.js";

describe("inventoryTrailGraph", () => {
  it("sums segment distances", () => {
    const d = distanceMetersForCoords([
      { lat: 43.54, lng: -72.39 },
      { lat: 43.541, lng: -72.389 },
    ]);
    expect(d).toBeGreaterThan(0);
  });

  it("stitches adjacent segments", () => {
    const a = [
      { lat: 43.54, lng: -72.39 },
      { lat: 43.541, lng: -72.389 },
    ];
    const b = [
      { lat: 43.541, lng: -72.389 },
      { lat: 43.542, lng: -72.388 },
    ];
    const out = stitchSegments([a, b]);
    expect(out.stitched).toBe(true);
    expect(out.coordinates.length).toBe(3);
  });

  it("trailStartPoint returns first coordinate of stitched line", () => {
    const coords = [
      { lat: 43.54, lng: -72.39 },
      { lat: 43.545, lng: -72.385 },
      { lat: 43.55, lng: -72.38 },
    ];
    expect(trailStartPoint({ coordinates: coords })).toEqual(coords[0]);
  });
});

describe("inventoryTrailAssembler", () => {
  it("assembles named way group into one route", () => {
    const features: OsmFeatureListItem[] = [
      {
        id: "way/1",
        osmType: "way",
        osmId: 1,
        name: "Juniper Hill Trail",
        hasRealName: true,
        featureType: "highway=path",
        lat: 43.54,
        lng: -72.39,
        coordSource: "line_center",
        geometryKind: "line",
        coordinates: [
          { lat: 43.54, lng: -72.39 },
          { lat: 43.541, lng: -72.389 },
          { lat: 43.542, lng: -72.388 },
        ],
        closed: false,
        tags: { highway: "path", name: "Juniper Hill Trail" },
      },
      {
        id: "way/2",
        osmType: "way",
        osmId: 2,
        name: "Juniper Hill Trail",
        hasRealName: true,
        featureType: "highway=path",
        lat: 43.543,
        lng: -72.387,
        coordSource: "line_center",
        geometryKind: "line",
        coordinates: [
          { lat: 43.542, lng: -72.388 },
          { lat: 43.543, lng: -72.387 },
          { lat: 43.544, lng: -72.386 },
        ],
        closed: false,
        tags: { highway: "path", name: "Juniper Hill Trail" },
      },
    ];
    const result = assembleInventoryTrails({
      features,
      elementsById: new Map(),
      accessFeatures: [],
      importRunId: "test",
    });
    expect(result.routes.length).toBeGreaterThanOrEqual(1);
    expect(result.routes[0]?.routeKind).toBe("named_way_group");
    expect(result.routes[0]?.distanceMeters).toBeGreaterThan(100);
    expect(result.routes[0]?.center).toEqual({ lat: 43.54, lng: -72.39 });
  });

  it("suppresses tiny fragments under 100m", () => {
    const features: OsmFeatureListItem[] = [
      {
        id: "way/99",
        osmType: "way",
        osmId: 99,
        name: "Tiny",
        hasRealName: true,
        featureType: "highway=path",
        lat: 43.54,
        lng: -72.39,
        coordSource: "line_center",
        geometryKind: "line",
        coordinates: [
          { lat: 43.54, lng: -72.39 },
          { lat: 43.54001, lng: -72.38999 },
        ],
        closed: false,
        tags: { highway: "path", name: "Tiny" },
      },
    ];
    const result = assembleInventoryTrails({ features, elementsById: new Map(), accessFeatures: [], importRunId: "test" });
    expect(result.routes.length).toBe(0);
    expect(result.suppressedTinySegments).toBeGreaterThan(0);
  });

  it("accepts foot-designated paths but rejects generic named forest roads on track", () => {
    const pathTrail: OsmFeatureListItem = {
      id: "way/10",
      osmType: "way",
      osmId: 10,
      name: "Moose Bog Trail",
      hasRealName: true,
      featureType: "highway=path",
      lat: 44.76,
      lng: -71.73,
      coordSource: "line_center",
      geometryKind: "line",
      coordinates: [
        { lat: 44.76, lng: -71.73 },
        { lat: 44.761, lng: -71.729 },
        { lat: 44.762, lng: -71.728 },
      ],
      closed: false,
      tags: { highway: "path", foot: "designated", name: "Moose Bog Trail" },
    };
    const genericRoad: OsmFeatureListItem = {
      id: "way/11",
      osmType: "way",
      osmId: 11,
      name: "South Road",
      hasRealName: true,
      featureType: "highway=track",
      lat: 44.92,
      lng: -71.88,
      coordSource: "line_center",
      geometryKind: "line",
      coordinates: [
        { lat: 44.92, lng: -71.88 },
        { lat: 44.921, lng: -71.879 },
        { lat: 44.922, lng: -71.878 },
      ],
      closed: false,
      tags: { highway: "track", snowmobile: "designated", name: "South Road" },
    };
    const pathResult = assembleInventoryTrails({
      features: [pathTrail],
      elementsById: new Map(),
      accessFeatures: [],
      importRunId: "test",
    });
    const roadResult = assembleInventoryTrails({
      features: [genericRoad],
      elementsById: new Map(),
      accessFeatures: [],
      importRunId: "test",
    });
    expect(pathResult.routes.length).toBeGreaterThanOrEqual(1);
    expect(roadResult.routes.length).toBe(0);
  });
});
