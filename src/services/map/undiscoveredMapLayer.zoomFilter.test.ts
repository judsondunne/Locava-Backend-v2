import { describe, expect, it } from "vitest";
import type { MapLayerPointFeature, MapLayerRouteFeature } from "../../contracts/surfaces/undiscovered-map-layer.contract.js";
import { isUndiscoveredMarkerZoomGatingEnabled } from "../../lib/map/undiscoveredMapVisibility.js";
import { applyUndiscoveredZoomFilter } from "./undiscoveredMapLayer.zoomFilter.js";

function poi(id: string, lat: number, lng: number): MapLayerPointFeature {
  return {
    id,
    layerKind: "undiscovered",
    featureKind: "point",
    source: "osm",
    title: id,
    latitude: lat,
    longitude: lng,
    publicMapEligible: true,
    detailRef: { type: "unexploredSpot", id },
  };
}

function route(id: string, lat: number, lng: number): MapLayerRouteFeature {
  return {
    id,
    layerKind: "undiscovered",
    featureKind: "route",
    source: "osm",
    title: id,
    centroid: { latitude: lat, longitude: lng },
    publicMapEligible: true,
    routeSummary: {
      pointCount: 2,
      geometrySource: "test",
      routePreviewCoordinates: [
        { latitude: lat, longitude: lng },
        { latitude: lat + 0.001, longitude: lng + 0.001 },
      ],
    },
    detailRef: { type: "unexploredRoute", id },
  };
}

describe("applyUndiscoveredZoomFilter", () => {
  it("passes through all features when zoom gating is disabled", () => {
    const features = [poi("a", 43.4, -72.7), route("r1", 43.41, -72.71)];
    const out = applyUndiscoveredZoomFilter({ features, zoom: 10 });
    if (!isUndiscoveredMarkerZoomGatingEnabled()) {
      expect(out.features.filter((f) => f.featureKind === "point").length).toBe(1);
      expect(out.features.filter((f) => f.featureKind === "route").length).toBe(1);
      expect(out.counts.individualPoiCount).toBe(1);
      return;
    }
    expect(out.features.every((f) => f.featureKind === "cluster")).toBe(true);
  });

  it("returns clusters only at low zoom when gating enabled", () => {
    if (!isUndiscoveredMarkerZoomGatingEnabled()) return;
    const features = [poi("a", 43.4, -72.7), route("r1", 43.41, -72.71)];
    const out = applyUndiscoveredZoomFilter({
      features,
      zoom: 10,
      sourceDocs: new Map([
        ["a", { confidence: "medium", locavaScore: 60, showAtZoom: 13 }],
        ["r1", { confidence: "low", locavaScore: 50, showAtZoom: 15 }],
      ]),
    });
    expect(out.features.every((f) => f.featureKind === "cluster")).toBe(true);
    expect(out.counts.individualPoiCount).toBe(0);
  });

  it("caps density at high zoom when gating enabled", () => {
    const features = Array.from({ length: 80 }, (_, i) => poi(`p${i}`, 43.4 + i * 0.0001, -72.7));
    const out = applyUndiscoveredZoomFilter({
      features,
      zoom: 14,
      sourceDocs: new Map(features.map((f) => [f.id, { confidence: "high", locavaScore: 80, showAtZoom: 11 }])),
    });
    const points = out.features.filter((f) => f.featureKind === "point");
    if (!isUndiscoveredMarkerZoomGatingEnabled()) {
      expect(points.length).toBe(80);
      return;
    }
    expect(points.length).toBeLessThanOrEqual(48);
    expect(out.counts.hiddenDueToDensityCount).toBeGreaterThan(0);
  });
});
