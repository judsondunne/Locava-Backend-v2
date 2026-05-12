import { describe, expect, it } from "vitest";
import type { SimpleFeedCandidate } from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import {
  candidateMatchesServePhase,
  isForYouSimpleReel,
  isForYouSimpleReelFromRaw,
  reelTierBucketForCandidate,
  resolveModeratorTierFromRaw
} from "./feed-for-you-simple-tier.js";

function candidate(overrides: Partial<SimpleFeedCandidate>): SimpleFeedCandidate {
  return {
    postId: "post_1",
    sortValue: 1,
    reel: true,
    moderatorTier: null,
    authorId: "author_1",
    createdAtMs: 1,
    updatedAtMs: 1,
    mediaType: "video",
    posterUrl: "https://cdn.locava.test/poster.jpg",
    firstAssetUrl: null,
    title: null,
    captionPreview: null,
    authorHandle: "author",
    authorName: null,
    authorPic: null,
    activities: [],
    address: null,
    geo: { lat: null, long: null, city: null, state: null, country: null, geohash: null },
    assets: [],
    likeCount: 0,
    commentCount: 0,
    rawFirestore: {},
    ...overrides
  };
}

describe("feed-for-you-simple tier resolver", () => {
  it("reads classification.moderatorTier and top-level moderatorTier", () => {
    expect(resolveModeratorTierFromRaw({ classification: { moderatorTier: 5 } })).toBe(5);
    expect(resolveModeratorTierFromRaw({ moderatorTier: 4 })).toBe(4);
    expect(resolveModeratorTierFromRaw({})).toBeNull();
  });

  it("treats classification.reel and top-level reel as reels", () => {
    expect(isForYouSimpleReelFromRaw({ reel: true, classification: { reel: true } })).toBe(true);
    expect(isForYouSimpleReelFromRaw({ classification: { reel: true } })).toBe(true);
    expect(isForYouSimpleReelFromRaw({ mediaType: "video" })).toBe(false);
    const tier4 = candidate({
      reel: true,
      moderatorTier: 4,
      rawFirestore: {
        reel: true,
        classification: { reel: true, moderatorTier: 4 },
        media: { cover: { posterUrl: "https://cdn.locava.test/poster.jpg" } }
      }
    });
    expect(isForYouSimpleReel(tier4)).toBe(true);
    expect(candidateMatchesServePhase(tier4, "reel_tier_4")).toBe(true);
  });

  it("orders unknown tier reels after tier 4", () => {
    const unknown = candidate({ moderatorTier: null, rawFirestore: { reel: true } });
    expect(reelTierBucketForCandidate(unknown)).toBe("other");
    expect(candidateMatchesServePhase(unknown, "reel_other")).toBe(true);
    expect(candidateMatchesServePhase(unknown, "reel_tier_4")).toBe(false);
  });
});
