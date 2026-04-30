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

  it("derives state and city location scopes", () => {
    const deriver = new LegendScopeDeriver({ enablePlaceScopes: true, maxScopesPerPost: 20, maxActivitiesPerPost: 2 });
    const out = deriver.deriveFromPost({
      geohash: "drt2yzw9",
      activities: ["waterfall"],
      state: "VT",
      city: "Burlington"
    });
    expect(out.scopes.some((s) => s === "place:state:VT")).toBe(true);
    expect(out.scopes.some((s) => s === "place:city:VT_burlington")).toBe(true);
    expect(out.scopes.some((s) => s === "placeActivity:state:VT:waterfall")).toBe(true);
    expect(out.scopes.some((s) => s === "placeActivity:city:VT_burlington:waterfall")).toBe(true);
  });

  it("normalizes full-name state and country scopes", () => {
    const deriver = new LegendScopeDeriver({ enablePlaceScopes: true, maxScopesPerPost: 24, maxActivitiesPerPost: 2 });
    const out = deriver.deriveFromPost({
      geohash: "drtju1m3b",
      activities: ["restaurants"],
      state: "New Hampshire",
      country: "US",
      city: "Concord"
    });
    expect(out.scopes).toContain("place:country:US");
    expect(out.scopes).toContain("place:state:NEW_HAMPSHIRE");
    expect(out.scopes).toContain("place:city:NEW_HAMPSHIRE_concord");
    expect(out.scopes).toContain("placeActivity:country:US:restaurants");
    expect(out.scopes).toContain("placeActivity:state:NEW_HAMPSHIRE:restaurants");
  });
});

