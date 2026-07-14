import { describe, expect, it } from "vitest";
import { isEligibleReelTemplateSource } from "./reel-templates.eligibility.js";

function readyReel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reel: true,
    mediaStatus: "ready",
    assetsReady: true,
    posterReady: true,
    posterPresent: true,
    posterUrl: "https://cdn.example.com/poster.jpg",
    videoProcessingStatus: "completed",
    lifecycle: { status: "active" },
    assets: [
      {
        type: "video",
        original: "https://cdn.example.com/video.mp4",
        poster: "https://cdn.example.com/poster.jpg"
      }
    ],
    ...overrides
  };
}

describe("isEligibleReelTemplateSource", () => {
  it("accepts ready reels with https posters", () => {
    expect(isEligibleReelTemplateSource(readyReel())).toBe(true);
  });

  it("rejects processing / failed mediaStatus", () => {
    expect(isEligibleReelTemplateSource(readyReel({ mediaStatus: "processing" }))).toBe(false);
    expect(isEligibleReelTemplateSource(readyReel({ mediaStatus: "failed" }))).toBe(false);
  });

  it("rejects pending / failed video processing", () => {
    expect(isEligibleReelTemplateSource(readyReel({ videoProcessingStatus: "pending" }))).toBe(
      false
    );
    expect(isEligibleReelTemplateSource(readyReel({ videoProcessingStatus: "failed" }))).toBe(
      false
    );
  });

  it("rejects assetsReady=false and empty posters", () => {
    expect(isEligibleReelTemplateSource(readyReel({ assetsReady: false }))).toBe(false);
    expect(
      isEligibleReelTemplateSource(
        readyReel({
          posterUrl: "",
          displayPhotoLink: "",
          thumbUrl: "",
          assets: [{ type: "video", original: "https://cdn.example.com/v.mp4", poster: "" }]
        })
      )
    ).toBe(false);
  });

  it("rejects processing / failed / deleted lifecycle", () => {
    expect(
      isEligibleReelTemplateSource(readyReel({ lifecycle: { status: "processing" } }))
    ).toBe(false);
    expect(isEligibleReelTemplateSource(readyReel({ lifecycle: { status: "failed" } }))).toBe(
      false
    );
    expect(isEligibleReelTemplateSource(readyReel({ lifecycle: { status: "deleted" } }))).toBe(
      false
    );
  });
});
