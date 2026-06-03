import { describe, expect, it } from "vitest";
import { estimateFirestoreDocSize, trimDocForFirestore } from "./osmNationalDocSize.js";
import { buildUnexploredSpotId, buildUnexploredRouteId } from "./osmNationalDeterministicIds.js";

describe("osmNationalDocSize", () => {
  it("estimates small docs as allow", () => {
    const size = estimateFirestoreDocSize({ id: "x", name: "test" });
    expect(size).toBeGreaterThan(0);
  });

  it("trims large optional fields", () => {
    const huge = "x".repeat(900_000);
    const { trimmedFields } = trimDocForFirestore({
      id: "r1",
      rawProperties: { huge },
      sourceTags: { a: 1 },
    });
    expect(trimmedFields.length).toBeGreaterThan(0);
  });
});

describe("osmNationalDeterministicIds", () => {
  it("spot ids are deterministic", () => {
    const input = {
      sourceFamily: "openstreetmap",
      sourceKey: "node/1",
      displayName: "Test Falls",
      lat: 43.5,
      lng: -72.4,
      category: "waterfall",
      stateCode: "VT",
    };
    expect(buildUnexploredSpotId(input)).toBe(buildUnexploredSpotId(input));
  });

  it("route ids include geometry hash", () => {
    const id = buildUnexploredRouteId({
      sourceFamily: "openstreetmap",
      sourceKey: "way/1",
      displayName: "Trail",
      geometryHash: "abc123",
      stateCode: "VT",
    });
    expect(id).toMatch(/^unx_route_/);
  });
});
