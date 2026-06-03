import { describe, expect, it } from "vitest";
import { isUndiscoveredFirestoreMapEligible } from "./undiscoveredFirestoreEligibility.js";

describe("isUndiscoveredFirestoreMapEligible", () => {
  it("allows public ready docs", () => {
    expect(
      isUndiscoveredFirestoreMapEligible({
        publicMapEligible: true,
        mapReadiness: "ready",
      }),
    ).toBe(true);
  });

  it("allows PBF Copier V2 blank writes with publicMapEligible false", () => {
    expect(
      isUndiscoveredFirestoreMapEligible({
        undiscovered: true,
        publicMapEligible: false,
        mapReadiness: "review",
        audit: { createdBy: "pbf_copier_v2" },
        classification: { reason: "pbf_copier_v2_blank_write" },
      }),
    ).toBe(true);
  });

  it("drops hidden readiness", () => {
    expect(
      isUndiscoveredFirestoreMapEligible({
        publicMapEligible: true,
        mapReadiness: "hidden",
      }),
    ).toBe(false);
  });

  it("drops undiscovered docs without public or v2 markers", () => {
    expect(
      isUndiscoveredFirestoreMapEligible({
        undiscovered: true,
        publicMapEligible: false,
        mapReadiness: "review",
      }),
    ).toBe(false);
  });
});
