import { describe, expect, it } from "vitest";
import { PostCardSummarySchema, PostDetailSchema } from "./post-entities.contract.js";

describe("post entities contracts", () => {
  it("accepts post presentation letterbox hints on card + detail payloads", () => {
    const card = PostCardSummarySchema.parse({
      postId: "post_123",
      rankToken: "rank-x",
      author: { userId: "u1", handle: "h1", name: "Name", pic: null },
      title: null,
      captionPreview: null,
      firstAssetUrl: "https://example.com/p.webp",
      media: { type: "image", posterUrl: "https://example.com/p.webp", aspectRatio: 0.75, startupHint: "poster_only" },
      social: { likeCount: 0, commentCount: 0 },
      viewer: { liked: false, saved: false },
      createdAtMs: 1,
      updatedAtMs: 1,
      carouselFitWidth: true,
      letterboxGradientTop: "#23569a",
      letterboxGradientBottom: "#5b3320",
      letterboxGradients: [{ top: "#23569a", bottom: "#5b3320" }]
    });
    expect(card.carouselFitWidth).toBe(true);
    expect(card.letterboxGradients?.length).toBe(1);

    const detail = PostDetailSchema.parse({
      postId: "post_123",
      userId: "u1",
      caption: null,
      createdAtMs: 1,
      mediaType: "image",
      thumbUrl: "https://example.com/p.webp",
      assets: [{ id: "a1", type: "image", poster: "https://example.com/p.webp", thumbnail: "https://example.com/p.webp" }],
      cardSummary: card,
      carouselFitWidth: true,
      letterboxGradientTop: "#23569a",
      letterboxGradientBottom: "#5b3320",
      letterboxGradients: [{ top: "#23569a", bottom: "#5b3320" }]
    });
    expect(detail.carouselFitWidth).toBe(true);
    expect(detail.letterboxGradientTop).toBe("#23569a");
  });
});

