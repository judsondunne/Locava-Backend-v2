/**
 * Coverage for the data-quality drift fixes that unblocked profile_grid
 * (the regression where /v2/posts/render-standardized:batch returned 0 docs
 * for 11 valid post ids because optional/mirror fields were null/wrong type
 * and Zod refused to parse them).
 *
 * Each `it` exercises one of the rejection categories that we observed in
 * production and asserts that the sanitiser plus the strict
 * `StandardizedPostDocSchema` now produce a renderable doc instead.
 */

import { describe, expect, it } from "vitest";
import { StandardizedPostDocSchema } from "../../../contracts/standardized-post-doc.contract.js";
import { standardizePostDocForRender } from "../standardize-post-doc-for-render.js";

const POST_ID = "profile_video_post_1";
const PLAYABLE_VIDEO_URL =
  "https://s3.wasabisys.com/locava.app/videos-lab/post_profile_video_post_1/video_af884066e4_0/startup720_faststart_avc.mp4";
const POSTER_URL =
  "https://s3.us-east-1.wasabisys.com/locava.app/videos/video_af884066e4_0_poster.jpg";

function baseVideoDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: POST_ID,
    postId: POST_ID,
    media: {
      assetCount: 1,
      assets: [
        {
          id: "video_af884066e4_0",
          index: 0,
          type: "video",
          video: {
            originalUrl: PLAYABLE_VIDEO_URL,
            posterUrl: POSTER_URL,
            posterHighUrl: POSTER_URL,
            thumbnailUrl: POSTER_URL,
            durationSec: 12,
            hasAudio: true,
            playback: {
              primaryUrl: PLAYABLE_VIDEO_URL,
              startupUrl: PLAYABLE_VIDEO_URL,
              goodNetworkUrl: PLAYABLE_VIDEO_URL,
              weakNetworkUrl: null,
              poorNetworkUrl: null,
              defaultUrl: PLAYABLE_VIDEO_URL,
              highQualityUrl: null,
              fallbackUrl: null,
              upgradeUrl: null,
              hlsUrl: null,
              previewUrl: null,
              selectedReason: "canonical",
            },
            variants: {
              preview360: null,
              preview360Avc: null,
              main720: null,
              main720Avc: null,
              main1080: null,
              main1080Avc: null,
              startup540Faststart: null,
              startup540FaststartAvc: null,
              startup720Faststart: null,
              startup720FaststartAvc: PLAYABLE_VIDEO_URL,
              startup1080Faststart: null,
              startup1080FaststartAvc: null,
              upgrade1080Faststart: null,
              upgrade1080FaststartAvc: null,
              hls: null,
              hlsAvcMaster: null,
            },
            readiness: {
              assetsReady: true,
              instantPlaybackReady: true,
              faststartVerified: false,
              processingStatus: "ready",
            },
            codecs: { video: "avc1", audio: "aac" },
            technical: {
              sourceCodec: "avc1",
              playbackCodec: "avc1",
              audioCodec: "aac",
              bitrateKbps: 1200,
              sizeBytes: 4567890,
              width: 720,
              height: 1280,
            },
          },
          presentation: {
            carouselFitWidth: true,
            letterboxGradient: { top: "#000000", bottom: "#000000" },
            resizeMode: "contain",
          },
          source: {
            kind: "canonical",
            legacySourcesConsidered: [],
            legacyVariantUrlsMerged: false,
            originalAssetId: "video_af884066e4_0",
            primarySources: ["render-pipeline"],
          },
        },
      ],
      assetsReady: true,
      completeness: "complete",
      cover: {
        assetId: "video_af884066e4_0",
        type: "video",
        url: POSTER_URL,
        thumbUrl: POSTER_URL,
        posterUrl: POSTER_URL,
        width: 720,
        height: 1280,
        aspectRatio: 0.5625,
        gradient: { top: "#000000", bottom: "#000000" },
      },
      coverAssetId: "video_af884066e4_0",
      hasMultipleAssets: false,
      instantPlaybackReady: true,
      presentation: { carouselFitWidth: true, resizeMode: "contain" },
      primaryAssetId: "video_af884066e4_0",
      rawAssetCount: 1,
      status: "ready",
    },
    author: {
      userId: "u1",
      displayName: "Author One",
      handle: "author1",
      profilePicUrl: "https://cdn/p.jpg",
    },
    classification: {
      activities: ["hiking"],
      primaryActivity: "hiking",
      mediaKind: "video",
      visibility: "public",
      isBoosted: false,
      reel: false,
      settingType: "outdoor",
      moderatorTier: 0,
      source: "user",
      privacyLabel: "Public Spot",
    },
    compatibility: {
      displayPhotoLink: POSTER_URL,
      mediaType: "video",
      photoLink: POSTER_URL,
      photoLinks2: null,
      photoLinks3: null,
      thumbUrl: POSTER_URL,
      posterUrl: POSTER_URL,
      fallbackVideoUrl: null,
    },
    engagement: {
      commentCount: 0,
      commentsVersion: 0,
      likeCount: 0,
      likesVersion: 0,
      saveCount: 0,
      savesVersion: 0,
      shareCount: 0,
      showComments: true,
      showLikes: true,
      viewCount: 0,
    },
    engagementPreview: { recentComments: [], recentLikers: [] },
    lifecycle: {
      createdAt: "2026-05-01T00:00:00.000Z",
      createdAtMs: 1746086400000,
      deletedAt: null,
      isDeleted: false,
      lastMediaUpdatedAt: "2026-05-01T00:00:00.000Z",
      lastUserVisibleAt: "2026-05-01T00:00:00.000Z",
      status: "active",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
    location: {
      coordinates: { geohash: "9q8yy", lat: 19.6, lng: -155.9 },
      display: { address: "Hilo, HI", label: "Hilo, HI", name: "Hilo", subtitle: "" },
      place: { placeId: null, placeName: null, precision: "city", source: "google" },
      regions: {
        city: "Hilo",
        cityRegionId: "hilo",
        country: "US",
        countryRegionId: "us",
        state: "HI",
        stateRegionId: "hi",
      },
    },
    ranking: { aggregates: {}, rollup: {} },
    schema: {
      canonicalizedAt: "2026-05-01T00:00:00.000Z",
      canonicalizedBy: "test",
      migrationRunId: null,
      name: "locava.post",
      restoreBackupDocId: "",
      restorePreviewOnly: false,
      restoreRunId: "",
      restoreSourceName: "test",
      restoredAt: "2026-05-01T00:00:00.000Z",
      restoredFromCanonicalBackup: false,
      sourceShape: "root_standardized",
      version: 2,
    },
    text: {
      title: "Mauna Kea sunrise",
      caption: "",
      description: "",
      content: "",
      searchableText: "",
    },
    ...overrides,
  };
}

