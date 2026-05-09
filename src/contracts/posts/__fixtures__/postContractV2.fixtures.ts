/**
 * Sample post-document fixtures for Locava canonical post contract V2.
 *
 * Two shapes are exposed:
 *   - failedAfterGenerationPendingFixture: the structurally-useful "failed but pending" shape
 *     described by the user — schema.version=2 + canonical blocks present, async video processing
 *     failed, assetsReady=false, videoProcessingStatus="failed", but playbackLab generated outputs
 *     do exist (verifies the processor_failed_after_generation hint).
 *   - successfulCompletedFixture: a fully-successful canonical v2 post — assetsReady=true,
 *     media.status="ready", playback.* point at verified fast-start AVC URLs, faststartVerified=true,
 *     compatibility.photoLinks2/3 mirror the canonical fast-start playable URL, poster fields point
 *     at the poster JPG.
 *
 * Both fixtures are pure data — no side effects.
 */

const POST_ID = "post_fixture_v2_canonical";
const VIDEO_ASSET_ID = "video_asset_v2_0";

const ORIGINAL_VIDEO =
  "https://cdn.example.com/source/video_asset_v2_0_source.mp4";
const STARTUP_720 =
  "https://s3.wasabisys.com/locava.app/videos-lab/post_fixture_v2_canonical/video_asset_v2_0/startup720_faststart_avc.mp4";
const STARTUP_540 =
  "https://s3.wasabisys.com/locava.app/videos-lab/post_fixture_v2_canonical/video_asset_v2_0/startup540_faststart_avc.mp4";
const PREVIEW_360 =
  "https://s3.wasabisys.com/locava.app/videos-lab/post_fixture_v2_canonical/video_asset_v2_0/preview360_avc.mp4";
const MAIN_720 =
  "https://s3.wasabisys.com/locava.app/videos-lab/post_fixture_v2_canonical/video_asset_v2_0/main720_avc.mp4";
const UPGRADE_1080 =
  "https://s3.wasabisys.com/locava.app/videos-lab/post_fixture_v2_canonical/video_asset_v2_0/upgrade1080_faststart_avc.mp4";
const POSTER_JPG =
  "https://s3.wasabisys.com/locava.app/videos-lab/post_fixture_v2_canonical/video_asset_v2_0/poster_high.jpg";

function baseAuthor() {
  return {
    userId: "u_test_canonical",
    handle: "fixtureuser",
    displayName: "Fixture User",
    profilePicUrl: null,
  };
}

function baseText() {
  return {
    title: "Fixture canonical post",
    caption: "Fixture canonical post",
    content: "Fixture canonical post",
    description: "Fixture canonical post",
    searchableText: "fixture canonical post",
  };
}

function baseLocation() {
  return {
    coordinates: { lat: 37.77, lng: -122.42, geohash: "9q8yyk8yt" },
    display: {
      address: "San Francisco, CA",
      name: "San Francisco, CA",
      subtitle: null,
      label: "San Francisco, CA",
    },
    place: {
      placeId: null,
      placeName: null,
      source: "manual",
      precision: "approximate",
    },
    regions: {
      city: "San Francisco",
      state: "CA",
      country: "US",
      cityRegionId: "US-CA-San-Francisco",
      stateRegionId: "US-CA",
      countryRegionId: "US",
    },
  };
}

function baseEngagement() {
  return {
    likeCount: 0,
    commentCount: 0,
    saveCount: 0,
    shareCount: 0,
    viewCount: 0,
    likesVersion: 0,
    commentsVersion: 0,
    savesVersion: 0,
    showLikes: true,
    showComments: true,
  };
}

function baseEngagementPreview() {
  return { recentLikers: [], recentComments: [] };
}

/**
 * Pending/failed canonical fixture: the post WAS instant-published with full canonical v2 layout,
 * but the async video processor failed during the cleanup phase even though the generated lab
 * outputs (startup540/720) DO exist on disk. assetsReady=false, status="failed".
 */
