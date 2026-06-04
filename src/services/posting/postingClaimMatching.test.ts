import test from "node:test";
import assert from "node:assert/strict";
import {
  bboxAroundPoint,
  buildCaptureDocId,
  buildExplicitClaimCandidate,
  inferClaimCandidateTarget,
  maxRadiusForMarker,
  pickBestClaimCandidate,
  scoreClaimCandidate,
  titleSimilarity,
  type ClaimMatchCandidate
} from "./postingClaimMatching.js";
import type { UnexploredMapMarkerSummary } from "../map/unexploredMapMarkers.service.js";

function marker(overrides: Partial<UnexploredMapMarkerSummary> & { id: string; lat: number; lng: number }): UnexploredMapMarkerSummary {
  return {
    sourceCollection: "unexploredSpots",
    itemType: "unexploredSpot",
    title: "Cedar Beach",
    firstActivity: "beach",
    emoji: "🏖️",
    hasMedia: false,
    isUnexplored: true,
    isRoute: false,
    ...overrides
  };
}

test("scoreClaimCandidate returns nearest valid unexplored spot within radius", () => {
  const result = scoreClaimCandidate({
    marker: marker({ id: "cedar", lat: 41.0, lng: -72.0, title: "Cedar Beach" }),
    postLat: 41.0004,
    postLng: -72.0002,
    postActivities: ["beach"],
    postTitle: "Day at Cedar Beach"
  });
  assert.ok(result);
  assert.equal(result?.id, "cedar");
  assert.ok(result!.distanceMeters < 100);
  assert.ok(result!.matchScore > 0.5);
});

test("scoreClaimCandidate returns null outside radius", () => {
  const result = scoreClaimCandidate({
    marker: marker({ id: "far", lat: 41.1, lng: -72.1 }),
    postLat: 41.0,
    postLng: -72.0,
    postActivities: ["beach"]
  });
  assert.equal(result, null);
});

test("activity overlap improves score", () => {
  const withActivity = scoreClaimCandidate({
    marker: marker({ id: "a", lat: 41.0003, lng: -72.0003, firstActivity: "beach" }),
    postLat: 41.0,
    postLng: -72.0,
    postActivities: ["beach"]
  });
  const withoutActivity = scoreClaimCandidate({
    marker: marker({ id: "a", lat: 41.0003, lng: -72.0003, firstActivity: "beach" }),
    postLat: 41.0,
    postLng: -72.0,
    postActivities: ["hiking"]
  });
  assert.ok(withActivity && withoutActivity);
  assert.ok(withActivity.matchScore > withoutActivity.matchScore);
});

test("title/name match improves score", () => {
  assert.ok(titleSimilarity("Cedar Beach", "cedar beach") >= 0.99);
  const named = scoreClaimCandidate({
    marker: marker({ id: "a", lat: 41.0003, lng: -72.0003, title: "Cedar Beach" }),
    postLat: 41.0,
    postLng: -72.0,
    postActivities: [],
    postTitle: "Cedar Beach sunset"
  });
  const unnamed = scoreClaimCandidate({
    marker: marker({ id: "a", lat: 41.0003, lng: -72.0003, title: "Cedar Beach" }),
    postLat: 41.0,
    postLng: -72.0,
    postActivities: []
  });
  assert.ok(named && unnamed);
  assert.ok(named.matchScore > unnamed.matchScore);
});

test("ambiguous low-confidence match returns null", () => {
  const a: ClaimMatchCandidate = {
    id: "a",
    sourceCollection: "unexploredSpots",
    itemType: "unexploredSpot",
    title: "Spot A",
    lat: 41,
    lng: -72,
    distanceMeters: 30,
    matchScore: 0.72,
    firstActivity: "beach",
    activities: ["beach"],
    emoji: "🏖️",
    matchedBy: "distance_activity"
  };
  const b: ClaimMatchCandidate = {
    ...a,
    id: "b",
    title: "Spot B",
    distanceMeters: 55,
    matchScore: 0.71
  };
  assert.equal(pickBestClaimCandidate([a, b]), null);
});

test("already captured candidate can be marked and filtered out by default", () => {
  const captured: ClaimMatchCandidate = {
    id: "captured",
    sourceCollection: "unexploredSpots",
    itemType: "unexploredSpot",
    title: "Taken Spot",
    lat: 41,
    lng: -72,
    distanceMeters: 20,
    matchScore: 0.9,
    firstActivity: "beach",
    activities: ["beach"],
    emoji: "🏖️",
    alreadyCaptured: true,
    matchedBy: "distance"
  };
  assert.equal(pickBestClaimCandidate([captured]), null);
  assert.equal(pickBestClaimCandidate([captured], { allowAlreadyCaptured: true })?.id, "captured");
});

