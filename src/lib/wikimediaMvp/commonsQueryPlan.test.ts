import { describe, expect, it } from "vitest";
import { buildCommonsSearchQueryPlan } from "./commonsQueryPlan.js";
import type { WikimediaMvpSeedPlace } from "./WikimediaMvpTypes.js";

function seed(p: Partial<WikimediaMvpSeedPlace>): WikimediaMvpSeedPlace {
  return {
    placeName: "Moss Glen Falls",
    searchQuery: "Moss Glen Falls, Vermont, VT",
    stateName: "Vermont",
    stateCode: "VT",
    placeCategoryKeywords: ["waterfall"],
    ...p,
  };
}

describe("buildCommonsSearchQueryPlan", () => {
  it("includes simple place name before comma-heavy legacy label", () => {
    const plan = buildCommonsSearchQueryPlan(seed({}));
    const queries = plan.map((x) => x.query);
    expect(queries[0]).toBe("Moss Glen Falls");
    expect(queries).toContain("Moss Glen Falls Vermont");
    expect(queries).toContain("Moss Glen Falls VT");
    expect(queries.some((q) => q.includes("Moss Glen Falls") && q.includes("waterfall"))).toBe(true);
  });

  it("does not rely solely on the legacy search label", () => {
    const plan = buildCommonsSearchQueryPlan(seed({}));
    expect(plan.length).toBeGreaterThan(1);
    const first = plan[0]!;
    expect(first.variantType).toBe("exact_place_name");
  });
});