export function buildFailedAfterGenerationPendingFixture(): Record<string, unknown> {
  return {
    id: POST_ID,
    postId: POST_ID,
    schema: {
      name: "locava.post",
      version: 2,
      canonicalizedAt: "2026-05-09T16:00:00.000Z",
      canonicalizedBy: "posting_finalize_v2",
      sourceShape: "native_posting_v2",
      migrationRunId: null,
    },
    lifecycle: {
      status: "processing",
      isDeleted: false,
      deletedAt: null,
      createdAt: "2026-05-09T16:00:00.000Z",
      createdAtMs: 1_746_806_400_000,
      updatedAt: "2026-05-09T16:00:05.000Z",
      lastMediaUpdatedAt: "2026-05-09T16:00:05.000Z",
      lastUserVisibleAt: "2026-05-09T16:00:00.000Z",
    },
    author: baseAuthor(),
    text: baseText(),
    classification: {
      activities: ["coffee"],
      primaryActivity: "coffee",
      mediaKind: "video",
      visibility: "public",
      isBoosted: false,
      reel: false,
      settingType: "outdoor",
      moderatorTier: 0,
      source: "user",
      privacyLabel: "Public Spot",
    },
    location: baseLocation(),
    media: {
      status: "processing",
      assetsReady: false,
      instantPlaybackReady: false,
      completeness: "partial",
      assetCount: 1,
      rawAssetCount: 1,
      hasMultipleAssets: false,
      primaryAssetId: VIDEO_ASSET_ID,
      coverAssetId: VIDEO_ASSET_ID,
      assets: [
        {
          id: VIDEO_ASSET_ID,
          index: 0,
          type: "video",
          source: {
            kind: "media.assets",
            originalAssetId: VIDEO_ASSET_ID,
            primarySources: [ORIGINAL_VIDEO],
            legacySourcesConsidered: [],
            legacyVariantUrlsMerged: false,
          },
          image: null,
          video: {
            originalUrl: ORIGINAL_VIDEO,
            posterUrl: POSTER_JPG,
            posterHighUrl: POSTER_JPG,
            playback: {
              defaultUrl: ORIGINAL_VIDEO,
              primaryUrl: ORIGINAL_VIDEO,
              startupUrl: ORIGINAL_VIDEO,
              highQualityUrl: null,
              upgradeUrl: null,
              hlsUrl: null,
              fallbackUrl: ORIGINAL_VIDEO,
              previewUrl: null,
              posterUrl: POSTER_JPG,
              selectedReason: "original_unverified_fallback",
            },
            variants: null,
            durationSec: 12.5,
            hasAudio: true,
            codecs: null,
            technical: { sourceCodec: "hevc", playbackCodec: null, audioCodec: "aac" },
            bitrateKbps: null,
            sizeBytes: null,
            readiness: {
              assetsReady: false,
              instantPlaybackReady: false,
              faststartVerified: false,
              processingStatus: "failed",
            },
          },
          presentation: {
            letterboxGradient: { top: "#1f2937", bottom: "#111827" },
            carouselFitWidth: true,
            resizeMode: "contain",
          },
        },
      ],
      cover: {
        assetId: VIDEO_ASSET_ID,
        type: "video",
        url: POSTER_JPG,
        thumbUrl: POSTER_JPG,
        posterUrl: POSTER_JPG,
        width: 720,
        height: 1280,
        aspectRatio: 720 / 1280,
        gradient: { top: "#1f2937", bottom: "#111827" },
      },
    },
    engagement: baseEngagement(),
    engagementPreview: baseEngagementPreview(),
    compatibility: {
      photoLink: POSTER_JPG,
      photoLinks2: POSTER_JPG,
      photoLinks3: POSTER_JPG,
      displayPhotoLink: POSTER_JPG,
      thumbUrl: POSTER_JPG,
      posterUrl: POSTER_JPG,
      fallbackVideoUrl: ORIGINAL_VIDEO,
      mediaType: "video",
    },
    /** legacy/v1 mirror — still present during pending phase. */
    assetsReady: false,
    instantPlaybackReady: false,
    mediaStatus: "processing",
    videoProcessingStatus: "failed",
    videoProcessingFailureReason:
      "FieldValue.delete() must appear at the top-level and can only be used in update() or set() with {merge:true} (found in field videoProcessingProgress)",
    /**
     * Async pipeline created the lab outputs but the metadata cleanup write failed.
     * The audit script must classify this as `processor_failed_after_generation`, not as a
     * fully invalid post.
     */
    playbackLab: {
      status: "failed",
      lastVerifyAllOk: true,
      assets: {
        [VIDEO_ASSET_ID]: {
          status: "ready",
          generated: {
            startup540FaststartAvc: STARTUP_540,
            startup720FaststartAvc: STARTUP_720,
            posterHigh: POSTER_JPG,
          },
          lastVerifyAllOk: true,
        },
      },
    },
  };
}

/**
 * Successful completed canonical fixture: full canonical v2 + verified fast-start AVC playback +
 * compatibility.photoLinks2/3 mirror the canonical playable startup URL + poster fields are images.
 */
