import { describe, expect, it } from "vitest";
import {
  enrichClass4OffroadRouteActivities,
  enrichRouteDistanceAndShape,
  inferRouteShapeHint,
} from "./pbfCopierV2RouteEnrichment.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

function routeDoc(overrides: Partial<PbfCopierPreviewDoc> = {}): PbfCopierPreviewDoc {
  return {
    id: "route:1",
    kind: "unexplored_route",
    collection: "unexploredRoutes",
    displayName: "Ferry Road",
    primaryActivity: "hiking",
    activities: ["hiking"],
    primaryCategory: "track",
    lat: 43.54,
    lng: -72.39,
    sourceFamily: "openstreetmap",
    sourceKeys: ["way/1"],
    sourceIds: ["1"],
    osmType: "way",
    osmId: 1,
    origin: "generated_osm",
    mapReadiness: "review",
    publicMapEligible: false,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: "test",
    importPipelineVersion: "1",
    pbfFilePath: "./test.pbf",
    sourceProvider: "geofabrik",
    sourceTagSample: { highway: "track", vt_class: "4" },
    warnings: [],
    routeLineCoordinates: [
      { lat: 43.54, lng: -72.39 },
      { lat: 43.541, lng: -72.391 },
      { lat: 43.542, lng: -72.392 },
    ],
    ...overrides,
  };
}

describe("pbfCopierV2RouteEnrichment", () => {
  it("sets offroading first then hiking for class 4 roads", () => {
    const enriched = enrichClass4OffroadRouteActivities(routeDoc());
    expect(enriched.primaryActivity).toBe("offroading");
    expect(enriched.activities?.[0]).toBe("offroading");
    expect(enriched.activities?.[1]).toBe("hiking");
    expect(enriched.primaryCategory).toBe("class4_road");
  });

  it("computes distance and loop shape", () => {
    const loopCoords = [
      { lat: 43.54, lng: -72.39 },
      { lat: 43.541, lng: -72.39 },
      { lat: 43.541, lng: -72.389 },
      { lat: 43.54, lng: -72.389 },
      { lat: 43.54, lng: -72.39 },
    ];
    const enriched = enrichRouteDistanceAndShape(
      routeDoc({ routeLineCoordinates: loopCoords, sourceTagSample: { highway: "path" } })
    );
    expect(enriched.distanceMeters).toBeGreaterThan(0);
    expect(enriched.routeShapeHint).toBe("loop");
  });

  it("detects roundtrip tag as loop", () => {
    expect(inferRouteShapeHint([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }], { roundtrip: "yes" })).toBe(
      "loop"
    );
  });
});
