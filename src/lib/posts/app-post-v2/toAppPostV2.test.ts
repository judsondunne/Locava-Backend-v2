import { describe, expect, it } from "vitest";
import { normalizeMasterPostV2 } from "../master-post-v2/normalizeMasterPostV2.js";
import type { PostEngagementSourceAuditV2 } from "../../../contracts/master-post-v2.types.js";
import { buildSurfaceComparePayload, toAppPostV2FromAny, toMasterPostV2FromAnyWithProvenance } from "./toAppPostV2.js";

const legacyVideoPlaybackLabRaw = {
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
  playbackLab: {
    status: "ready",
    assets: {
      video_bf9d526574_2cbde8151b_0: {
        generated: {
          startup720FaststartAvc:
            "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/startup720_faststart_avc.mp4",
          startup1080FaststartAvc:
            "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/startup1080_faststart_avc.mp4",
          main720Avc:
            "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/main720_avc.mp4",
          preview360Avc:
            "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/preview360_avc.mp4",
          main1080Avc:
            "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.mp4",
          main1080:
            "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.mp4",
          upgrade1080FaststartAvc:
            "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.mp4",
          upgrade1080Faststart:
            "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/upgrade1080_faststart_avc.mp4",
          posterHigh: "https://img/poster-high.jpg"
        },
        lastVerifyResults: [{ variant: "startup720FaststartAvc", ok: true, moovHint: "moov_before_mdat_in_prefix" }]
      }
    }
  },
  assets: [
    {
      id: "video_bf9d526574_2cbde8151b_0",
      type: "video",
      original: "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/original.mp4",
      poster: "https://img/poster.jpg",
      codecs: { video: "h264", audio: "none" }
    }
  ],
  legacy: {
    photoLinks2:
      "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/preview360_avc.mp4",
    photoLinks3:
      "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/main720_avc.mp4"
  },
  fallbackVideoUrl:
    "https://s3.wasabisys.com/locava.app/videos-lab/post_b937d784b8b13248/video_0e89a140f1_191b325ad4_0/original.mp4",
  photoLink: "https://img/poster.jpg",
  displayPhotoLink: "https://img/poster.jpg",
  thumbUrl: "https://img/poster-thumb.jpg"
};