function getAssetVideo(doc: Record<string, unknown>): Record<string, unknown> {
  const media = doc.media as { assets: Record<string, unknown>[] };
  return media.assets[0]!.video as Record<string, unknown>;
}

describe("standardizePostDocForRender", () => {
  it("does NOT reject when posterHighUrl is null", () => {
    const raw = baseVideoDoc();
    getAssetVideo(raw).posterHighUrl = null;
    const result = standardizePostDocForRender(raw, POST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sanitizedFields).toContain(
        "media.assets.0.video.posterHighUrl",
      );
      const parsed = StandardizedPostDocSchema.safeParse(result.doc);
      expect(parsed.success).toBe(true);
    }
  });

  it("does NOT reject when processingStatus is non-canonical (e.g. 'complete') if a playable URL exists", () => {
    const raw = baseVideoDoc();
    (getAssetVideo(raw).readiness as Record<string, unknown>).processingStatus =
      "complete";
    const result = standardizePostDocForRender(raw, POST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sanitizedFields).toContain(
        "media.assets.0.video.readiness.processingStatus",
      );
      const asset = result.doc.media.assets[0]!;
      if (asset.type === "video") {
        expect(asset.video.readiness.processingStatus).toBe("ready");
      }
    }
  });

  it("preserves processingStatus='processing' when set explicitly", () => {
    const raw = baseVideoDoc();
    (getAssetVideo(raw).readiness as Record<string, unknown>).processingStatus =
      "processing";
    const result = standardizePostDocForRender(raw, POST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const asset = result.doc.media.assets[0]!;
      if (asset.type === "video") {
        expect(asset.video.readiness.processingStatus).toBe("processing");
      }
    }
  });

  it("coerces null/invalid optional mirror fields to safe defaults (address/title/content/counts)", () => {
    const raw = baseVideoDoc({
      address: null,
      title: null,
      content: null,
      likesCount: null,
      likeCount: null,
      commentsCount: null,
      commentCount: null,
      likesVersion: null,
      commentsVersion: null,
    });
    const result = standardizePostDocForRender(raw, POST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The sanitiser tracks each path it had to coerce. We don't pin the
      // exact list (it varies as the canonical schema evolves), but every
      // mirror that was null in the input MUST be reported here.
      expect(result.sanitizedFields).toEqual(
        expect.arrayContaining([
          "address",
          "title",
          "content",
          "likesCount",
          "commentsCount",
        ]),
      );
      const parsed = StandardizedPostDocSchema.safeParse(result.doc);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.likesCount).toBe(0);
        expect(parsed.data.commentsCount).toBe(0);
        expect(parsed.data.address).toBe("Hilo, HI");
      }
    }
  });

  it("coerces invalid technical fields (width/bitrateKbps/sizeBytes) to defaults", () => {
    const raw = baseVideoDoc();
    (getAssetVideo(raw).technical as Record<string, unknown>).width = null;
    (getAssetVideo(raw).technical as Record<string, unknown>).bitrateKbps = null;
    (getAssetVideo(raw).technical as Record<string, unknown>).sizeBytes = "ten";
    (getAssetVideo(raw).technical as Record<string, unknown>).height = null;
    (getAssetVideo(raw).thumbnailUrl as unknown) = null;
    const result = standardizePostDocForRender(raw, POST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sanitizedFields).toEqual(
        expect.arrayContaining([
          "media.assets.0.video.technical.width",
          "media.assets.0.video.technical.height",
          "media.assets.0.video.thumbnailUrl",
        ]),
      );
      const parsed = StandardizedPostDocSchema.safeParse(result.doc);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        const asset = parsed.data.media.assets[0]!;
        if (asset.type === "video") {
          expect(asset.video.technical.width).toBe(640);
          expect(asset.video.technical.height).toBe(1138);
          expect(asset.video.technical.bitrateKbps).toBeNull();
          expect(asset.video.technical.sizeBytes).toBeNull();
        }
      }
    }
  });

  it("rejects only truly unrenderable docs: no media.assets", () => {
    const raw = baseVideoDoc();
    (raw.media as Record<string, unknown>).assets = [];
    const result = standardizePostDocForRender(raw, POST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["fatal_no_media_assets", "fatal_no_renderable_asset"]).toContain(
        result.reason,
      );
    }
  });

  it("rejects video with no playable URL", () => {
    const raw = baseVideoDoc();
    const playback = getAssetVideo(raw).playback as Record<string, unknown>;
    playback.startupUrl = "";
    playback.primaryUrl = "";
    playback.defaultUrl = "";
    playback.goodNetworkUrl = null;
    playback.fallbackUrl = null;
    const result = standardizePostDocForRender(raw, POST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("fatal_no_renderable_asset");
    }
  });

  it("rejects deleted lifecycle.isDeleted docs", () => {
    const raw = baseVideoDoc();
    (raw.lifecycle as Record<string, unknown>).isDeleted = true;
    const result = standardizePostDocForRender(raw, POST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("fatal_deleted");
    }
  });

  it("returns a doc that satisfies StandardizedPostDocSchema for the worst-case profile post (every mirror null + status='complete' + null technical)", () => {
    // This is the exact shape that produced rejected=11 / returned=0 in
    // production: optional mirrors are all null, processingStatus is the
    // non-canonical 'complete', and several technical numbers are null.
    const raw = baseVideoDoc({
      address: null,
      title: null,
      content: null,
      likesCount: null,
      commentsCount: null,
      likesVersion: null,
      commentsVersion: null,
      likeCount: null,
      commentCount: null,
    });
    getAssetVideo(raw).posterHighUrl = null;
    getAssetVideo(raw).thumbnailUrl = null;
    (getAssetVideo(raw).readiness as Record<string, unknown>).processingStatus =
      "complete";
    (getAssetVideo(raw).technical as Record<string, unknown>).width = null;
    (getAssetVideo(raw).technical as Record<string, unknown>).bitrateKbps = null;
    (getAssetVideo(raw).technical as Record<string, unknown>).sizeBytes = null;
    const result = standardizePostDocForRender(raw, POST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = StandardizedPostDocSchema.safeParse(result.doc);
      expect(parsed.success).toBe(true);
      // Sanitiser must have reported the exact bug-class fields.
      expect(result.sanitizedFields).toEqual(
        expect.arrayContaining([
          "address",
          "title",
          "content",
          "likesCount",
          "commentsCount",
          "media.assets.0.video.posterHighUrl",
          "media.assets.0.video.thumbnailUrl",
          "media.assets.0.video.readiness.processingStatus",
          "media.assets.0.video.technical.width",
        ]),
      );
    }
  });
});
