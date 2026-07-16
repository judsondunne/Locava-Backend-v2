import { describe, it, expect } from "vitest";
import { isLikelyPromo, scoreReelQuality, filterAndRankReels } from "./reelQuality.js";
import type { CollectedReelInput } from "../../../contracts/surfaces/undiscovered-reels.contract.js";

function reel(p: Partial<CollectedReelInput>): CollectedReelInput {
  return { shortcode: p.shortcode ?? "x", caption: "", ...p };
}

describe("isLikelyPromo", () => {
  it("flags real-estate and rental promos", () => {
    expect(isLikelyPromo(reel({ ownerFullName: "Coldwell Banker Realty", caption: "Warren Falls nearby" }))).toBe(true);
    expect(isLikelyPromo(reel({ caption: "Book your stay at our vacation rental near Bingham Falls" }))).toBe(true);
    expect(isLikelyPromo(reel({ caption: "Home for sale, link in bio to book a tour" }))).toBe(true);
  });

  it("does not flag authentic creator posts", () => {
    expect(isLikelyPromo(reel({ ownerUsername: "vt_hiker", caption: "Hiked to Warren Falls today 💦" }))).toBe(false);
  });
});

describe("scoreReelQuality", () => {
  it("ranks higher-view reels above lower-view ones", () => {
    const hi = scoreReelQuality(reel({ playCount: 100_000, likeCount: 4000 }));
    const lo = scoreReelQuality(reel({ playCount: 200, likeCount: 5 }));
    expect(hi).toBeGreaterThan(lo);
  });

  it("rewards engagement rate, not just raw views", () => {
    const engaged = scoreReelQuality(reel({ playCount: 1000, likeCount: 300 }));
    const flat = scoreReelQuality(reel({ playCount: 1000, likeCount: 2 }));
    expect(engaged).toBeGreaterThan(flat);
  });

  it("returns 0 when there is no engagement data", () => {
    expect(scoreReelQuality(reel({}))).toBe(0);
  });
});

describe("filterAndRankReels", () => {
  const reels = [
    reel({ shortcode: "hi", playCount: 50_000, likeCount: 2000, caption: "Warren Falls" }),
    reel({ shortcode: "lo", playCount: 300, likeCount: 4, caption: "Warren Falls" }),
    reel({ shortcode: "ad", playCount: 90_000, caption: "Vacation rental near Warren Falls, book now" }),
    reel({ shortcode: "unknown", caption: "Warren Falls, no view count" }),
  ];

  it("drops promos even when they have high views", () => {
    const kept = filterAndRankReels(reels, { dropPromos: true }).map((r) => r.shortcode);
    expect(kept).not.toContain("ad");
  });

  it("orders by quality score, highest first", () => {
    const kept = filterAndRankReels(reels, {}).map((r) => r.shortcode);
    expect(kept[0]).toBe("hi");
    expect(kept.indexOf("hi")).toBeLessThan(kept.indexOf("lo"));
  });

  it("keeps only top-N", () => {
    expect(filterAndRankReels(reels, { topN: 1 })).toHaveLength(1);
  });

  it("applies a view floor only to reels with known views", () => {
    const kept = filterAndRankReels(reels, { minViews: 1000 }).map((r) => r.shortcode);
    expect(kept).not.toContain("lo"); // known low views → dropped
    expect(kept).toContain("unknown"); // unknown views → kept
  });
});
