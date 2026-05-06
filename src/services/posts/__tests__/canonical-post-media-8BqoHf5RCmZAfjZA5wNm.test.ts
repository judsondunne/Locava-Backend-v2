import { describe, expect, it } from "vitest";
import { serializeCanonicalPost } from "../serializeCanonicalPost.js";
import { resolveCanonicalPostMedia } from "../resolveCanonicalPostMedia.js";

const POST_ID = "8BqoHf5RCmZAfjZA5wNm";
const STARTUP_720 =
  "https://s3.wasabisys.com/locava.app/videos-lab/post_8BqoHf5RCmZAfjZA5wNm/video_af884066e4_0/startup720_faststart_avc.mp4";
const POSTER =
  "https://s3.us-east-1.wasabisys.com/locava.app/videos/video_af884066e4_0_poster.jpg";

const fixture = {
  id: POST_ID,
  postId: POST_ID,
  schema: { name: "locava.post", version: 2 },
  classification: { mediaKind: "video", reel: false, visibility: "public", source: "user" },
  mediaType: "video",
  media: {
    status: "ready",
    assetsReady: true,
    instantPlaybackReady: true,
    completeness: "full",
    assetCount: 1,
    rawAssetCount: 1,
    hasMultipleAssets: false,
    primaryAssetId: "video_af884066e4_0",
    coverAssetId: "video_af884066e4_0",
    cover: {
      type: "video",
      url: POSTER,
      posterUrl: POSTER,
      thumbUrl: POSTER,
      gradient: { top: "#111111", bottom: "#000000" },
    },
    assets: [
      {
        id: "video_af884066e4_0",
        index: 0,
        type: "video",
        image: null,
        video: {
          originalUrl: STARTUP_720,
          posterUrl: POSTER,
          posterHighUrl: POSTER,
          thumbnailUrl: POSTER,
          playback: {
            startupUrl: STARTUP_720,
            defaultUrl: STARTUP_720,
            primaryUrl: STARTUP_720,
            goodNetworkUrl: STARTUP_720,
            weakNetworkUrl: STARTUP_720,
            poorNetworkUrl: STARTUP_720,
            highQualityUrl:
              "https://s3.wasabisys.com/locava.app/videos-lab/post_8BqoHf5RCmZAfjZA5wNm/video_af884066e4_0/upgrade1080_faststart_avc.mp4",
            upgradeUrl:
              "https://s3.wasabisys.com/locava.app/videos-lab/post_8BqoHf5RCmZAfjZA5wNm/video_af884066e4_0/upgrade1080_faststart_avc.mp4",
            hlsUrl: null,
            previewUrl: null,
            fallbackUrl: STARTUP_720,
            selectedReason: "verified_startup_avc_faststart_720",
          },
          variants: { startup720FaststartAvc: STARTUP_720, startup720Faststart: STARTUP_720 },
          readiness: {
            assetsReady: true,
            faststartVerified: true,
            instantPlaybackReady: true,
            processingStatus: "completed",
          },
          technical: { sourceCodec: null, playbackCodec: null, audioCodec: null, width: 720, height: 1280 },
        },
        presentation: { letterboxGradient: { top: "#111111", bottom: "#000000" } },
      },
    ],
  },
  author: { userId: "u1", handle: "u1", displayName: "U1", profilePicUrl: null },
  text: { title: "t", caption: "c", content: "c", description: "c", searchableText: "" },
  location: {
    coordinates: { lat: 1, lng: 1 },
    display: { address: "a", city: null, state: null, country: null, geohash: null, mapLabel: null },
    place: { placeId: null, source: "user", precision: "exact" },
    regions: { countryCode: null, admin1: null, admin2: null, locality: null, neighborhood: null },
  },
  lifecycle: { status: "active", isDeleted: false, createdAt: null, createdAtMs: null, updatedAt: null },
  engagement: { likeCount: 0, commentCount: 0, saveCount: 0, shareCount: 0, viewCount: 0, likesVersion: null, commentsVersion: null, savesVersion: null, showLikes: null, showComments: null },
  engagementPreview: { recentLikers: [], recentComments: [] },
  compatibility: { mediaType: "video", photoLink: POSTER, displayPhotoLink: POSTER, thumbUrl: POSTER, posterUrl: POSTER, fallbackVideoUrl: STARTUP_720, photoLinks2: STARTUP_720, photoLinks3: STARTUP_720 },
} as const;

describe("canonical post media fixture 8BqoHf5RCmZAfjZA5wNm", () => {
  it("preserves canonical video as first asset", () => {
    const post = serializeCanonicalPost({ rawPost: fixture as unknown as Record<string, unknown>, postId: POST_ID });
    const resolved = resolveCanonicalPostMedia(post);
    expect(resolved.assets[0]?.type).toBe("video");
    expect(resolved.assets[0]?.video?.playback?.startupUrl).toContain("startup720_faststart_avc.mp4");
  });

  it("serializes playback urls and does not poster-prepend image", () => {
    const post = serializeCanonicalPost({ rawPost: fixture as unknown as Record<string, unknown>, postId: POST_ID });
    expect(post.media.assets[0]?.type).toBe("video");
    expect(post.media.assets.find((a) => a.type === "image")).toBeUndefined();
    expect(post.media.assets[0]?.video?.playback?.startupUrl).toBe(STARTUP_720);
    expect(post.media.assets[0]?.video?.playback?.selectedReason).toBe("verified_startup_avc_faststart_720");
  });
});

