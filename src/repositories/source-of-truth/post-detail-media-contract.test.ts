import { describe, expect, it } from "vitest";
import { __testNormalizeFeedDetailAssetsFromPostData } from "./feed-detail-firestore.adapter.js";

describe("post detail media contract serializer", () => {
  it("hydrates full canonical media.assets from firestore raw media object", () => {
    const assets = __testNormalizeFeedDetailAssetsFromPostData({
      postId: "K2ggUUCJuHe8d402tkrU",
      mediaType: "image",
      thumbUrl: "https://cdn/thumb.webp",
      postData: {
        media: {
          assetCount: 8,
          assets: Array.from({ length: 8 }, (_, i) => ({
            id: `image_${i}`,
            type: "image",
            image: {
              displayUrl: `https://cdn/display_${i}.webp`,
              originalUrl: `https://cdn/original_${i}.jpg`,
              thumbnailUrl: `https://cdn/thumb_${i}.webp`,
              width: 4284,
              height: 5712,
              aspectRatio: 0.75,
            },
          })),
        },
      },
    });
    expect(assets).toHaveLength(8);
    expect(assets.every((a) => a.type === "image")).toBe(true);
    expect(assets[0]?.original).toContain("original_0");
  });
});

