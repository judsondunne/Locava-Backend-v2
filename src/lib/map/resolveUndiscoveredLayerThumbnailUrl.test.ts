import { describe, expect, it } from "vitest";
import { resolveUndiscoveredLayerThumbnailUrl } from "./resolveUndiscoveredLayerThumbnailUrl.js";

describe("resolveUndiscoveredLayerThumbnailUrl", () => {
  it("prefers cached photoSearch thumbnail", () => {
    const url = resolveUndiscoveredLayerThumbnailUrl({
      photoSearch: {
        results: [{ thumbnailUrl: "https://cdn.example.com/search.jpg" }],
      },
      displayPhotoLink: "https://cdn.example.com/display.jpg",
    });
    expect(url).toBe("https://cdn.example.com/search.jpg");
  });

  it("falls back to displayPhotoLink and thumbUrl", () => {
    expect(
      resolveUndiscoveredLayerThumbnailUrl({
        displayPhotoLink: "https://cdn.example.com/display.jpg",
      }),
    ).toBe("https://cdn.example.com/display.jpg");
    expect(
      resolveUndiscoveredLayerThumbnailUrl({
        thumbUrl: "https://cdn.example.com/thumb.jpg",
      }),
    ).toBe("https://cdn.example.com/thumb.jpg");
  });

  it("reads media posterUrl", () => {
    expect(
      resolveUndiscoveredLayerThumbnailUrl({
        media: [{ posterUrl: "https://cdn.example.com/poster.jpg" }],
      }),
    ).toBe("https://cdn.example.com/poster.jpg");
  });

  it("returns undefined when no usable url", () => {
    expect(resolveUndiscoveredLayerThumbnailUrl({})).toBeUndefined();
    expect(
      resolveUndiscoveredLayerThumbnailUrl({ displayPhotoLink: "not-a-url" }),
    ).toBeUndefined();
  });
});
