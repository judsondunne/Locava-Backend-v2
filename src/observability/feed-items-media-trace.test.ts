import { describe, expect, it } from "vitest";
import {
  buildFeedItemMediaTraceRow,
  rollupFeedVideoMediaSummary
} from "./feed-items-media-trace.js";

describe("feed-items-media-trace", () => {
  it("rollup counts videos and playback fields", () => {
    const r = rollupFeedVideoMediaSummary([
      {
        postId: "a",
        media: { type: "video", posterUrl: "https://x.com/p.jpg", startupHint: "poster_then_preview" },
        playbackUrlPresent: false,
        playbackUrl: "",
        fallbackVideoUrl: "https://x.com/original.mp4",
        firstAssetUrl: null,
        mediaStatus: "processing",
        assets: [
          {
            type: "video",
            previewUrl: "https://x.com/preview360/foo.mp4",
            mp4Url: "https://x.com/main720/bar.mp4"
          }
        ]
      },
      {
        postId: "b",
        media: { type: "image", posterUrl: "https://x.com/i.jpg", aspectRatio: 1 },
        playbackUrlPresent: false
      }
    ]);
    expect(r.videoItemCount).toBe(1);
    expect(r.videoFallbackUrlNonEmpty).toBe(1);
    expect(r.videoMediaStatusProcessing).toBe(1);
    expect(r.videoCardsWithPreview360PathHint).toBe(1);
    expect(r.videoCardsWithMain720PathHint).toBe(1);
    expect(r.videoSelectedVariantCounts).toBeTruthy();
    expect((r.videoSelectedVariantCounts as { main720?: number }).main720 ?? 0).toBeGreaterThanOrEqual(0);
    expect(typeof r.videoDegradedCount).toBe("number");
    expect(typeof r.videoMissingPlayableCount).toBe("number");
  });

  it("buildFeedItemMediaTraceRow carries variant keys and tails", () => {
    const row = buildFeedItemMediaTraceRow({
      postId: "p",
      playbackUrl: "https://cdn.example.com/main720/baz.mp4",
      media: { type: "video", posterUrl: "https://cdn.example.com/p.jpg", startupHint: "poster_then_preview" },
      assets: [
        {
          id: "1",
          type: "video",
          variants: { main720Avc: "https://cdn.example.com/x.mp4", preview360: "https://cdn.example.com/p.mp4" }
        }
      ]
    });
    expect(row.postId).toBe("p");
    expect(Array.isArray((row.asset0 as { variantKeys?: string[] }).variantKeys)).toBe(true);
    expect((row.asset0 as { variantKeys?: string[] }).variantKeys).toContain("main720Avc");
    expect(Array.isArray(row.pathHintsMerged)).toBe(true);
  });
});
