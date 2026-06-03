import { describe, expect, it } from "vitest";
import {
  normalizeUnexploredRouteDoc,
  normalizeUnexploredSpotDoc,
  normalizeUnexploredLayerDocs,
} from "./undiscoveredMapLayer.normalizer.js";

describe("undiscoveredMapLayer.normalizer", () => {
  it("converts public spot doc to point feature", () => {
    const { feature, reason } = normalizeUnexploredSpotDoc({
      id: "spot_a",
      publicMapEligible: true,
      mapReadiness: "ready",
      lat: 43.54,
      lng: -72.4,
      displayName: "Trail Head",
      activities: ["hiking"],
      sourceFamily: "osm",
    });
    expect(reason).toBeNull();
    expect(feature?.featureKind).toBe("point");
    expect(feature?.latitude).toBe(43.54);
    expect(feature?.detailRef).toEqual({ type: "unexploredSpot", id: "spot_a" });
  });

  it("drops hidden or non-public spots", () => {
    const hidden = normalizeUnexploredSpotDoc({
      id: "h",
      publicMapEligible: true,
      mapReadiness: "hidden",
      lat: 1,
      lng: 2,
    });
    expect(hidden.feature).toBeNull();
    expect(hidden.reason).toBe("hidden");
  });

  it("includes PBF Copier V2 blank spot writes (publicMapEligible false)", () => {
    const { feature, reason } = normalizeUnexploredSpotDoc({
      id: "v2_spot",
      undiscovered: true,
      publicMapEligible: false,
      mapReadiness: "review",
      lat: 43.54,
      lng: -72.4,
      displayName: "Trail View",
      audit: { createdBy: "pbf_copier_v2" },
    });
    expect(reason).toBeNull();
    expect(feature?.featureKind).toBe("point");
  });

  it("converts route doc with encoded polyline", async () => {
    const { feature, reason } = await normalizeUnexploredRouteDoc({
      id: "route_a",
      publicMapEligible: true,
      mapReadiness: "ready",
      encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
      displayName: "Ridge Loop",
      activities: ["hiking"],
    });
    expect(reason).toBeNull();
    expect(feature?.featureKind).toBe("route");
    expect(feature?.routeSummary.routePreviewCoordinates.length).toBeGreaterThanOrEqual(2);
    expect(feature?.routeSummary.geometrySource).not.toBe("none");
  });

  it("drops route without geometry", async () => {
    const { feature, reason } = await normalizeUnexploredRouteDoc({
      id: "route_empty",
      publicMapEligible: true,
      mapReadiness: "ready",
    });
    expect(feature).toBeNull();
    expect(reason).toBe("route_missing_geometry");
  });

  it("promotes route-like spot docs to route features", async () => {
    const { features } = await normalizeUnexploredLayerDocs({
      spots: [
        {
          id: "spot_route",
          publicMapEligible: true,
          mapReadiness: "ready",
          kind: "route",
          encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
        },
      ],
      routes: [],
    });
    expect(features).toHaveLength(1);
    expect(features[0]?.featureKind).toBe("route");
  });

  it("drops invalid coordinates", () => {
    const { feature, reason } = normalizeUnexploredSpotDoc({
      id: "bad",
      publicMapEligible: true,
      mapReadiness: "ready",
      lat: 999,
      lng: -72,
    });
    expect(feature).toBeNull();
    expect(reason).toBe("invalid_coords");
  });
});
