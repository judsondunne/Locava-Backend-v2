import { describe, expect, it } from "vitest";
import {
  computeFollowingFetchTarget,
  computeFollowingPageHasMore,
  computeFollowingPerChunkLimit,
  computeFollowingSourceExhausted
} from "./following-feed-pagination.js";

describe("following-feed-pagination", () => {
  it("scales per-chunk limit with required candidate depth", () => {
    expect(
      computeFollowingPerChunkLimit({ requiredCandidateCount: 46, remainingTarget: 20 })
    ).toBe(50);
    expect(
      computeFollowingPerChunkLimit({ requiredCandidateCount: 6, remainingTarget: 10 })
    ).toBe(10);
  });

  it("does not mark source exhausted when a chunk returned a full limit page", () => {
    expect(
      computeFollowingSourceExhausted({
        hitReadBudget: false,
        hitQueryBudget: false,
        anyChunkReturnedFullLimit: true
      })
    ).toBe(false);
  });

  it("marks source exhausted when all chunks were partial and budgets were not hit", () => {
    expect(
      computeFollowingSourceExhausted({
        hitReadBudget: false,
        hitQueryBudget: false,
        anyChunkReturnedFullLimit: false
      })
    ).toBe(true);
  });

  it("keeps hasMore when ranked window is shorter than cursor depth but source may continue", () => {
    expect(
      computeFollowingPageHasMore({
        endExclusive: 12,
        rankedLength: 12,
        sourceExhausted: false
      })
    ).toBe(true);
    expect(
      computeFollowingPageHasMore({
        endExclusive: 12,
        rankedLength: 12,
        sourceExhausted: true
      })
    ).toBe(false);
  });

  it("scales fetch target with pagination offset", () => {
    expect(
      computeFollowingFetchTarget({
        requiredCandidateCount: 46,
        limit: 5,
        scanFloor: 24,
        maxTarget: 320
      })
    ).toBe(62);
  });
});
