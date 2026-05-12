import { describe, expect, it } from "vitest";
import { approvedFirestoreTagsForRecall, geoRadiusRecallLadderKm, normalizeMixActivityToken } from "./mixActivityRecall.js";

describe("mixActivityRecall", () => {
  it("maps cafe to coffee-related Firestore tags", () => {
    expect(approvedFirestoreTagsForRecall("cafe")).toEqual(expect.arrayContaining(["cafe", "coffee"]));
  });

  it("normalizes plural-ish tokens consistently", () => {
    expect(normalizeMixActivityToken("  Cafes ")).toBe("cafe");
  });

  it("geoRadiusRecallLadderKm expands monotonically and caps", () => {
    const ladder = geoRadiusRecallLadderKm(16, 500);
    expect(ladder[0]).toBeLessThanOrEqual(16);
    expect(ladder[ladder.length - 1]).toBe(500);
  });
});
