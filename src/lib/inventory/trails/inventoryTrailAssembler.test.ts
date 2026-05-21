import { describe, expect, it } from "vitest";
import { stitchSegments, distanceMetersForCoords } from "./inventoryTrailGraph.js";
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
});
