import test from "node:test";
import assert from "node:assert/strict";
import type { MapLayerRouteFeature } from "../../contracts/surfaces/undiscovered-map-layer.contract.js";
import { mergeRouteFragmentFeatures } from "./undiscoveredMapLayer.mergeRoutes.js";

function route(id: string, title: string, osm?: { id?: string; type?: string }): MapLayerRouteFeature {
  return {
    id,
    layerKind: "undiscovered",
    featureKind: "route",
    source: "osm",
    title,
    publicMapEligible: true,
    routeSummary: {
      pointCount: 10,
      geometrySource: "test",
      routePreviewCoordinates: [
        { latitude: 43.4, longitude: -72.7 },
        { latitude: 43.41, longitude: -72.69 },
      ],
    },
    routeLengthMeters: 100,
    osm,
    detailRef: { type: "unexploredRoute", id },
  };
}

test("mergeRouteFragmentFeatures collapses same relation id", () => {
  const a = route("a", "Ludlow Trail", { id: "42", type: "relation" });
  const b = route("b", "Ludlow Trail Fragment", { id: "42", type: "relation" });
  b.routeLengthMeters = 50;
  const { features, mergedRouteFragmentCount } = mergeRouteFragmentFeatures([a, b]);
  assert.equal(mergedRouteFragmentCount, 1);
  assert.equal(features.filter((f) => f.featureKind === "route").length, 1);
  assert.equal(features[0]?.id, "a");
});

test("mergeRouteFragmentFeatures keeps distinct named trails", () => {
  const a = route("a", "Buttermilk Falls Trail");
  const b = route("b", "Ludlow Mountain Trail");
  const { features, mergedRouteFragmentCount } = mergeRouteFragmentFeatures([a, b]);
  assert.equal(mergedRouteFragmentCount, 0);
  assert.equal(features.length, 2);
});
