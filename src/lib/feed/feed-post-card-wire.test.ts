import { describe, expect, it } from "vitest";
import { wireFeedCandidateToPostCardSummary } from "./feed-post-card-wire.js";
import type { FeedBootstrapCandidateRecord } from "../../repositories/surfaces/feed.repository.js";

describe("wireFeedCandidateToPostCardSummary", () => {
  it("preserves appPost and postContractVersion on the wire item", () => {
    const appPost = {
      schema: { name: "locava.appPost", version: 2 },
      id: "post_1",
      media: {
        assetCount: 2,
        assets: [
          { id: "a1", index: 0, type: "image", image: { displayUrl: "https://cdn/1.jpg" }, video: null },
          { id: "a2", index: 1, type: "image", image: { displayUrl: "https://cdn/2.jpg" }, video: null },
        ],
      },
    };
    const item = {
      postId: "post_1",
      author: { userId: "u1", handle: "u1", name: "U", pic: null },
      activities: ["hike"],
      address: null,
      geo: { lat: null, long: null, city: null, state: null, country: null, geohash: null },
      assets: [{ id: "a1", type: "image" as const, previewUrl: null, posterUrl: null, originalUrl: "https://cdn/1.jpg", blurhash: null, width: null, height: null, aspectRatio: null, orientation: null }],
      title: null,
      captionPreview: "c",
      firstAssetUrl: "https://cdn/1.jpg",
      media: { type: "image" as const, posterUrl: "https://cdn/1.jpg", aspectRatio: 1, startupHint: "poster_only" as const },
      social: { likeCount: 0, commentCount: 0 },
      viewer: { liked: false, saved: false },
      createdAtMs: 1,
      updatedAtMs: 1,
      appPost,
      postContractVersion: 2 as const,
      rawFirestoreAssetCount: 2,
      hasMultipleAssets: true,
      mediaCompleteness: "full" as const,
    } as unknown as FeedBootstrapCandidateRecord;
    const out = wireFeedCandidateToPostCardSummary(item, "rank-test", { route: "feed.page.get" });
    expect(out.postContractVersion).toBe(2);
    expect(out.appPost).toEqual(appPost);
    expect(out.appPostAttached).toBe(true);
    expect(out.appPostWireAssetCount).toBe(2);
    expect(out.wireDeclaredMediaAssetCount).toBe(2);
  });
});
