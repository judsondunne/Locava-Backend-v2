import test from "node:test";
import assert from "node:assert/strict";
import { normalizeClaimFinalizeCandidateInput } from "./postingClaimFinalize.service.js";

test("normalizeClaimFinalizeCandidateInput prefers unexploredRouteId for routes", () => {
  const normalized = normalizeClaimFinalizeCandidateInput({
    candidateId: "unx_route_f48c0ea3fd5d",
    itemType: "unexploredRoute",
    sourceCollection: "unexploredRoutes",
  });
  assert.equal(normalized.candidateId, "unx_route_f48c0ea3fd5d");
  assert.equal(normalized.itemType, "unexploredRoute");
  assert.equal(normalized.sourceCollection, "unexploredRoutes");
});

test("normalizeClaimFinalizeCandidateInput maps legacy undiscoveredSpotId route prefix", () => {
  const normalized = normalizeClaimFinalizeCandidateInput({
    undiscoveredSpotId: "unx_route_f48c0ea3fd5d",
  });
  assert.equal(normalized.candidateId, "unx_route_f48c0ea3fd5d");
  assert.equal(normalized.itemType, "unexploredRoute");
  assert.equal(normalized.sourceCollection, "unexploredRoutes");
});

test("normalizeClaimFinalizeCandidateInput accepts unexploredRouteId alias", () => {
  const normalized = normalizeClaimFinalizeCandidateInput({
    unexploredRouteId: "unx_route_abc123",
  });
  assert.equal(normalized.candidateId, "unx_route_abc123");
  assert.equal(normalized.itemType, "unexploredRoute");
});

test("normalizeClaimFinalizeCandidateInput treats candidateItemType unexploredRoute as route", () => {
  const normalized = normalizeClaimFinalizeCandidateInput({
    candidateId: "unx_route_a6e5c0b09fbd",
    candidateItemType: "unexploredRoute",
  });
  assert.equal(normalized.candidateId, "unx_route_a6e5c0b09fbd");
  assert.equal(normalized.itemType, "unexploredRoute");
  assert.equal(normalized.sourceCollection, "unexploredRoutes");
});

test("normalizeClaimFinalizeCandidateInput prefers candidateId with unx_route_ prefix", () => {
  const normalized = normalizeClaimFinalizeCandidateInput({
    candidateId: "unx_route_from_candidate",
  });
  assert.equal(normalized.candidateId, "unx_route_from_candidate");
  assert.equal(normalized.itemType, "unexploredRoute");
});