export function buildSuccessfulCompletedFixture(): Record<string, unknown> {
  return {
    id: POST_ID,
    postId: POST_ID,
    schema: {
      name: "locava.post",
      version: 2,
      canonicalizedAt: "2026-05-09T16:00:30.000Z",
      canonicalizedBy: "posting_finalize_v2",
      sourceShape: "native_posting_v2",
      migrationRunId: null,
    },
    lifecycle: {
      status: "active",
      isDeleted: false,
      deletedAt: null,
      createdAt: "2026-05-09T16:00:00.000Z",
      createdAtMs: 1_746_806_400_000,
      updatedAt: "2026-05-09T16:00:30.000Z",
      lastMediaUpdatedAt: "2026-05-09T16:00:30.000Z",
      lastUserVisibleAt: "2026-05-09T16:00:30.000Z",
    },
    author: baseAuthor(),
    text: baseText(),
    classification: {
      activities: ["coffee"],
      primaryActivity: "coffee",
      mediaKind: "video",
      visibility: "public",
      isBoosted: false,
      reel: false,
      settingType: "outdoor",
      moderatorTier: 0,
      source: "user",
      privacyLabel: "Public Spot",
    },
    location: baseLocation(),
    media: {
      status: "ready",
      assetsReady: true,
      instantPlaybackReady: true,
      completeness: "complete",
      assetCount: 1,
      rawAssetCount: 1,
      hasMultipleAssets: false,
      primaryAssetId: VIDEO_ASSET_ID,
      coverAssetId: VIDEO_ASSET_ID,
      assets: [
        {
          id: VIDEO_ASSET_ID,
          index: 0,
          type: "video",
          source: {
            kind: "media.assets",
            originalAssetId: VIDEO_ASSET_ID,
            primarySources: [ORIGINAL_VIDEO],
            legacySourcesConsidered: [],
            legacyVariantUrlsMerged: true,
          },
          image: null,
          video: {
            originalUrl: ORIGINAL_VIDEO,
            posterUrl: POSTER_JPG,
            posterHighUrl: POSTER_JPG,
            playback: {
              defaultUrl: STARTUP_720,
              primaryUrl: STARTUP_720,
              startupUrl: STARTUP_720,
              goodNetworkUrl: STARTUP_720,
              weakNetworkUrl: STARTUP_540,
              poorNetworkUrl: STARTUP_540,
              highQualityUrl: UPGRADE_1080,
              upgradeUrl: UPGRADE_1080,
              hlsUrl: null,
              fallbackUrl: ORIGINAL_VIDEO,
              previewUrl: PREVIEW_360,
              posterUrl: POSTER_JPG,
              selectedReason: "verified_startup_avc_faststart_720",
            },
            variants: {
              poster: POSTER_JPG,
              posterHigh: POSTER_JPG,
              startup540FaststartAvc: STARTUP_540,
              startup720FaststartAvc: STARTUP_720,
              startup1080FaststartAvc: null,
              upgrade1080FaststartAvc: UPGRADE_1080,
              preview360: PREVIEW_360,
              preview360Avc: PREVIEW_360,
              main720: MAIN_720,
              main720Avc: MAIN_720,
              main1080: null,
              main1080Avc: null,
              hls: null,
              startup540Faststart: STARTUP_540,
              startup720Faststart: STARTUP_720,
              startup1080Faststart: null,
              upgrade1080Faststart: UPGRADE_1080,
              hlsAvcMaster: null,
            },
            durationSec: 12.5,
            hasAudio: true,
            codecs: null,
            technical: { sourceCodec: "hevc", playbackCodec: "h264", audioCodec: "aac" },
            bitrateKbps: 4500,
            sizeBytes: 7_000_000,
            readiness: {
              assetsReady: true,
              instantPlaybackReady: true,
              faststartVerified: true,
              processingStatus: "completed",
            },
          },
          presentation: {
            letterboxGradient: { top: "#1f2937", bottom: "#111827" },
            carouselFitWidth: true,
            resizeMode: "contain",
          },
        },
      ],
      cover: {
        assetId: VIDEO_ASSET_ID,
        type: "video",
        url: POSTER_JPG,
        thumbUrl: POSTER_JPG,
        posterUrl: POSTER_JPG,
        width: 720,
        height: 1280,
        aspectRatio: 720 / 1280,
        gradient: { top: "#1f2937", bottom: "#111827" },
      },
    },
    engagement: baseEngagement(),
    engagementPreview: baseEngagementPreview(),
    compatibility: {
      photoLink: POSTER_JPG,
      /** photoLinks2/3 mirror the canonical fast-start playable URL for legacy readers. */
      photoLinks2: STARTUP_720,
      photoLinks3: STARTUP_720,
      displayPhotoLink: POSTER_JPG,
      thumbUrl: POSTER_JPG,
      posterUrl: POSTER_JPG,
      fallbackVideoUrl: ORIGINAL_VIDEO,
      mediaType: "video",
    },
    /** Legacy mirrors stay synchronized for v1 readers. */
    assetsReady: true,
    instantPlaybackReady: true,
    mediaStatus: "ready",
    videoProcessingStatus: "completed",
    posterUrl: POSTER_JPG,
    fallbackVideoUrl: ORIGINAL_VIDEO,
    photoLinks2: STARTUP_720,
    photoLinks3: STARTUP_720,
    legacy: {
      photoLink: POSTER_JPG,
      photoLinks2: STARTUP_720,
      photoLinks3: STARTUP_720,
      thumbUrl: POSTER_JPG,
      posterUrl: POSTER_JPG,
      displayPhotoLink: POSTER_JPG,
      fallbackVideoUrl: ORIGINAL_VIDEO,
    },
  };
}

export const FIXTURE_URLS = {
  POST_ID,
  VIDEO_ASSET_ID,
  ORIGINAL_VIDEO,
  STARTUP_720,
  STARTUP_540,
  PREVIEW_360,
  MAIN_720,
  UPGRADE_1080,
  POSTER_JPG,
} as const;