test("sourceCollection + itemType preserved in scoring output", () => {
  const route = scoreClaimCandidate({
    marker: {
      ...marker({ id: "route-1", lat: 41.0002, lng: -72.0002 }),
      sourceCollection: "unexploredRoutes",
      itemType: "unexploredRoute",
      isRoute: true,
      firstActivity: "hiking"
    },
    postLat: 41.0,
    postLng: -72.0,
    postActivities: ["hiking"]
  });
  assert.ok(route);
  assert.equal(route?.sourceCollection, "unexploredRoutes");
  assert.equal(route?.itemType, "unexploredRoute");
});

test("buildCaptureDocId is deterministic", () => {
  assert.equal(buildCaptureDocId("unexploredSpots", "CEDAR_BEACH"), "unexploredSpots_CEDAR_BEACH");
});

test("maxRadiusForMarker uses category defaults", () => {
  assert.equal(maxRadiusForMarker(marker({ id: "b", lat: 0, lng: 0, firstActivity: "beach" })), 100);
  assert.equal(maxRadiusForMarker(marker({ id: "w", lat: 0, lng: 0, firstActivity: "waterfall" })), 60);
});

test("bboxAroundPoint expands around coordinate", () => {
  const bbox = bboxAroundPoint(41, -72, 100);
  assert.ok(bbox.minLat < 41 && bbox.maxLat > 41);
  assert.ok(bbox.minLng < -72 && bbox.maxLng > -72);
});

test("route claim uses distance to polyline not anchor", () => {
  const line = [
    { lat: 43.4, lng: -72.7 },
    { lat: 43.41, lng: -72.69 },
  ];
  const nearLine = scoreClaimCandidate({
    marker: {
      ...marker({ id: "trail", lat: 43.405, lng: -72.695 }),
      sourceCollection: "unexploredRoutes",
      itemType: "unexploredRoute",
      isRoute: true,
      routeSummary: {
        routePreviewCoordinates: line.map((p) => ({ lat: p.lat, lng: p.lng })),
      },
    },
    postLat: 43.405,
    postLng: -72.695,
    postActivities: ["hiking"],
  });
  assert.ok(nearLine);
  assert.equal(nearLine?.matchedBy, "route_segment");

  const farFromLineNearAnchor = scoreClaimCandidate({
    marker: {
      ...marker({ id: "trail2", lat: 43.4, lng: -72.7 }),
      sourceCollection: "unexploredRoutes",
      itemType: "unexploredRoute",
      isRoute: true,
      routeSummary: {
        routePreviewCoordinates: line.map((p) => ({ lat: p.lat, lng: p.lng })),
      },
    },
    postLat: 43.5,
    postLng: -72.5,
    postActivities: ["hiking"],
  });
  assert.equal(farFromLineNearAnchor, null);
});

test("inferClaimCandidateTarget maps unx_route_ ids to unexploredRoutes", () => {
  const inferred = inferClaimCandidateTarget("unx_route_f48c0ea3fd5d");
  assert.equal(inferred.sourceCollection, "unexploredRoutes");
  assert.equal(inferred.itemType, "unexploredRoute");
});

test("buildExplicitClaimCandidate accepts route far from polyline when explicitly selected", () => {
  const line = [
    { lat: 43.44, lng: -72.44 },
    { lat: 43.45, lng: -72.45 },
    { lat: 43.46, lng: -72.46 },
  ];
  const explicit = buildExplicitClaimCandidate({
    marker: marker({
      id: "unx_route_test",
      lat: 43.44,
      lng: -72.44,
      sourceCollection: "unexploredRoutes",
      itemType: "unexploredRoute",
      title: "Trail Route",
      routeSummary: {
        routePreviewCoordinates: line.map((p) => ({ lat: p.lat, lng: p.lng })),
      },
    }),
    postLat: 43.5,
    postLng: -72.5,
    postActivities: ["hiking"],
  });
  assert.equal(explicit.id, "unx_route_test");
  assert.equal(explicit.itemType, "unexploredRoute");
  assert.ok(explicit.matchScore >= 0.42);
});
