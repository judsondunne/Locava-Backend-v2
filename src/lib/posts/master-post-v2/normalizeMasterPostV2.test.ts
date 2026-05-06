import { describe, expect, it } from "vitest";
import type { PostEngagementSourceAuditV2 } from "../../../contracts/master-post-v2.types.js";
import { normalizeMasterPostV2 } from "./normalizeMasterPostV2.js";
import { validateMasterPostV2 } from "./validateMasterPostV2.js";
import { extractMediaProcessingDebugV2 } from "./extractMediaProcessingDebugV2.js";
import { compactCanonicalPostForLiveWrite } from "./compactCanonicalPostV2.js";

describe("normalizeMasterPostV2", () => {
  it("regression: post_b937d784b8b13248 keeps previewUrl and no main1080 aliasing", () => {
    const raw = {
      id: "post_b937d784b8b13248",
      userId: "u1",
      userName: "Judson",
      userHandle: "jd",
      userPic: "https://img/user.jpg",
      activities: ["bridges"],
      mediaType: "video",
      privacy: "Public Spot",
      videoProcessingStatus: "completed",
      playbackLabStatus: "ready",
      assetsReady: true,
      instantPlaybackReady: true,
      createdAt: "2026-05-04T10:00:00.000Z",
      title: "Woah",
      caption: "",
      description: "",
      content: "",
      geohash: "dr4x27dhh",
      placeName: "Easton, Pennsylvania",
      moderatorTier: 0,
      likes: [],
      likesCount: 0,
      commentsCount: 0,
      rankingAggregates: { score: 10 },
      rankingRollup: { likes: 0, comments: 0, saves: 1, shares: 0 },
      posterFiles: { newPosterUrl: "https://img/poster-new.jpg" },
      variantMetadata: { poster: { width: 640, height: 1138, aspectRatio: 0.5625 } },
      playbackLab: { status: "ready", assets: { video_bf9d526574_2cbde8151b_0: { generated: { startup720FaststartAvc: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/startup720_faststart_avc.mp4", startup1080FaststartAvc: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/startup1080_faststart_avc.mp4", main720Avc: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/main720_avc.mp4", preview360Avc: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/preview360_avc.mp4", main1080Avc: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.mp4", main1080: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.mp4", upgrade1080FaststartAvc: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.mp4", upgrade1080Faststart: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.mp4", posterHigh: "https://img/poster-high.jpg" }, lastVerifyResults: [{ variant: "main1080Avc", url: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.mp4", ok: true, moovHint: "moov_before_mdat_in_prefix" }, { variant: "main720Avc", url: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/main720_avc.mp4", ok: true, moovHint: "moov_before_mdat_in_prefix" }] } } },
      assets: [{ id: "video_bf9d526574_2cbde8151b_0", type: "video", original: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/original.mp4", poster: "https://img/poster.jpg", codecs: { video: "h264", audio: "none" } }],
      legacy: {
        photoLinks2: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/preview360_avc.mp4",
        photoLinks3: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/main720_avc.mp4"
      },
      fallbackVideoUrl: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/original.mp4",
      photoLink: "https://img/poster.jpg",
      displayPhotoLink: "https://img/poster.jpg",
      thumbUrl: "https://img/poster-thumb.jpg"
    };
    const result = normalizeMasterPostV2(raw, { postId: "post_b937d784b8b13248" });
    expect(result.canonical.schema.name).toBe("locava.post");
    expect(result.canonical.schema.version).toBe(2);
    expect(result.canonical.classification.visibility).toBe("public");
    expect(result.canonical.classification.privacyLabel).toBe("Public Spot");
    expect(result.canonical.classification.source).not.toBe("video");
    expect(result.canonical.classification.moderatorTier).toBe(0);
    expect(result.canonical.location.coordinates.geohash).toBe("dr4x27dhh");
    expect(result.canonical.media.completeness).toBe("complete");
    expect(result.canonical.media.assetsReady).toBe(true);
    expect(result.canonical.media.instantPlaybackReady).toBe(true);
    expect(result.canonical.media.rawAssetCount).toBe(1);
    expect(result.canonical.media.hasMultipleAssets).toBe(false);
    expect(result.canonical.media.primaryAssetId).toBe("video_bf9d526574_2cbde8151b_0");
    expect(result.canonical.media.coverAssetId).toBe("video_bf9d526574_2cbde8151b_0");
    expect(result.canonical.media.assets.length).toBe(1);
    expect(result.canonical.media.assetCount).toBe(1);
    expect(result.canonical.media.assets[0]?.type).toBe("video");
    expect(result.canonical.classification.mediaKind).toBe("video");
    expect(result.canonical.compatibility.mediaType).toBe("video");
    expect(result.canonical.media.assets[0]?.video?.playback.primaryUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/main720_avc.mp4");
    expect(result.canonical.media.assets[0]?.video?.playback.defaultUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/main720_avc.mp4");
    expect(result.canonical.media.assets[0]?.video?.playback.highQualityUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/main720_avc.mp4");
    expect(result.canonical.media.assets[0]?.video?.playback.startupUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/main720_avc.mp4");
    expect(result.canonical.media.assets[0]?.video?.playback.upgradeUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/main720_avc.mp4");
    expect(result.canonical.media.assets[0]?.video?.playback.previewUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/preview360_avc.mp4");
    expect(result.canonical.media.assets[0]?.video?.playback.fallbackUrl).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/original.mp4");
    expect(result.canonical.media.assets[0]?.video?.variants.preview360Avc).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/preview360_avc.mp4");
    expect(result.canonical.media.assets[0]?.video?.variants.main720Avc).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/main720_avc.mp4");
    expect(result.canonical.media.assets[0]?.video?.variants.upgrade1080Faststart).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.mp4");
    expect(result.canonical.media.assets[0]?.video?.variants.upgrade1080FaststartAvc).toBe("https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.mp4");
    expect(result.canonical.media.assets[0]?.video?.variants.main1080).toBeNull();
    expect(result.canonical.media.assets[0]?.video?.variants.main1080Avc).toBeNull();
    expect(result.canonical.media.assets[0]?.video?.variants.hls).toBeNull();
    expect(result.canonical.media.assets[0]?.video?.variants.hlsAvcMaster).toBeNull();
    expect(result.canonical.media.assets[0]?.source.kind).toBe("assets");
    expect(result.canonical.media.assets[0]?.source.primarySources).toEqual(expect.arrayContaining(["assets", "playbackLab"]));
    expect(result.canonical.media.assets[0]?.source.legacySourcesConsidered).toEqual(
      expect.arrayContaining(["photoLinks2", "photoLinks3", "legacy.photoLinks2", "legacy.photoLinks3"])
    );
    expect(result.canonical.media.assets[0]?.video?.variants.diagnosticsJson).toBeUndefined();
    expect(result.canonical.media.assets[0]?.video?.variants.photoLinks2).toBeUndefined();
    expect(result.canonical.media.assets[0]?.video?.variants["legacy.photoLinks2"]).toBeUndefined();
    expect(Object.keys(result.canonical.media.assets[0]?.video?.variants ?? {}).sort()).toEqual(
      [
        "hls",
        "hlsAvcMaster",
        "main1080",
        "main1080Avc",
        "main720",
        "main720Avc",
        "poster",
        "posterHigh",
        "preview360",
        "preview360Avc",
        "startup1080Faststart",
        "startup1080FaststartAvc",
        "startup540Faststart",
        "startup540FaststartAvc",
        "startup720Faststart",
        "startup720FaststartAvc",
        "upgrade1080Faststart",
        "upgrade1080FaststartAvc"
      ].sort()
    );
    expect(result.canonical.media.assets[0]?.video?.readiness.faststartVerified).toBe(true);
    expect(result.canonical.media.assets[0]?.video?.technical.sourceCodec).toBe("h264");
    expect(result.canonical.text.caption).toBe("");
    expect(result.canonical.text.description).toBe("");
    expect(result.canonical.text.content).toBe("");
    expect(result.canonical.text.searchableText).toBe("Woah bridges Easton, Pennsylvania");
    expect(result.canonical.engagement.likesVersion).toBe(0);
    expect(result.canonical.engagement.commentsVersion).toBe(0);
    expect(result.canonical.media.cover.width).toBe(640);
    expect(result.canonical.media.cover.height).toBe(1138);
    expect(result.canonical.media.cover.aspectRatio).toBe(0.5625);
    expect(result.canonical.media.assets.some((asset) => asset.type === "image" && /\.mp4(\?|$)/i.test(asset.image?.displayUrl ?? ""))).toBe(
      false
    );
    const fallbackMatches = result.canonical.media.assets.filter(
      (asset) =>
        asset.type === "video" &&
        asset.video?.playback.fallbackUrl ===
          "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/original.mp4"
    );
    expect(fallbackMatches.length).toBe(1);
    expect(result.canonical.media.cover.url).toContain("poster");
    expect(result.canonical.classification.primaryActivity).toBe("bridges");
    expect(result.canonical.engagement.likeCount).toBe(0);
    expect(result.canonical.engagementPreview.recentLikers.length).toBe(0);
    expect(result.canonical.engagementPreview.recentComments.length).toBe(0);
    expect(result.canonical.compatibility.photoLink).toBeTruthy();
    expect(result.canonical.compatibility.displayPhotoLink).toBeTruthy();
    expect(result.canonical.compatibility.photoLinks2).toBeTruthy();
    expect(result.canonical.compatibility.photoLinks3).toBeTruthy();
    expect(result.canonical.compatibility.fallbackVideoUrl).toBeTruthy();
    expect(extractMediaProcessingDebugV2(raw)).toMatchObject({ playbackLab: expect.any(Object) });
    const validation = validateMasterPostV2(result.canonical);
    expect(validation.blockingErrors.length).toBe(0);
    expect(validation.warnings.some((w) => w.code === "main1080_aliases_upgrade1080")).toBe(false);
    expect(validation.status).toBe("valid");
  });

  it("regression: true mixed post stays mixed with exactly two assets", () => {
    const mixed = normalizeMasterPostV2({
      id: "mix",
      userId: "u",
      createdAt: "2026-01-01T00:00:00.000Z",
      assets: [
        { id: "i1", type: "image", original: "https://img/1.jpg", variants: { md: { webp: "https://img/1-md.webp" } } },
        { id: "v1", type: "video", original: "https://v/1.mp4", main720Avc: "https://v/1-720.mp4", preview360Avc: "https://v/1-360.mp4" }
      ],
      legacy: { photoLinks2: "https://v/1-360.mp4", photoLinks3: "https://v/1-720.mp4" }
    });
    expect(mixed.canonical.media.assets.length).toBe(2);
    expect(mixed.canonical.classification.mediaKind).toBe("mixed");
    expect(mixed.canonical.media.assets[0]?.type).toBe("image");
    expect(mixed.canonical.media.assets[1]?.type).toBe("video");
  });

  it("old reel picks verified main1080/main720 and keeps canonical fields isolated", () => {
    const raw = {
      id: "legacy-reel-1",
      userId: "u",
      createdAt: "2026-05-05T00:00:00.000Z",
      title: "Legacy Reel",
      mediaType: "video",
      assets: [
        {
          id: "v1",
          type: "video",
          original: "https://cdn/original.mp4",
          main1080Avc: "https://cdn/main1080.mp4",
          main720Avc: "https://cdn/main720.mp4",
          preview360Avc: "https://cdn/preview360.mp4",
          poster: "https://cdn/poster.jpg"
        }
      ],
      playbackLab: {
        lastVerifyResults: [
          { url: "https://cdn/main1080.mp4", ok: true, moovHint: "moov_before_mdat_in_prefix" },
          { url: "https://cdn/main720.mp4", ok: true, moovHint: "moov_before_mdat_in_prefix" }
        ]
      },
      activities: ["hike"],
      likesCount: 4
    };
    const { canonical } = normalizeMasterPostV2(raw, { postId: "legacy-reel-1" });
    const v = canonical.media.assets[0]?.video;
    expect(v?.playback.startupUrl).toBe("https://cdn/main1080.mp4");
    expect(v?.playback.defaultUrl).toBe("https://cdn/main1080.mp4");
    expect(v?.playback.primaryUrl).toBe("https://cdn/main1080.mp4");
    expect(v?.playback.fallbackUrl).toBe("https://cdn/original.mp4");
    expect(canonical.media.instantPlaybackReady).toBe(true);
    expect(v?.readiness.faststartVerified).toBe(true);
    expect(canonical.classification.primaryActivity).toBe("hike");
    expect(canonical.engagement.likeCount).toBe(4);
  });

  it("old production post without startup aliases selects verified main720Avc via probe shape", () => {
    const raw = {
      id: "legacy-reel-old-main720",
      userId: "u",
      createdAt: "2026-05-05T00:00:00.000Z",
      mediaType: "video",
      assets: [
        {
          id: "v1",
          type: "video",
          original: "https://cdn/original.mp4",
          main1080Avc: "https://cdn/main1080.mp4",
          main720Avc: "https://cdn/main720.mp4",
          preview360Avc: "https://cdn/preview360.mp4",
          poster: "https://cdn/poster.jpg"
        }
      ],
      playbackLab: {
        lastVerifyResults: [
          {
            result: { url: "https://cdn/main720.mp4" },
            probe: { head: { ok: true }, moovHint: "moov_before_mdat_in_prefix" }
          },
          {
            result: { url: "https://cdn/preview360.mp4" },
            probe: { head: { ok: true }, moovHint: "moov_before_mdat_in_prefix" }
          }
        ]
      }
    };
    const { canonical } = normalizeMasterPostV2(raw, { postId: "legacy-reel-old-main720" });
    const v = canonical.media.assets[0]?.video;
    expect(v?.playback.startupUrl).toBe("https://cdn/main720.mp4");
    expect(v?.playback.defaultUrl).toBe("https://cdn/main720.mp4");
    expect(v?.playback.primaryUrl).toBe("https://cdn/main720.mp4");
    expect((v?.playback as Record<string, unknown>)?.goodNetworkUrl).toBe("https://cdn/main720.mp4");
    expect((v?.playback as Record<string, unknown>)?.weakNetworkUrl).toBe("https://cdn/main720.mp4");
    expect((v?.playback as Record<string, unknown>)?.poorNetworkUrl).toBe("https://cdn/preview360.mp4");
    expect((v?.playback as Record<string, unknown>)?.selectedReason).toBe("verified_avc_faststart_720");
    expect(v?.playback.previewUrl).toBe("https://cdn/preview360.mp4");
    expect(canonical.media.instantPlaybackReady).toBe(true);
    expect(v?.readiness.faststartVerified).toBe(true);
  });

  it("regression: exzi old non-startup shape selects verified main720 over verified original", () => {
    const raw = {
      id: "exziw1QFyoigUnlDFcCk",
      userId: "u",
      createdAt: "2026-05-05T00:00:00.000Z",
      mediaType: "video",
      assets: [
        {
          id: "video_1776294232596_0",
          type: "video",
          original: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776214907741_mbmsh1hngp.mp4",
          poster: "https://s3.wasabisys.com/locava.app/videos/video_1776294232596_0_poster.jpg",
          variants: {
            main1080Avc: "https://s3.us-east-1.wasabisys.com/locava.app/videos/video_1776294232596_0_1080_avc.mp4",
            main720Avc: "https://s3.us-east-1.wasabisys.com/locava.app/videos/video_1776294232596_0_720_avc.mp4",
            preview360Avc: "https://s3.us-east-1.wasabisys.com/locava.app/videos/video_1776294232596_0_360_avc.mp4"
          }
        }
      ],
      playbackLab: {
        lastVerifyResults: [
          {
            label: "main720Avc",
            url: "https://s3.us-east-1.wasabisys.com/locava.app/videos/video_1776294232596_0_720_avc.mp4",
            probe: {
              head: { ok: true, status: 200, contentType: "video/mp4", acceptRanges: "bytes" },
              moovHint: "moov_before_mdat_in_prefix"
            }
          },
          {
            label: "preview360",
            url: "https://s3.us-east-1.wasabisys.com/locava.app/videos/video_1776294232596_0_360_avc.mp4",
            probe: {
              head: { ok: true, status: 200, contentType: "video/mp4", acceptRanges: "bytes" },
              moovHint: "moov_before_mdat_in_prefix"
            }
          },
          {
            label: "original",
            url: "https://s3.wasabisys.com/locava.app/admin-video-uploads/1776214907741_mbmsh1hngp.mp4",
            probe: {
              head: { ok: true, status: 200, contentType: "video/mp4", acceptRanges: "bytes" },
              moovHint: "moov_before_mdat_in_prefix"
            }
          }
        ]
      }
    };
    const { canonical, warnings } = normalizeMasterPostV2(raw, { postId: "exziw1QFyoigUnlDFcCk" });
    const v = canonical.media.assets[0]?.video;
    expect(v?.playback.defaultUrl).toBe("https://s3.us-east-1.wasabisys.com/locava.app/videos/video_1776294232596_0_720_avc.mp4");
    expect(v?.playback.startupUrl).toBe("https://s3.us-east-1.wasabisys.com/locava.app/videos/video_1776294232596_0_720_avc.mp4");
    expect(v?.playback.primaryUrl).toBe("https://s3.us-east-1.wasabisys.com/locava.app/videos/video_1776294232596_0_720_avc.mp4");
    expect(v?.playback.highQualityUrl).toBe("https://s3.us-east-1.wasabisys.com/locava.app/videos/video_1776294232596_0_720_avc.mp4");
    expect(v?.playback.fallbackUrl).toBe("https://s3.wasabisys.com/locava.app/admin-video-uploads/1776214907741_mbmsh1hngp.mp4");
    expect(v?.playback.previewUrl).toBe("https://s3.us-east-1.wasabisys.com/locava.app/videos/video_1776294232596_0_360_avc.mp4");
    expect((v?.playback as Record<string, unknown>)?.poorNetworkUrl).toBe(
      "https://s3.us-east-1.wasabisys.com/locava.app/videos/video_1776294232596_0_360_avc.mp4"
    );
    expect((v?.playback as Record<string, unknown>)?.selectedReason).toBe("verified_avc_faststart_720");
    expect(canonical.media.instantPlaybackReady).toBe(true);
    expect(v?.readiness.faststartVerified).toBe(true);
    expect(warnings.some((w) => w.code === "preview_missing_while_variant_exists")).toBe(false);
  });

  it("native v2 nested playbackLab generated verification selects startup720 and poorNetwork startup540", () => {
    const raw = {
      id: "native-v2-720",
      userId: "u",
      createdAt: "2026-05-05T00:00:00.000Z",
      mediaType: "video",
      assets: [
        {
          id: "v1",
          type: "video",
          original: "https://cdn/original.mp4",
          startup720FaststartAvc: "https://cdn/startup720.mp4",
          startup540FaststartAvc: "https://cdn/startup540.mp4",
          main720Avc: "https://cdn/main720.mp4",
          preview360Avc: "https://cdn/preview360.mp4",
          poster: "https://cdn/poster.jpg"
        }
      ],
      playbackLab: {
        assets: {
          v1: {
            generated: {
              lastVerifyResults: [
                { url: "https://cdn/startup720.mp4", ok: true, moovHint: "moov_before_mdat_in_prefix" },
                { url: "https://cdn/startup540.mp4", ok: true, moovHint: "moov_before_mdat_in_prefix" }
              ]
            }
          }
        }
      }
    };
    const { canonical } = normalizeMasterPostV2(raw, { postId: "native-v2-720" });
    const v = canonical.media.assets[0]?.video;
    expect(v?.playback.startupUrl).toBe("https://cdn/startup720.mp4");
    expect(v?.playback.defaultUrl).toBe("https://cdn/startup720.mp4");
    expect(v?.playback.primaryUrl).toBe("https://cdn/startup720.mp4");
    expect(v?.playback.highQualityUrl).toBe("https://cdn/startup720.mp4");
    expect(v?.playback.upgradeUrl).toBe("https://cdn/startup720.mp4");
    expect((v?.playback as Record<string, unknown>)?.goodNetworkUrl).toBe("https://cdn/startup720.mp4");
    expect((v?.playback as Record<string, unknown>)?.weakNetworkUrl).toBe("https://cdn/startup720.mp4");
    expect((v?.playback as Record<string, unknown>)?.poorNetworkUrl).toBe("https://cdn/startup540.mp4");
    expect(v?.playback.previewUrl).toBe("https://cdn/preview360.mp4");
    expect((v?.playback as Record<string, unknown>)?.selectedReason).toBe("verified_startup_avc_faststart_720");
    expect(canonical.media.instantPlaybackReady).toBe(true);
    expect(v?.readiness.faststartVerified).toBe(true);
  });

  it("prefers canonical media.assets over legacy top-level assets when both exist", () => {
    const raw = {
      id: "canonical_over_legacy_assets",
      schema: { name: "locava.post", version: 2 },
      mediaType: "video",
      assets: [
        {
          id: "legacy_1",
          type: "image",
          original: "https://cdn/poster.jpg",
          url: "https://cdn/poster.jpg",
        },
      ],
      media: {
        assets: [
          {
            id: "video_1",
            index: 0,
            type: "video",
            video: {
              originalUrl: "https://cdn/original.mp4",
              posterUrl: "https://cdn/poster.jpg",
              playback: {
                startupUrl: "https://cdn/startup720.mp4",
                defaultUrl: "https://cdn/startup720.mp4",
                primaryUrl: "https://cdn/startup720.mp4",
              },
            },
          },
        ],
      },
    };
    const { canonical } = normalizeMasterPostV2(raw, { postId: "canonical_over_legacy_assets" });
    expect(canonical.media.assets[0]?.type).toBe("video");
    expect(canonical.media.assets[0]?.id).toBe("video_1");
    expect(canonical.media.assets[0]?.video?.playback?.startupUrl).toBeTruthy();
    expect(canonical.media.assets[0]?.video?.playback?.fallbackUrl).toBe("https://cdn/original.mp4");
  });

  it("keeps instant playback false when no optimized verified URL exists", () => {
    const raw = {
      id: "legacy-reel-4",
      userId: "u",
      createdAt: "2026-05-05T00:00:00.000Z",
      mediaType: "video",
      assets: [{ id: "v1", type: "video", original: "https://cdn/original.mp4", poster: "https://cdn/poster.jpg" }]
    };
    const { canonical, warnings } = normalizeMasterPostV2(raw, { postId: "legacy-reel-4" });
    const v = canonical.media.assets[0]?.video;
    expect(v?.playback.fallbackUrl).toBe("https://cdn/original.mp4");
    expect(canonical.media.instantPlaybackReady).toBe(false);
    expect(v?.readiness.faststartVerified).toBe(false);
    expect((v?.playback as Record<string, unknown>)?.selectedReason).toBe("original_unverified_fallback");
    expect(warnings.some((w) => w.code === "video_instant_playback_not_verified_faststart")).toBe(true);
  });

  it("regression: multi-photo post keeps only real photo assets", () => {
    const multiImage = normalizeMasterPostV2({
      id: "img",
      userId: "u",
      createdAt: "2026-01-01T00:00:00.000Z",
      assets: [
        { id: "i1", type: "image", original: "https://img/1.jpg", variants: { md: { webp: "https://img/1-md.webp" }, thumb: { webp: "https://img/1-thumb.webp" } } },
        { id: "i2", type: "image", original: "https://img/2.jpg", variants: { md: { webp: "https://img/2-md.webp" } } },
        { id: "i3", type: "image", original: "https://img/3.jpg", variants: { md: { webp: "https://img/3-md.webp" } } }
      ]
    });
    expect(multiImage.canonical.classification.mediaKind).toBe("image");
    expect(multiImage.canonical.media.assetCount).toBe(3);
    expect(
      multiImage.canonical.media.assets.filter(
        (asset) =>
          asset.type === "image" &&
          [asset.image?.displayUrl, asset.image?.thumbnailUrl].some((url) => url === "https://img/1-thumb.webp")
      ).length
    ).toBeLessThanOrEqual(1);
  });

  it("applies post-level letterbox gradients across all assets when only one gradient is provided", () => {
    const raw = {
      id: "post_3a42f16570830ea9",
      userId: "u",
      createdAt: "2026-05-04T00:00:00.000Z",
      assets: [
        { id: "a1", type: "image", original: "https://img/1.jpg", variants: { md: { webp: "https://img/1-md.webp" } } },
        { id: "a2", type: "image", original: "https://img/2.jpg", variants: { md: { webp: "https://img/2-md.webp" } } },
        { id: "a3", type: "image", original: "https://img/3.jpg", variants: { md: { webp: "https://img/3-md.webp" } } }
      ],
      letterboxGradients: [{ top: "#1f2937", bottom: "#111827" }]
    };
    const result = normalizeMasterPostV2(raw, { postId: "post_3a42f16570830ea9" });
    expect(result.canonical.media.assetCount).toBe(3);
    expect(result.canonical.media.assets.every((asset) => asset.presentation.letterboxGradient?.top === "#1f2937")).toBe(true);
    expect(result.canonical.media.assets.every((asset) => asset.presentation.letterboxGradient?.bottom === "#111827")).toBe(true);
    expect(result.canonical.media.cover.gradient?.top).toBe("#1f2937");
    expect(result.canonical.media.cover.gradient?.bottom).toBe("#111827");
  });

  it("computes lifecycle.createdAtMs from Firestore-style raw.time (_seconds/_nanoseconds)", () => {
    const raw = {
      id: "SinzQIFVjsC6OgqJiubq",
      userId: "u",
      title: "Lofoton🇳🇴",
      createdAt: "2026-04-13T20:00:09.917Z",
      time: { _seconds: 1776110409, _nanoseconds: 917000000 },
      assets: [{ id: "pic", type: "image", original: "https://img/p.jpg", variants: { md: { webp: "https://img/p.webp" } } }]
    };
    const { canonical } = normalizeMasterPostV2(raw, { postId: "SinzQIFVjsC6OgqJiubq" });
    expect(canonical.lifecycle.createdAtMs).toBe(1776110409917);
    expect(canonical.audit.normalizationDebug?.lifecycleCreatedAtMsSource).toBe("time");
  });

  it("preserves lifecycle.createdAtMs when raw.createdAtMs is already a finite number", () => {
    const raw = {
      id: "p_ms",
      userId: "u",
      createdAtMs: 1704067200000,
      assets: [{ id: "i", type: "image", original: "https://img/x.jpg", variants: { md: { webp: "https://img/x.webp" } } }]
    };
    const { canonical } = normalizeMasterPostV2(raw);
    expect(canonical.lifecycle.createdAtMs).toBe(1704067200000);
    expect(canonical.audit.normalizationDebug?.lifecycleCreatedAtMsSource).toBe("createdAtMs");
  });

  it("falls back lifecycle.createdAtMs to raw[\"time-created\"] or raw.createdAt when raw.time is absent", () => {
    const withTimeCreated = normalizeMasterPostV2({
      id: "p_tc",
      userId: "u",
      "time-created": "2026-02-01T00:00:00.000Z",
      assets: [{ id: "i", type: "image", original: "https://img/x.jpg", variants: { md: { webp: "https://img/x.webp" } } }]
    });
    expect(withTimeCreated.canonical.lifecycle.createdAtMs).toBe(Date.parse("2026-02-01T00:00:00.000Z"));
    expect(withTimeCreated.canonical.audit.normalizationDebug?.lifecycleCreatedAtMsSource).toBe("time-created");

    const withCreatedAt = normalizeMasterPostV2({
      id: "p_ca",
      userId: "u",
      createdAt: "2026-03-01T12:30:00.000Z",
      assets: [{ id: "i", type: "image", original: "https://img/x.jpg", variants: { md: { webp: "https://img/x.webp" } } }]
    });
    expect(withCreatedAt.canonical.lifecycle.createdAtMs).toBe(Date.parse("2026-03-01T12:30:00.000Z"));
    expect(withCreatedAt.canonical.audit.normalizationDebug?.lifecycleCreatedAtMsSource).toBe("createdAt");
  });

  it("regression: text.title stays separate from location.display.name (SinzQIFVjsC6OgqJiubq shape)", () => {
    const raw = {
      id: "SinzQIFVjsC6OgqJiubq",
      userId: "u",
      createdAt: "2026-01-01T00:00:00.000Z",
      title: "Lofoton🇳🇴",
      address: "67 Reineveien Reine",
      locationLabel: "67 Reineveien Reine",
      geoData: { city: "Reine", country: "Norway" },
      assets: [{ id: "pic", type: "image", original: "https://img/p.jpg", variants: { md: { webp: "https://img/p.webp" } } }]
    };
    const { canonical } = normalizeMasterPostV2(raw, { postId: "SinzQIFVjsC6OgqJiubq" });
    expect(canonical.text.title).toBe("Lofoton🇳🇴");
    expect(canonical.text.title).not.toBe(canonical.location.display.name);
    expect(canonical.location.display.address).toBe("67 Reineveien Reine");
    expect(canonical.location.display.name).toBe("67 Reineveien Reine");
    expect(canonical.location.display.label).toBe("67 Reineveien Reine");
    expect(canonical.location.display.subtitle).toBe("Reine, Norway");
  });

  it("preserves liker displayName, profilePicUrl, likedAt from legacy likes[]", () => {
    const raw = {
      id: "p_likes",
      userId: "u",
      createdAt: "2026-01-01T00:00:00.000Z",
      assets: [{ id: "i", type: "image", original: "https://img/x.jpg", variants: { md: { webp: "https://img/x.webp" } } }],
      likes: [
        {
          userId: "u1",
          userName: "Ann",
          userHandle: "ann",
          userPic: "https://img/ann.jpg",
          createdAt: "2026-05-04T12:00:00.000Z"
        }
      ]
    };
    const { canonical } = normalizeMasterPostV2(raw);
    const liker = canonical.engagementPreview.recentLikers[0];
    expect(liker?.displayName).toBe("Ann");
    expect(liker?.handle).toBe("ann");
    expect(liker?.profilePicUrl).toBe("https://img/ann.jpg");
    expect(liker?.likedAt).toBe("2026-05-04T12:00:00.000Z");
  });

  it("uses engagement audit recommended counts and subcollection recent likers", () => {
    const raw = {
      id: "audit",
      userId: "u",
      createdAt: "2026-01-01T00:00:00.000Z",
      likesCount: 5,
      assets: [{ id: "i", type: "image", original: "https://img/x.jpg", variants: { md: { webp: "https://img/x.webp" } } }],
      likes: []
    };
    const audit: PostEngagementSourceAuditV2 = {
      postDoc: {
        likeCount: 5,
        likesArrayCount: 0,
        commentsCount: 0,
        commentsArrayCount: 0,
        likesVersion: 5,
        commentsVersion: 0
      },
      subcollections: {
        likesPath: "posts/audit/likes",
        likesCount: 12,
        recentLikers: [
          {
            userId: "x",
            displayName: "Sam",
            handle: "sam",
            profilePicUrl: "https://pic",
            likedAt: "2026-05-03T00:00:00.000Z"
          }
        ],
        likesQueryError: null,
        commentsPath: "posts/audit/comments",
        commentsCount: 0,
        recentComments: [],
        commentsQueryError: null
      },
      recommendedCanonical: {
        likeCount: 12,
        commentCount: 0,
        likesVersion: 5,
        commentsVersion: 0
      },
      selectedSource: { likes: "subcollection", comments: "subcollection" },
      mismatches: ["likes_count_post_doc_5_vs_subcollection_12"],
      warnings: []
    };
    const { canonical } = normalizeMasterPostV2(raw, { postId: "audit", engagementSourceAudit: audit });
    expect(canonical.engagement.likeCount).toBe(12);
    expect(canonical.engagementPreview.recentLikers[0]?.userId).toBe("x");
    expect(canonical.engagementPreview.recentComments.length).toBe(0);
    expect(canonical.audit.engagementSourceAuditSummary).toEqual(audit);
  });

  it("jlDJFsYgGca9v8pofbFL-style: likes subcollection + empty comments subcollection keeps embedded comments + height inference", () => {
    const audit: PostEngagementSourceAuditV2 = {
      postDoc: {
        likeCount: null,
        likesArrayCount: 0,
        commentsCount: null,
        commentsArrayCount: 1,
        likesVersion: null,
        commentsVersion: null
      },
      subcollections: {
        likesPath: "posts/jlDJFsYgGca9v8pofbFL/likes",
        likesCount: 22,
        recentLikers: [
          {
            userId: "u_like_1",
            displayName: "L1",
            handle: "l1",
            profilePicUrl: "https://pic/1.jpg",
            likedAt: "2026-05-01T00:00:00.000Z"
          }
        ],
        likesQueryError: null,
        commentsPath: "posts/jlDJFsYgGca9v8pofbFL/comments",
        commentsCount: 0,
        recentComments: [],
        commentsQueryError: null
      },
      recommendedCanonical: { likeCount: 22, commentCount: 1, likesVersion: 22, commentsVersion: 1 },
      selectedSource: { likes: "subcollection", comments: "postDocArray" },
      mismatches: ["comments_array_len_1_vs_subcollection_0"],
      warnings: ["comments_subcollection_empty_using_post_doc_array"]
    };
    const assets = [0, 1, 2, 3].map((i) => ({
      id: `img_${i}`,
      type: "image",
      original: `https://img/${i}.jpg`,
      ...(i === 0 ? { width: 719, aspectRatio: 0.56171875 } : {}),
      variants: { md: { webp: `https://img/${i}-md.webp` } }
    }));
    const raw = {
      id: "jlDJFsYgGca9v8pofbFL",
      userId: "author",
      createdAt: "2026-01-01T00:00:00.000Z",
      title: "JL mix",
      likesCount: 22,
      comments: [
        {
          id: "1773970838480",
          userId: "xtDvqYdDmkZDWtff9BHP91TNqOr2",
          userName: "Ethan Jacobson",
          userHandle: "ethanj",
          content: "Great spot — love the light here.",
          userPic: "https://img/ethan.jpg",
          time: "2026-03-20T15:00:00.000Z",
          replies: [{ id: "r1", userId: "u2", content: "thanks!" }]
        }
      ],
      assets
    };
    const { canonical } = normalizeMasterPostV2(raw, { postId: "jlDJFsYgGca9v8pofbFL", engagementSourceAudit: audit });
    expect(canonical.media.assetCount).toBe(4);
    expect(canonical.media.hasMultipleAssets).toBe(true);
    expect(canonical.media.assets.map((a) => a.id)).toEqual(["img_0", "img_1", "img_2", "img_3"]);
    expect(canonical.media.assets[0]?.image?.height).toBe(1280);
    expect(canonical.engagement.likeCount).toBe(22);
    expect(canonical.engagement.commentCount).toBe(1);
    expect(canonical.engagement.commentsVersion).toBe(1);
    expect(canonical.engagementPreview.recentLikers[0]?.userId).toBe("u_like_1");
    const rc = canonical.engagementPreview.recentComments[0];
    expect(rc?.commentId).toBe("1773970838480");
    expect(rc?.displayName).toBe("Ethan Jacobson");
    expect(rc?.handle).toBe("ethanj");
    expect(rc?.profilePicUrl).toBe("https://img/ethan.jpg");
    expect(rc?.userId).toBe("xtDvqYdDmkZDWtff9BHP91TNqOr2");
    expect(rc?.replyCount).toBe(1);
    expect(rc?.text).toContain("Great spot");
    expect(canonical.legacy.originalEngagementFields.commentsPreserved).toBe(true);
    const validation = validateMasterPostV2(canonical, { engagementSourceAudit: audit });
    expect(validation.blockingErrors.length).toBe(0);
    expect(validation.warnings.some((w) => w.code === "comments_embedded_exist_while_subcollection_empty")).toBe(true);
  });

  it("post rebuilder: nested media.assets[].image URLs do not trip image_missing_display_url / missing_cover_url", () => {
    const raw = {
      id: "post_45d3e0147c080b6a",
      userId: "u1",
      createdAt: "2026-05-04T00:00:00.000Z",
      title: "Pic",
      mediaType: "photo",
      media: {
        assetCount: 1,
        assets: [
          {
            id: "a1",
            type: "image",
            index: 0,
            image: {
              displayUrl: "https://img.example/display.jpg",
              originalUrl: "https://img.example/original.jpg",
              thumbnailUrl: "https://img.example/thumb.jpg"
            }
          }
        ],
        cover: { url: "https://img.example/cover.jpg", thumbUrl: "https://img.example/cover-thumb.jpg" }
      }
    };
    const { canonical } = normalizeMasterPostV2(raw, { postId: raw.id });
    const v = validateMasterPostV2(canonical);
    const codes = v.blockingErrors.map((e) => e.code);
    expect(codes).not.toContain("image_missing_display_url");
    expect(codes).not.toContain("missing_cover_url");
  });

  it("post rebuilder: deleted lifecycle stays deleted through compact live projection", () => {
    const raw = {
      id: "post_del_img",
      userId: "u1",
      createdAt: "2026-05-04T00:00:00.000Z",
      lifecycle: { status: "deleted", isDeleted: true, deletedAt: "2026-05-05T00:00:00.000Z" },
      assets: [{ id: "i1", type: "image", original: "https://img/x.jpg", variants: { md: { webp: "https://img/x.webp" } } }]
    };
    const { canonical } = normalizeMasterPostV2(raw, { postId: raw.id });
    expect(canonical.lifecycle.status).toBe("deleted");
    expect(canonical.lifecycle.isDeleted).toBe(true);
    const { livePost } = compactCanonicalPostForLiveWrite({
      canonical,
      rawBefore: raw as Record<string, unknown>,
      postId: raw.id
    });
    expect((livePost as { lifecycle: { status: string } }).lifecycle.status).toBe("deleted");
  });
});
