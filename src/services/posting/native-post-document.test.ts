import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { assemblePostAssetsFromStagedItems } from "./assemblePostAssets.js";
import { buildNativePostDocument, validateNativePostDocumentForWrite } from "./buildPostDocument.js";

describe("native post document (finalize parity)", () => {
  const nowTs = Timestamp.fromMillis(1_777_333_000_000);
  const baseInput = {
    postId: "post_fixture_abc",
    effectiveUserId: "user_1",
    viewerId: "user_1",
    sessionId: "ups_1",
    stagedSessionId: "ps_1",
    idempotencyKey: "idem",
    nowMs: 1_777_333_000_000,
    nowTs,
    user: { handle: "h", name: "N", profilePic: "https://cdn.example.com/p.jpg" },
    title: "T",
    content: "C",
    activities: ["hike"],
    lat: 40.7,
    lng: -75.2,
    address: "Easton, Pennsylvania",
    privacy: "Public Spot",
    tags: [] as Array<Record<string, unknown>>,
    texts: [] as unknown[],
    recordings: [] as unknown[],
    geo: {
      cityRegionId: "US-Pennsylvania-Easton",
      stateRegionId: "US-Pennsylvania",
      countryRegionId: "US",
      geohash: "dr4e3x",
      geoData: { country: "United States", state: "Pennsylvania", city: "Easton" },
      addressDisplayName: "Easton, Pennsylvania",
      locationDisplayName: "Easton, Pennsylvania",
      fallbackPrecision: "address" as const,
      reverseGeocodeStatus: "resolved" as const,
      source: "manual" as const
    }
  };

  it("builds a photo post with no fake variants and assetsReady only when image is public-ready", () => {
    const assembled = assemblePostAssetsFromStagedItems("post_fixture_abc", [
      {
        index: 0,
        assetType: "photo",
        assetId: "image_x_0",
        originalUrl: "https://cdn.example.com/original.jpg",
        imagePublicReady: true
      }
    ]);
    const doc = buildNativePostDocument({ ...baseInput, assembled });
    validateNativePostDocumentForWrite(doc);
    expect(doc.assetsReady).toBe(true);
    expect(doc.mediaType).toBe("image");
    expect(doc.videoProcessingStatus).toBeUndefined();
    const v = (doc.assets as { variants: Record<string, unknown> }[])[0]?.variants ?? {};
    expect(Object.keys(v)).toHaveLength(0);
  });

  it("builds a video post without fake processed variants and with pending playback readiness", () => {
    const assembled = assemblePostAssetsFromStagedItems("post_fixture_vid", [
      {
        index: 0,
        assetType: "video",
        assetId: "video_x_0",
        originalUrl: "https://cdn.example.com/full.mp4",
        posterUrl: "https://cdn.example.com/poster.jpg"
      }
    ]);
    const doc = buildNativePostDocument({ ...baseInput, postId: "post_fixture_vid", assembled });
    validateNativePostDocumentForWrite(doc);
    expect(doc.assetsReady).toBe(false);
    expect(doc.instantPlaybackReady).toBe(false);
    expect(doc.mediaType).toBe("video");
    expect(doc.videoProcessingStatus).toBe("pending");
    const asset = (doc.assets as Record<string, unknown>[])[0] as {
      variants: Record<string, string>;
      original: string;
    };
    expect(asset.variants.main720).toBeUndefined();
    expect(asset.variants.main720Avc).toBeUndefined();
    expect(asset.variants.poster).toBe("https://cdn.example.com/poster.jpg");
    expect(doc.playbackLabStatus).toBe("queued");
  });

  it("writes explicit carousel + letterbox gradient overrides when provided", () => {
    const assembled = assemblePostAssetsFromStagedItems("post_fixture_grad", [
      {
        index: 0,
        assetType: "photo",
        assetId: "image_g_0",
        originalUrl: "https://cdn.example.com/original.jpg",
        imagePublicReady: true
      }
    ]);
    const doc = buildNativePostDocument({
      ...baseInput,
      postId: "post_fixture_grad",
      assembled,
      carouselFitWidth: false,
      letterboxGradients: [{ top: "#23569a", bottom: "#5b3320" }]
    });
    expect(doc.carouselFitWidth).toBe(false);
    expect(doc.letterboxGradients).toEqual([{ top: "#23569a", bottom: "#5b3320" }]);
  });

  it("rejects staging URLs in manifest", () => {
    expect(() =>
      assemblePostAssetsFromStagedItems("post_x", [
        {
          index: 0,
          assetType: "video",
          originalUrl: "https://x.com/postSessionStaging/foo.mp4",
          posterUrl: "https://x.com/p.jpg"
        }
      ])
    ).toThrow(/publish_staging_url_not_promoted/);
  });

  it("keeps photo post in processing when no public image URL is confirmed", () => {
    const assembled = assemblePostAssetsFromStagedItems("post_fixture_pending", [
      {
        index: 0,
        assetType: "photo",
        assetId: "image_pending_0",
        imagePublicReady: false
      }
    ]);
    const doc = buildNativePostDocument({ ...baseInput, postId: "post_fixture_pending", assembled });
    expect(doc.assetsReady).toBe(false);
    expect(doc.mediaStatus).toBe("processing");
    expect(doc.displayPhotoLink).toBeNull();
  });
});
