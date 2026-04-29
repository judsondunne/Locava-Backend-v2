import { describe, expect, it } from "vitest";
import { LegendScopeDeriver } from "./legend-scope-deriver.js";

describe("LegendScopeDeriver", () => {
  it("derives bounded scopes (caps activities and total scopes)", () => {
    const deriver = new LegendScopeDeriver({ maxScopesPerPost: 8, maxActivitiesPerPost: 3, enablePlaceScopes: true });
    const out = deriver.deriveFromPost({
      geohash: "drt2yzw9",
      activities: ["waterfall", "hiking", "coffee", "museum"],
      state: "VT"
    });
    expect(out.scopes.length).toBeLessThanOrEqual(8);
    // Includes base cell scope.
    expect(out.scopes.some((s) => s.startsWith("cell:geohash6:drt2yz"))).toBe(true);
  });

  it("drops place scopes when disabled", () => {
    const deriver = new LegendScopeDeriver({ enablePlaceScopes: false });
    const out = deriver.deriveFromPost({
      geohash: "drt2yzw9",
      activities: ["waterfall"],
      state: "VT"
    });
    expect(out.scopes.some((s) => s.startsWith("place:"))).toBe(false);
    expect(out.scopes.some((s) => s.startsWith("placeActivity:"))).toBe(false);
  });
});

