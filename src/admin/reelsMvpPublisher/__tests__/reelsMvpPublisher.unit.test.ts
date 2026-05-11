import { describe, expect, it } from "vitest";
import { buildReelsMvpNativeSkeleton, defaultVideoAssetId, deterministicPostIdForStage } from "../buildReelsMvpNativeSkeleton.js";
import type { NativePostGeoBlock, NativePostUserSnapshot } from "../../../services/posting/buildPostDocument.js";
import { validatePublishedReelPostDoc } from "../validatePublishedReelPost.js";
import { validateDraftMedia, validateStagedContract } from "../reelsMvpPublisher.service.js";

describe("reels mvp publisher id + manifest", () => {
  it("uses deterministic post id for stage id", () => {
    expect(deterministicPostIdForStage("abc")).toBe(deterministicPostIdForStage("abc"));
    expect(deterministicPostIdForStage("abc")).not.toBe(deterministicPostIdForStage("def"));
  });

  it("reuses manifest asset id override", () => {
    const geo: NativePostGeoBlock = {
      cityRegionId: null,
      stateRegionId: null,
      countryRegionId: null,
      geohash: "dr5reg",
      geoData: { country: null, state: null, city: null },
      addressDisplayName: "",
      locationDisplayName: "",
      fallbackPrecision: "coordinates",
      reverseGeocodeStatus: "failed",
      source: "unknown"
    };
    const author: NativePostUserSnapshot = { handle: "h", name: "N", profilePic: "https://example.com/p.jpg" };
    const sk1 = buildReelsMvpNativeSkeleton({
      stageId: "1778423295613_o6h019um",
      doc: { reviewState: "ready" },
      draft: {
        title: "T",
        activities: ["hike"],
        posterUid: "u1",
        lat: 40,
        lng: -74
      },
      media: {
        originalUrl: "https://cdn.example.com/original.mp4",
        posterUrl: "https://cdn.example.com/poster.jpg"
      },
      moderatorTier: 2,
      author,
      geo,
      assetIdOverride: "video_custom_0"
    });
    expect(sk1.assetId).toBe("video_custom_0");
    const sk2 = buildReelsMvpNativeSkeleton({
      stageId: "1778423295613_o6h019um",
      doc: { reviewState: "ready" },
      draft: {
        title: "T",
        activities: ["hike"],
        posterUid: "u1",
        lat: 40,
        lng: -74
      },
      media: {
        originalUrl: "https://cdn.example.com/original.mp4",
        posterUrl: "https://cdn.example.com/poster.jpg"
      },
      moderatorTier: 2,
      author,
      geo
    });
    expect(sk2.assetId).toBe("video_1778423295613_0");
    expect(defaultVideoAssetId("1778423295613_o6h019um")).toBe("video_1778423295613_0");
  });
});

describe("validatePublishedReelPostDoc", () => {
  it("flags missing title in canonical path indirectly via empty", () => {
    const canonical = {
      id: "post_x",
      schema: {
        name: "locava.post" as const,
        version: 2,
        canonicalizedAt: new Date().toISOString(),
        canonicalizedBy: "posting_finalize_v2" as const,
        sourceShape: "native_posting_v2" as const,
        migrationRunId: null
      },
      lifecycle: {
        status: "active" as const,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdAtMs: Date.now(),
        lastUserVisibleAt: new Date().toISOString()
      },
      author: { userId: "u", displayName: "a", handle: "h", profilePicUrl: "https://x/p.jpg" },
      text: { title: "", caption: "", description: "", content: "", searchableText: "" },
      location: {
        coordinates: { lat: 1, lng: 2, geohash: "ab" },
        display: { address: null, name: null, subtitle: null, label: null },
        place: { placeId: null, placeName: null, source: "unknown" as const, precision: "unknown" as const },
        regions: { city: null, state: null, country: null, cityRegionId: null, stateRegionId: null, countryRegionId: null }
      },
      classification: {
        activities: ["x"],
        primaryActivity: "x",
        mediaKind: "video" as const,
        visibility: "public" as const,
        isBoosted: false,
        reel: true,
        settingType: "outdoor",
        moderatorTier: 1,
        source: "unknown" as const,
        privacyLabel: "Public Spot"
      },
      media: {
        status: "ready" as const,
        assetsReady: true,
        instantPlaybackReady: true,
        completeness: "complete" as const,
        assetCount: 1,
        rawAssetCount: 1,
        hasMultipleAssets: false,
        primaryAssetId: "a1",
        coverAssetId: "a1",
        assets: [],
        cover: {
          assetId: "a1",
          type: "video" as const,
          url: null,
          thumbUrl: null,
          posterUrl: "https://p.jpg",
          width: null,
          height: null,
          aspectRatio: null,
          gradient: null
        },
        presentation: null
      },
      engagement: {
        likeCount: 0,
        commentCount: 0,
        saveCount: 0,
        shareCount: 0,
        viewCount: 0,
        likesVersion: 0,
        commentsVersion: 0,
        savesVersion: 0,
        showLikes: true,
        showComments: true
      },
      engagementPreview: { recentLikers: [], recentComments: [] },
      ranking: { aggregates: null, rollup: null },
      compatibility: {} as never,
      legacy: {} as never,
      audit: {
        canonicalValidationStatus: "invalid" as const,
        warnings: [],
        errors: [],
        rebuiltFromRawAt: null,
        reversible: false,
        backupDocPath: null
      }
    };
    const r = validatePublishedReelPostDoc({
      postId: "post_x",
      compactLive: { id: "post_x" } as Record<string, unknown>,
      canonical: canonical as never
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("canonical"))).toBe(true);
  });
});

describe("draft + staged validators", () => {
  it("rejects missing author and media fields", () => {
    expect(validateDraftMedia({}, {}).length).toBeGreaterThan(0);
    expect(
      validateStagedContract({
        doc: { type: "reelsMvpAsset", status: "staged", reviewState: "staged" },
        requireReady: true
      }).length,
    ).toBeGreaterThan(0);
  });
});
