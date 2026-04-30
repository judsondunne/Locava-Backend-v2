import { describe, expect, it } from "vitest";
import { buildFirstClaimKey, canonicalFromAwardType, sortLegendDisplayCards } from "./legend.service.js";

describe("legend canonical helpers", () => {
  it("maps legacy award types into all canonical kinds", () => {
    expect(canonicalFromAwardType("first_finder", "place").kind).toBe("location_first");
    expect(canonicalFromAwardType("first_activity_finder", "activity").kind).toBe("activity_first");
    expect(canonicalFromAwardType("first_activity_finder", "placeActivity").kind).toBe("combo_first");
    expect(canonicalFromAwardType("new_leader", "place").kind).toBe("location_rank");
    expect(canonicalFromAwardType("rank_up", "activity").kind).toBe("activity_rank");
    expect(canonicalFromAwardType("rank_up", "placeActivity").kind).toBe("combo_rank");
  });

  it("builds deterministic first-claim keys", () => {
    expect(buildFirstClaimKey({ kind: "location_first", locationScope: "state", locationKey: "VT" })).toBe(
      "location_first:state:VT"
    );
    expect(buildFirstClaimKey({ kind: "activity_first", activityKey: "waterfall" })).toBe("activity_first:waterfall");
    expect(
      buildFirstClaimKey({
        kind: "combo_first",
        locationScope: "city",
        locationKey: "VT_burlington",
        activityKey: "waterfall"
      })
    ).toBe("combo_first:city:VT_burlington:activity:waterfall");
  });

  it("sorts reward display cards by ascending priority", () => {
    const sorted = sortLegendDisplayCards([
      { id: "b", displayPriority: 30 },
      { id: "a", displayPriority: 10 },
      { id: "c", displayPriority: 20 }
    ]);
    expect(sorted.map((row) => row.id)).toEqual(["a", "c", "b"]);
  });
});

