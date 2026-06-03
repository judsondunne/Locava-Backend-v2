import { describe, expect, it } from "vitest";
import { inferActivitiesFromOsmTags, listActivityRelevantTags } from "./inventoryOsmActivityTags.js";

describe("inventoryOsmActivityTags", () => {
  it("returns empty activities when only a name-like place tag exists", () => {
    expect(
      inferActivitiesFromOsmTags({
        place: "hamlet",
        name: "Cadys Falls",
        "gnis:feature_id": "1456716",
      })
    ).toEqual([]);
  });

  it("derives waterfall activities from waterway tag only", () => {
    const acts = inferActivitiesFromOsmTags({ waterway: "waterfall", name: "Cadys falls" });
    expect(acts).toContain("waterfall");
    expect(acts).toContain("hiking");
    expect(acts).not.toContain("scenic");
  });

  it("maps covered bridge tags to coveredbridge canonical activity", () => {
    const acts = inferActivitiesFromOsmTags({ man_made: "bridge", bridge: "covered", name: "Braley Covered Bridge" });
    expect(acts).toContain("coveredbridge");
    expect(acts).toContain("bridge");
  });

  it("lists activity-relevant tag keys for diagnostics", () => {
    const relevant = listActivityRelevantTags({
      place: "hamlet",
      waterway: "waterfall",
      ele: "172",
      "gnis:feature_id": "1",
    });
    expect(relevant.waterway).toBe("waterfall");
    expect(relevant.place).toBe("hamlet");
    expect(relevant.ele).toBeUndefined();
  });
});