describe("toAppPostV2FromAny", () => {
  it("produces locava.appPost v2 with media.assets[], cover, compatibility aliases, and HQ primary playback", () => {
    const app = toAppPostV2FromAny(legacyVideoPlaybackLabRaw, { postId: "post_b937d784b8b13248" });
    expect(app.schema.name).toBe("locava.appPost");
    expect(app.schema.version).toBe(2);
    expect(app.media.assets.length).toBe(1);
    expect(app.media.cover.url ?? app.media.cover.posterUrl).toBeTruthy();
    const v = app.media.assets[0];
    expect(v?.type).toBe("video");
    if (v?.type === "video") {
      expect(v.video.playback.previewUrl).toContain("preview360_avc");
      expect(v.video.playback.primaryUrl).toContain("upgrade1080_faststart_avc");
      expect(v.video.playback.startupUrl).toContain("startup720_faststart_avc");
      expect(v.video.playback.primaryUrl).not.toContain("preview360_avc");
    }
    expect(app.compatibility.photoLink).toBeTruthy();
    expect(app.compatibility.displayPhotoLink).toBeTruthy();
  });

  it("preserves multi-image asset order without duplicating the first asset", () => {
    const raw = {
      id: "multi",
      userId: "u1",
      createdAt: "2026-05-04T10:00:00.000Z",
      title: "multi",
      caption: "",
      activities: [],
      assets: [
        {
          id: "a1",
          type: "image",
          original: "https://cdn/a1.jpg",
          variants: { md: { webp: "https://cdn/a1-md.webp" }, thumb: { webp: "https://cdn/a1-thumb.webp" } }
        },
        {
          id: "a2",
          type: "image",
          original: "https://cdn/a2.jpg",
          variants: { md: { webp: "https://cdn/a2-md.webp" }, thumb: { webp: "https://cdn/a2-thumb.webp" } }
        }
      ]
    };
    const app = toAppPostV2FromAny(raw, { postId: "multi" });
    expect(app.media.assetCount).toBe(2);
    expect(app.media.assets.map((x) => x.id)).toEqual(["a1", "a2"]);
    const ids = app.media.assets.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses engagement audit counts when provided", () => {
    const audit = {
      postDoc: {
        likeCount: 1,
        likesArrayCount: 0,
        commentsCount: 2,
        commentsArrayCount: 0,
        likesVersion: 1,
        commentsVersion: 2
      },
      subcollections: {
        likesPath: "posts/x/likes",
        likesCount: 9,
        recentLikers: [
          {
            userId: "u_like",
            displayName: "L",
            handle: "l",
            profilePicUrl: null,
            likedAt: "2026-05-04T10:00:00.000Z"
          }
        ],
        likesQueryError: null,
        commentsPath: "posts/x/comments",
        commentsCount: 9,
        recentComments: [],
        commentsQueryError: null
      },
      recommendedCanonical: {
        likeCount: 9,
        commentCount: 9,
        likesVersion: 1,
        commentsVersion: 2
      },
      selectedSource: { likes: "subcollection", comments: "subcollection" },
      mismatches: [],
      warnings: []
    } as unknown as PostEngagementSourceAuditV2;

    const raw = {
      ...legacyVideoPlaybackLabRaw,
      likeCount: 1,
      likesCount: 1,
      commentsCount: 2,
      likes: [],
      comments: []
    };
    const app = toAppPostV2FromAny(raw, { postId: "post_b937d784b8b13248", engagementSourceAudit: audit });
    expect(app.engagement.likeCount).toBe(9);
    expect(app.engagement.commentCount).toBe(9);
    expect(app.engagementPreview.recentLikers[0]?.userId).toBe("u_like");
  });

  it("reads stored canonical Master Post V2 directly when schema matches (no normalize path)", () => {
    const { canonical } = normalizeMasterPostV2(legacyVideoPlaybackLabRaw, { postId: "post_b937d784b8b13248" });
    const clonedMaster = JSON.parse(JSON.stringify(canonical)) as Record<string, unknown>;
    const { master, normalizedFromLegacy } = toMasterPostV2FromAnyWithProvenance(clonedMaster, {});
    expect(normalizedFromLegacy).toBe(false);
    const app = toAppPostV2FromAny(clonedMaster, {});
    expect(app.schema.normalizedFromLegacy).toBe(false);
    expect(master.media.assets.length).toBe(app.media.assets.length);
  });

  it("surface compare projections report derivesFromAppPostV2 and consistent asset ids", () => {
    const app = toAppPostV2FromAny(legacyVideoPlaybackLabRaw, { postId: "post_b937d784b8b13248" });
    const cmp = buildSurfaceComparePayload(app);
    for (const row of Object.values(cmp.projections)) {
      expect(row.derivesFromAppPostV2).toBe(true);
      expect(row.postContractVersion).toBe(2);
      expect(row.viewerState.liked).toBe(app.viewerState.liked);
      expect(row.legacyCompat.mediaType).toBe(app.compatibility.mediaType);
      expect(row.mediaAssetCount).toBe(app.media.assets.length);
      expect(row.assetIds).toEqual(app.media.assets.map((a) => a.id));
    }
  });

  it("preserves cover and per-asset letterbox gradients through AppPost and projections", () => {
    const raw = {
      id: "post_3a42f16570830ea9",
      userId: "u1",
      createdAt: "2026-05-04T10:00:00.000Z",
      assets: [
        { id: "a1", type: "image", original: "https://cdn/a1.jpg", variants: { md: { webp: "https://cdn/a1-md.webp" } } },
        { id: "a2", type: "image", original: "https://cdn/a2.jpg", variants: { md: { webp: "https://cdn/a2-md.webp" } } },
        { id: "a3", type: "image", original: "https://cdn/a3.jpg", variants: { md: { webp: "https://cdn/a3-md.webp" } } }
      ],
      letterboxGradients: [{ top: "#1f2937", bottom: "#111827" }]
    };
    const app = toAppPostV2FromAny(raw, { postId: "post_3a42f16570830ea9" });
    expect(app.media.cover.gradient?.top).toBe("#1f2937");
    expect(app.media.cover.gradient?.bottom).toBe("#111827");
    expect(app.media.assets).toHaveLength(3);
    for (const asset of app.media.assets) {
      expect(asset.presentation.letterboxGradient?.top).toBe("#1f2937");
      expect(asset.presentation.letterboxGradient?.bottom).toBe("#111827");
    }
    const compare = buildSurfaceComparePayload(app);
    expect(compare.projections.feedCard.validationWarnings).not.toContain("dropped_cover_gradient_from_full_app_post");
    expect(compare.projections.profileDetail.validationWarnings).not.toContain("dropped_asset_gradients_from_full_app_post");
  });
});
