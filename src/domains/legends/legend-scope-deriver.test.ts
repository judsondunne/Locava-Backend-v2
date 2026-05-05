import { describe, expect, it } from "vitest";
import { LegendScopeDeriver } from "./legend-scope-deriver.js";

describe("LegendScopeDeriver", () => {
  it("derives bounded scopes (caps activities and total scopes)", () => {
    const deriver = new LegendScopeDeriver({ maxScopesPerPost: 8, maxActivitiesPerPost: 3, enablePlaceScopes: true });
    const out = deriver.deriveFromPost({
      geohash: "drt2yzw9",
      activities: ["waterfall", "hiking", "coffee", "museum"],
      state: "VT",
      country: "US"
    });
    expect(out.scopes.length).toBeLessThanOrEqual(8);
    expect(out.scopes).toContain("place:state:VT");
    expect(out.scopes).toContain("place:country:US");
  });

  it("drops place scopes when disabled", () => {
    const deriver = new LegendScopeDeriver({ enablePlaceScopes: false });
    const out = deriver.deriveFromPost({
      geohash: "drt2yzw9",
      activities: ["waterfall"],
      state: "VT",
      country: "US"
    });
    expect(out.scopes.some((s) => s.startsWith("place:"))).toBe(false);
    expect(out.scopes.some((s) => s.startsWith("placeActivity:"))).toBe(false);
    expect(out.scopes).toContain("activity:waterfall");
  });

  it("derives state and country location scopes only", () => {
    const deriver = new LegendScopeDeriver({ enablePlaceScopes: true, maxScopesPerPost: 20, maxActivitiesPerPost: 2 });
    const out = deriver.deriveFromPost({
      geohash: "drt2yzw9",
      activities: ["waterfall"],
      state: "VT",
      city: "Burlington",
      country: "US"
    });
    expect(out.scopes.some((s) => s === "place:state:VT")).toBe(true);
    expect(out.scopes.some((s) => s === "place:country:US")).toBe(true);
    expect(out.scopes.some((s) => s === "placeActivity:state:VT:waterfall")).toBe(true);
    expect(out.scopes.some((s) => s === "placeActivity:country:US:waterfall")).toBe(true);
    expect(out.scopes.some((s) => s.includes(":city:"))).toBe(false);
    expect(out.scopes.some((s) => s.startsWith("cell:") || s.startsWith("cellActivity:"))).toBe(false);
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
    expect(out.scopes.some((s) => s.startsWith("place:country:"))).toBe(true);
    expect(out.scopes.some((s) => s.startsWith("placeActivity:country:"))).toBe(true);
    expect(out.scopes).toContain("place:state:NEW_HAMPSHIRE");
    expect(out.scopes).not.toContain("place:city:NEW_HAMPSHIRE_concord");
    expect(out.scopes).toContain("placeActivity:state:NEW_HAMPSHIRE:restaurants");
  });
});

