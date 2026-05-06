import { describe, expect, it } from "vitest";
import { mediaUrlSanityCheckOnSavedCompactPost } from "./savedCompactPostHealth.js";

describe("mediaUrlSanityCheckOnSavedCompactPost", () => {
  it("passes for compact image post with media.cover and nested image URLs", () => {
    const saved = {
      classification: { mediaKind: "image" },
      mediaType: "photo",
      compatibility: { photoLink: "https://cdn.example/compat.jpg" },
      media: {
        cover: { url: "https://cdn.example/cover.jpg", thumbUrl: "https://cdn.example/thumb.jpg" },
        assets: [
          {
            id: "a1",
            type: "image",
            image: {
              displayUrl: "https://cdn.example/d.jpg",
              originalUrl: "https://cdn.example/o.jpg",
              thumbnailUrl: "https://cdn.example/t.jpg"
            }
          }
        ]
      }
    };
    const r = mediaUrlSanityCheckOnSavedCompactPost(saved);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("accepts top-level photoLink / displayPhotoLink / thumbUrl as cover fallback", () => {
    const saved = {
      classification: { mediaKind: "image" },
      photoLink: "https://cdn.example/top.jpg",
      media: {
        cover: {},
        assets: [
          {
            id: "a1",
            type: "image",
            image: { displayUrl: "https://cdn.example/d.jpg", originalUrl: "", thumbnailUrl: "" }
          }
        ]
      }
    };
    expect(mediaUrlSanityCheckOnSavedCompactPost(saved).ok).toBe(true);
  });
});
