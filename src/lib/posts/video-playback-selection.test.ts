import { describe, expect, it } from "vitest";
import {
  playbackBatchCarouselIncompleteMedia,
  playbackBatchNeedsPhotoCarouselFirestoreDetail,
  playbackBatchShouldFetchFirestoreDetail,
  resolveBestVideoPlaybackMedia,
  selectBestVideoPlaybackAsset,
} from "./video-playback-selection.js";

describe("selectBestVideoPlaybackAsset", () => {
  it("prefers HLS over MP4 ladders when adaptive manifest exists", () => {
    const sel = selectBestVideoPlaybackAsset(
      {
        mediaType: "video",
        assetsReady: true,
        assets: [
          {
            type: "video",
            id: "v1",
            original: "https://cdn/original.mp4",
            poster: "https://cdn/p.jpg",
            variants: {
              preview360: "https://cdn/p360.mp4",
              main720Avc: "https://cdn/m720.mp4",
              main1080Avc: "https://cdn/m1080.mp4",
              hls: "https://cdn/m.m3u8",
            },
          },
        ],
      },
      { hydrationMode: "playback", allowPreviewOnly: true },
    );
    expect(sel.playbackUrl).toBe("https://cdn/m.m3u8");
    expect(sel.selectedVariantLabel).toBe("hls");
    expect(sel.productionPlaybackSelected).toBe(true);
    expect(sel.isPreviewOnly).toBe(false);
  });

  it("prefers main1080Avc over preview360 when both exist without HLS", () => {
    const sel = selectBestVideoPlaybackAsset(
      {
        mediaType: "video",
        assetsReady: true,
        assets: [
          {
            type: "video",
            id: "v1",
            original: "https://cdn/original.mp4",
            poster: "https://cdn/p.jpg",
            variants: {
              preview360: "https://cdn/p360.mp4",
              main720Avc: "https://cdn/m720.mp4",
              main1080Avc: "https://cdn/m1080.mp4",
            },
          },
        ],
      },
      { hydrationMode: "playback", allowPreviewOnly: true },
    );
    expect(sel.playbackUrl).toBe("https://cdn/m1080.mp4");
    expect(sel.selectedVariantLabel).toBe("main1080Avc");
    expect(sel.productionPlaybackSelected).toBe(true);
    expect(sel.isPreviewOnly).toBe(false);
  });

  it("card hydration may resolve preview but playback intent still marks preview-only", () => {
    const sel = selectBestVideoPlaybackAsset(
      {
        mediaType: "video",
        assets: [
          {
            type: "video",
            id: "v1",
            original: "https://cdn/original.mp4",
            variants: { preview360: "https://cdn/p360.mp4" },
          },
        ],
      },
      { hydrationMode: "card", allowPreviewOnly: true },
    );
    expect(sel.playbackUrl).toBe("https://cdn/p360.mp4");
    expect(sel.isPreviewOnly).toBe(true);
    expect(sel.productionPlaybackSelected).toBe(false);
  });

  it("defers HEVC main1080 when AVC siblings exist", () => {
    const sel = selectBestVideoPlaybackAsset(
      {
        mediaType: "video",
        assetsReady: true,
        assets: [
          {
            type: "video",
            id: "v1",
            original: "https://cdn/original.mp4",
            variantMetadata: {
              main1080: { codec: "hevc" },
            },
            variants: {
              main1080: "https://cdn/m1080_hevc.mp4",
              main720Avc: "https://cdn/m720_avc.mp4",
            },
          },
        ],
      },
      { hydrationMode: "playback", allowPreviewOnly: true },
    );
    expect(sel.playbackUrl).toBe("https://cdn/m720_avc.mp4");
    expect(sel.selectedVariantLabel).toBe("main720Avc");
  });

  it("falls back to original MP4-only aliases without claiming ladder tiers", () => {
    const orig = "https://cdn/original.mp4";
    const sel = selectBestVideoPlaybackAsset(
      {
        mediaType: "video",
        assetsReady: true,
        videoProcessingStatus: "completed",
        assets: [
          {
            type: "video",
            id: "v1",
            original: orig,
            variants: {
              main720: orig,
              main720Avc: orig,
              preview360Avc: orig,
            },
          },
        ],
      },
      { hydrationMode: "detail", allowPreviewOnly: true },
    );
    /** Original uploads remain playable once ladder aliases are suppressed as duplicates. */
    expect(sel.productionPlaybackSelected).toBe(true);
    expect(sel.playbackUrl).toBe(orig);
    expect(sel.selectedVariantLabel).toBe("original");
  });

  it("photo-shaped posts are ignored by batch fetch gate", () => {
    expect(
      playbackBatchShouldFetchFirestoreDetail({
        mediaType: "image",
        assets: [{ type: "image", id: "i1", original: "https://cdn/a.jpg", poster: "https://cdn/a.jpg", thumbnail: "https://cdn/a.jpg" }],
      }),
    ).toBe(false);
  });
});

