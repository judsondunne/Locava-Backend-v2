import { describe, expect, it } from "vitest";
import { resolveMarkerThumbnailUrl } from "./map-markers-firestore.adapter.js";

describe("resolveMarkerThumbnailUrl", () => {
  it("prefers displayPhotoLink over photoLink", () => {
    expect(
      resolveMarkerThumbnailUrl({
        displayPhotoLink: "https://cdn.example.com/display.jpg",
        photoLink: "https://cdn.example.com/photo.jpg",
        thumbUrl: "https://cdn.example.com/thumb.jpg",
      }),
    ).toBe("https://cdn.example.com/display.jpg");
  });

  it("skips video URLs and falls back to asset poster", () => {
    expect(
      resolveMarkerThumbnailUrl({
        photoLink: "https://cdn.example.com/clip.mp4",
        assets: [
          {
            video: {
              posterUrl: "https://cdn.example.com/poster.jpg",
            },
          },
        ],
      }),
    ).toBe("https://cdn.example.com/poster.jpg");
  });

  it("picks first non-video token from comma-separated photoLink", () => {
    expect(
      resolveMarkerThumbnailUrl({
        photoLink: "https://cdn.example.com/a.mp4, https://cdn.example.com/b.jpg",
      }),
    ).toBe("https://cdn.example.com/b.jpg");
  });

  it("returns null when only video URLs exist", () => {
    expect(
      resolveMarkerThumbnailUrl({
        thumbUrl: "https://cdn.example.com/clip.m3u8",
        photoLink: "https://cdn.example.com/clip.mp4",
      }),
    ).toBeNull();
  });
});
