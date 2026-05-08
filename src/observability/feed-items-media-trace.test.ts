import { describe, expect, it } from "vitest";
import {
  buildFeedItemMediaTraceRow,
  rollupFeedCardMediaReadyCounts,
  rollupFeedVideoMediaSummary
} from "./feed-items-media-trace.js";

describe("feed-items-media-trace", () => {
  it("rollupFeedCardMediaReadyCounts distinguishes images vs video startup", () => {
    const r = rollupFeedCardMediaReadyCounts([
      {
        postId: "img1",
        media: { type: "image", posterUrl: "https://x.com/a.jpg" },
        appPostV2: {
          media: {
            assets: [
              {
                type: "image",
                image: { displayUrl: "https://x.com/d.webp", originalUrl: "https://x.com/o.jpg" }
              }
            ]
          }
        }
      },
      {
        postId: "vid1",
        media: { type: "video", posterUrl: "https://x.com/p.jpg" },
        appPostV2: {
          media: {
            assets: [
              {
                type: "video",
                video: {
                  playback: {
                    startupUrl: "https://x.com/s.mp4",
                    defaultUrl: "https://x.com/d.mp4"
                  }
                }
              }
            ]
          }
        }
      }
    ]);
    expect(r.feedCardPostCount).toBe(2);
    expect(r.feedCardImageReadyCount).toBe(1);
    expect(r.feedCardVideoStartupReadyCount).toBe(1);
    expect(r.feedCardLegacyOnlyCount).toBe(0);
    expect(r.feedCardPosterReadyCount).toBe(2);
  });

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
    expect(r.canonicalSelectedVariantCounts).toBeTruthy();
    expect(
      Object.values(r.canonicalSelectedVariantCounts as Record<string, number>).reduce((sum, value) => sum + value, 0),
    ).toBe(1);
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

  it("counts canonical playback fields as playable", () => {
    const r = rollupFeedVideoMediaSummary([
      {
        postId: "canonical-ok",
        media: { type: "video" },
        appPostV2: {
          media: {
            assets: [
              {
                type: "video",
                video: {
                  playback: {
                    startupUrl: "https://cdn.example.com/startup720_faststart_avc.mp4",
                    defaultUrl: "https://cdn.example.com/main720.mp4",
                    primaryUrl: "https://cdn.example.com/main1080.mp4",
                    posterUrl: "https://cdn.example.com/poster.jpg",
                    gradient: "#111111:#222222"
                  }
                }
              }
            ]
          }
        }
      }
    ]);
    expect(r.videoItemCount).toBe(1);
    expect(r.canonicalVideoPlayableCount).toBe(1);
    expect(r.canonicalStartupUrlCount).toBe(1);
    expect(r.canonicalPosterCount).toBe(1);
    expect(r.canonicalGradientCount).toBe(1);
    expect(
      Object.values(r.canonicalSelectedVariantCounts as Record<string, number>).reduce((sum, value) => sum + value, 0),
    ).toBe(1);
    expect(r.videoMissingPlayableCount).toBe(0);
  });
});
