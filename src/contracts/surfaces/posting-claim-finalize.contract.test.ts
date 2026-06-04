import test from "node:test";
import assert from "node:assert/strict";
import {
  PostingClaimFinalizeBodySchema,
  normalizeClaimFinalizeBody,
  postingClaimFinalizeAcceptsRouteFields
} from "./posting-claim-finalize.contract.js";

test("PostingClaimFinalizeBodySchema accepts route claim fields without validation_error", () => {
  const parsed = PostingClaimFinalizeBodySchema.parse({
    postId: "post_ba6a9d32a3edc8d8",
    userId: "user_1",
    requestLat: 43.44725,
    requestLng: -72.47488,
    candidateId: "unx_route_a6e5c0b09fbd",
    candidateItemType: "unexploredRoute",
    unexploredRouteId: "unx_route_a6e5c0b09fbd",
    undiscoveredRouteId: "unx_route_a6e5c0b09fbd",
    undiscoveredSpotId: null
  });
  assert.equal(parsed.candidateId, "unx_route_a6e5c0b09fbd");
  assert.equal(parsed.candidateItemType, "unexploredRoute");
  assert.equal(parsed.lat, 43.44725);
  assert.equal(parsed.lng, -72.47488);
});

test("PostingClaimFinalizeBodySchema passthrough keeps forward-compatible keys", () => {
  const parsed = PostingClaimFinalizeBodySchema.parse({
    postId: "post_1",
    userId: "user_1",
    requestLat: 43.5,
    requestLng: -72.4,
    candidateId: "unx_route_schema_test",
    candidateItemType: "unexploredRoute",
    futureClientField: "ok"
  });
  assert.equal((parsed as Record<string, unknown>).futureClientField, "ok");
});

test("normalizeClaimFinalizeBody derives route claim from native payload", () => {
  const parsed = PostingClaimFinalizeBodySchema.parse({
    postId: "post_4e4c0483865bad18",
    requestLat: 43.44725,
    requestLng: -72.47488,
    candidateId: "unx_route_66c9a2b75aef",
    candidateItemType: "unexploredRoute",
    unexploredRouteId: "unx_route_66c9a2b75aef",
    undiscoveredSpotId: null
  });
  const normalized = normalizeClaimFinalizeBody(parsed, "viewer_1");
  assert.equal(normalized.isRouteClaim, true);
  assert.equal(normalized.routeId, "unx_route_66c9a2b75aef");
  assert.equal(normalized.userId, "viewer_1");
  assert.equal(normalized.itemType, "unexploredRoute");
});

test("normalizeClaimFinalizeBody derives spot claim", () => {
  const parsed = PostingClaimFinalizeBodySchema.parse({
    postId: "post_1",
    userId: "user_1",
    requestLat: 43.44725,
    requestLng: -72.47488,
    candidateId: "unx_spot_schema_test",
    candidateItemType: "unexploredSpot",
    undiscoveredSpotId: "unx_spot_schema_test"
  });
  const normalized = normalizeClaimFinalizeBody(parsed, "user_1");
  assert.equal(normalized.isSpotClaim, true);
  assert.equal(normalized.spotId, "unx_spot_schema_test");
});

test("postingClaimFinalizeAcceptsRouteFields detects route payloads", () => {
  assert.equal(
    postingClaimFinalizeAcceptsRouteFields({
      candidateItemType: "unexploredRoute",
      unexploredRouteId: "unx_route_x"
    }),
    true
  );
  assert.equal(
    postingClaimFinalizeAcceptsRouteFields({
      undiscoveredSpotId: "unx_route_legacy"
    }),
    true
  );
});
