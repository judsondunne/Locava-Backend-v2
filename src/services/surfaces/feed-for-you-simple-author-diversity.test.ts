import { describe, expect, it } from "vitest";
import type { SimpleFeedCandidate } from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import { diversifyByAuthor } from "./feed-for-you-simple-author-diversity.js";

function candidate(postId: string, authorId: string): SimpleFeedCandidate {
  return {
    postId,
    sortValue: 1,
    reel: true,
    moderatorTier: 5,
    authorId,
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
    rawFirestore: { reel: true }
  };
}

describe("diversifyByAuthor", () => {
  it("avoids same author back-to-back when alternatives exist", () => {
    const result = diversifyByAuthor(
      [candidate("a1", "author_x"), candidate("b1", "author_y"), candidate("a2", "author_x")],
      {
        limit: 3,
        lastAuthorId: null,
        recentAuthorIds: new Set<string>(),
        maxPerAuthorPerPage: 2,
        avoidBackToBack: true
      }
    );
    expect(result.items.map((row) => row.authorId)).toEqual(["author_x", "author_y", "author_x"]);
  });
});