describe("playbackBatchShouldFetchFirestoreDetail", () => {
  it("returns true for preview-only playable URLs", () => {
    expect(
      playbackBatchShouldFetchFirestoreDetail({
        mediaType: "video",
        thumbUrl: "https://cdn/p.jpg",
        assets: [
          {
            type: "video",
            id: "v1",
            poster: "https://cdn/p.jpg",
            variants: { preview360: "https://cdn/p360.mp4" },
          },
        ],
      }),
    ).toBe(true);
  });

  it("returns false when production MP4 is already on the shell and assetsReady", () => {
    expect(
      playbackBatchShouldFetchFirestoreDetail({
        mediaType: "video",
        assetsReady: true,
        assets: [
          {
            type: "video",
            id: "v1",
            variants: { main720Avc: "https://cdn/m720.mp4" },
          },
        ],
      }),
    ).toBe(false);
  });

  it("returns false once a ladder URL exists on-shell even while assetsReady is false", () => {
    expect(
      playbackBatchShouldFetchFirestoreDetail({
        mediaType: "video",
        assetsReady: false,
        videoProcessingStatus: "processing",
        assets: [
          {
            type: "video",
            id: "v1",
            original: "https://cdn/original.mp4",
            variants: { main720Avc: "https://cdn/main720_clean.mp4" },
          },
        ],
      }),
    ).toBe(false);
  });

  it("returns true while only preview-tier bytes are surfaced for a video clip", () => {
    expect(
      playbackBatchShouldFetchFirestoreDetail({
        mediaType: "video",
        assetsReady: false,
        assets: [
          {
            type: "video",
            id: "v1",
            original: "https://cdn/original.mp4",
            variants: { preview360Avc: "https://cdn/preview_only.mp4" },
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("playbackBatchNeedsPhotoCarouselFirestoreDetail / playbackBatchCarouselIncompleteMedia", () => {
  it("returns false for a lone image postcard without multiplicity hints", () => {
    expect(
      playbackBatchNeedsPhotoCarouselFirestoreDetail({
        mediaType: "image",
        assets: [{ type: "image", id: "i1", original: "https://cdn/a.jpg" }],
      }),
    ).toBe(false);
  });

  it("returns true when one slim row contradicts canonical assetCount", () => {
    expect(
      playbackBatchNeedsPhotoCarouselFirestoreDetail({
        mediaType: "image",
        assetCount: 4,
        assets: [{ type: "image", id: "i1", original: "https://cdn/a.jpg" }],
      }),
    ).toBe(true);
  });

  it("returns false once multiple distinct image assets exist on-shell", () => {
    expect(
      playbackBatchNeedsPhotoCarouselFirestoreDetail({
        mediaType: "image",
        assets: [
          { type: "image", id: "i1", original: "https://cdn/a.jpg" },
          { type: "image", id: "i2", original: "https://cdn/b.jpg" },
        ],
      }),
    ).toBe(false);
  });

  it("returns true when assetCount implies a gallery larger than slim assets[]", () => {
    expect(
      playbackBatchCarouselIncompleteMedia({
        mediaType: "image",
        assetCount: 4,
        assets: [{ type: "image", id: "i1", original: "https://cdn/a.jpg" }],
      }),
    ).toBe(true);
  });

  it("returns true when rawFirestoreAssetCount exceeds on-shell assets[]", () => {
    expect(
      playbackBatchCarouselIncompleteMedia({
        mediaType: "image",
        assets: [{ type: "image", id: "i1", original: "https://cdn/a.jpg" }],
        rawFirestoreAssetCount: 3,
      }),
    ).toBe(true);
  });

  it("returns true when postcard marks requiresAssetHydration", () => {
    expect(
      playbackBatchCarouselIncompleteMedia({
        mediaType: "image",
        assets: [{ type: "image", id: "i1", original: "https://cdn/a.jpg" }],
        requiresAssetHydration: true,
      }),
    ).toBe(true);
  });

  it("returns true when cardSummary.photoLink lists multiple HTTPS URLs while assets holds one row", () => {
    expect(
      playbackBatchCarouselIncompleteMedia({
        mediaType: "image",
        cardSummary: {
          photoLink:
            "https://cdn/a.webp,https://cdn/b.webp,https://cdn/c.webp",
        },
        assets: [{ type: "image", id: "i1", original: "https://cdn/a.jpg" }],
      }),
    ).toBe(true);
  });

  it("returns true when several rows fingerprint to the same still URL", () => {
    expect(
      playbackBatchCarouselIncompleteMedia({
        mediaType: "image",
        assets: [
          { type: "image", id: "i1", original: "https://cdn/a.jpg", poster: "https://cdn/a.jpg" },
          { type: "image", id: "i2", original: "https://cdn/a.jpg", poster: "https://cdn/a.jpg" },
        ],
      }),
    ).toBe(true);
  });

  it("delegates carousel decision through playbackBatchNeedsPhotoCarouselFirestoreDetail", () => {
    expect(playbackBatchNeedsPhotoCarouselFirestoreDetail({ mediaType: "image", assets: [{ type: "image", id: "x" }] })).toBe(
      playbackBatchCarouselIncompleteMedia({ mediaType: "image", assets: [{ type: "image", id: "x" }] }),
    );
  });
});

describe("resolveBestVideoPlaybackMedia (parity)", () => {
  it("mirrors canonical selection helper", () => {
    expect(
      resolveBestVideoPlaybackMedia(
        {
          mediaType: "video",
          assets: [{ type: "video", id: "v1", variants: { main720Avc: "https://cdn/m.mp4" } }],
        },
        { hydrationMode: "playback" },
      ).playbackUrl,
    ).toBe("https://cdn/m.mp4");
  });
});

describe("video playback regressions — representative docs", () => {
  it("Case A/B: prefers HLS when present with ladders", () => {
    const doc = {
      mediaType: "video",
      assetsReady: true,
      assets: [
        {
          type: "video",
          id: "v1",
          variants: {
            preview360: "https://x/p.mp4",
            main720Avc: "https://x/720.mp4",
            main1080Avc: "https://x/1080.mp4",
            hls: "https://x/m.m3u8",
          },
        },
      ],
    };
    const sel = selectBestVideoPlaybackAsset(doc, { hydrationMode: "playback", allowPreviewOnly: true });
    expect(sel.playbackUrl).toBe("https://x/m.m3u8");
    expect(sel.selectedVideoVariant).toBe("hls");
  });

  it("Case C: processing + original playable while assetsReady=false", () => {
    const doc = {
      mediaType: "video",
      assetsReady: false,
      videoProcessingStatus: "processing",
      posterUrl: "https://x/p.jpg",
      playbackUrlPresent: false,
      assets: [
        {
          type: "video",
          id: "v1",
          poster: "https://x/p.jpg",
          original: "https://x/orig.mp4",
          variants: {},
        },
      ],
    };
    const sel = selectBestVideoPlaybackAsset(doc, { hydrationMode: "detail", allowPreviewOnly: true });
    expect(sel.playbackUrl).toBe("https://x/orig.mp4");
    expect(sel.selectedVideoVariant).toBe("original");
    expect(sel.productionPlaybackSelected).toBe(true);
    expect(sel.mediaStatusHint).toBe("processing");
  });

  it("Case E: cache preview360 loses to real main720 on same synthetic doc", () => {
    const doc = {
      mediaType: "video",
      assets: [
        {
          type: "video",
          id: "v1",
          variants: {
            preview360Avc: "https://old/p.mp4",
            main720Avc: "https://new/720.mp4",
          },
        },
      ],
    };
    expect(selectBestVideoPlaybackAsset(doc, { hydrationMode: "playback", allowPreviewOnly: true }).playbackUrl).toBe(
      "https://new/720.mp4",
    );
  });

  it("Case F image-only unaffected", () => {
    expect(
      selectBestVideoPlaybackAsset({ mediaType: "image", assets: [] }, {
        hydrationMode: "playback",
        allowPreviewOnly: true,
      }).selectedVideoVariant,
    ).toBe("none");
  });
});
