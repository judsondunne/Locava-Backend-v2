import { describe, expect, it } from "vitest";
import { pickRandomTarget, selectSeedLikersForPost } from "../seedLikerSelection.js";

describe("seedLikerSelection", () => {
  it("blocks targets below targetMin unless explicitly allowed", () => {
    const result = selectSeedLikersForPost({
      seedLikerIds: Array.from({ length: 14 }, (_, i) => `u${i + 1}`),
      existingLikerIds: new Set(),
      authorUserId: null,
      currentLikeCount: 0,
      targetMin: 18,
      targetMax: 24,
      allowTargetBelowMin: false,
      rng: () => 0
    });
    expect(result.blockedBelowTargetMin).toBe(true);
    expect(result.targetLikeCount).toBe(0);
    expect(result.selectedUserIds).toEqual([]);
    expect(result.clampedBelowTargetMin).toBe(true);
  });

  it("allows targets below targetMin when allowTargetBelowMin is true", () => {
    const result = selectSeedLikersForPost({
      seedLikerIds: Array.from({ length: 14 }, (_, i) => `u${i + 1}`),
      existingLikerIds: new Set(),
      authorUserId: null,
      currentLikeCount: 0,
      targetMin: 18,
      targetMax: 24,
      allowTargetBelowMin: true,
      rng: () => 0
    });
    expect(result.blockedBelowTargetMin).toBe(false);
    expect(result.targetLikeCount).toBe(14);
    expect(result.selectedUserIds).toHaveLength(14);
    expect(result.desiredTargetBeforeClamp).toBe(18);
    expect(result.targetAfterAvailableClamp).toBe(14);
  });

  it("excludes existing likes and post author", () => {
    const result = selectSeedLikersForPost({
      seedLikerIds: ["author", "u1", "u2", "u3"],
      existingLikerIds: new Set(["u2"]),
      authorUserId: "author",
      currentLikeCount: 1,
      targetMin: 4,
      targetMax: 4,
      allowTargetBelowMin: true,
      rng: () => 0
    });
    expect(result.selectedUserIds.sort()).toEqual(["u1", "u3"]);
    expect(result.targetLikeCount).toBe(3);
    expect(result.excludedAuthorCount).toBe(1);
    expect(result.excludedExistingLikeCount).toBe(1);
  });

  it("returns no selections when no likers remain", () => {
    const result = selectSeedLikersForPost({
      seedLikerIds: ["u1"],
      existingLikerIds: new Set(["u1"]),
      authorUserId: null,
      currentLikeCount: 0,
      targetMin: 5,
      targetMax: 5,
      allowTargetBelowMin: false,
      rng: () => 0
    });
    expect(result.selectedUserIds).toEqual([]);
    expect(result.skippedNoAvailable).toBe(true);
  });

  it("pickRandomTarget stays within bounds", () => {
    expect(pickRandomTarget(18, 24, () => 0)).toBe(18);
    expect(pickRandomTarget(18, 24, () => 0.999)).toBe(24);
    expect(pickRandomTarget(24, 18, () => 0.25)).toBe(19);
  });
});
