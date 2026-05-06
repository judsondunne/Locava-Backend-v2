import { describe, expect, it } from "vitest";
import {
  detectPlaybackLabGeneratedNotPromoted,
  evaluatePostRebuildReadiness,
  isCompactProcessingPostV2,
  isCompactReadyPostV2
} from "../../lib/posts/master-post-v2/compactCanonicalPostV2.js";
import { normalizeMasterPostV2 } from "../../lib/posts/master-post-v2/normalizeMasterPostV2.js";
import { playbackLabVerificationFromUrls } from "./native-async-video-post-complete.js";

describe("playbackLabVerificationFromUrls", () => {
  it("marks https urls trusted for normalize", () => {
    const v = playbackLabVerificationFromUrls(["https://x/a.mp4", "bad", ""]);
    expect(v.byUrl).toEqual({ "https://x/a.mp4": true });
  });
});

describe("detectPlaybackLabGeneratedNotPromoted", () => {
  it("flags lab startup720 with canonical fallback selectedReason", () => {
    const lab720 = "https://s3.wasabisys.com/locava.app/videos-lab/post_f0290de03fa8447f/video_x/startup720_faststart_avc.mp4";
    const original = "https://s3.wasabisys.com/locava.app/original.mp4";
    const doc = {
      lifecycle: { status: "processing" },
      media: {
        status: "processing",
        assets: [
          {
            id: "video_a_0",
            type: "video",
            original,
            video: {
              originalUrl: original,
              playback: {
                defaultUrl: original,
                primaryUrl: original,
                startupUrl: original,
                selectedReason: "original_unverified_fallback",
                fallbackUrl: original
              },
              variants: {}
            }
          }
        ]
      },
      playbackLab: {
        assets: {
          video_a_0: {
            generated: { startup720FaststartAvc: lab720, startup540FaststartAvc: "https://x/540.mp4" }
          }
        }
      }
    };
    expect(detectPlaybackLabGeneratedNotPromoted(doc as Record<string, unknown>)).toBe(true);
    const r = evaluatePostRebuildReadiness(doc as Record<string, unknown>);
    expect(r.reasons.some((x) => x.includes("generated_variants_not_promoted"))).toBe(true);
  });
});

describe("isCompactProcessingPostV2 / isCompactReadyPostV2", () => {
  it("processing fixture matches processing validator", () => {
    const doc = {
      schema: { name: "locava.post", version: 2 },
      lifecycle: { status: "processing", createdAt: "2026-01-01T00:00:00.000Z", createdAtMs: 1 },
      author: { userId: "u1" },
      text: { title: "t", searchableText: "t" },
      location: { coordinates: { lat: 1, lng: 2 }, display: {}, place: {}, regions: {} },
      classification: { mediaKind: "video" },
      media: { status: "processing", assets: [], assetCount: 0, assetsReady: false, instantPlaybackReady: false },
      engagement: { likeCount: 0, commentCount: 0 },
      engagementPreview: { recentLikers: [], recentComments: [] }
    };
    expect(isCompactProcessingPostV2(doc as Record<string, unknown>)).toBe(true);
    expect(isCompactReadyPostV2(doc as Record<string, unknown>)).toBe(false);
  });
});

describe("normalize + readiness (fast path contract)", () => {
  it("processing native raw video yields non-ready canonical playback", () => {
    const raw = {
      postId: "post_test",
      userId: "u",
      mediaStatus: "processing",
      videoProcessingStatus: "pending",
      assetsReady: false,
      instantPlaybackReady: false,
      title: "Hi",
      activities: ["misc"],
      lat: 1,
      long: 2,
      assets: [
        {
          id: "v1",
          type: "video",
          original: "https://cdn/o.mp4",
          poster: "https://cdn/p.jpg",
          variants: {}
        }
      ]
    };
    const n = normalizeMasterPostV2(raw, { postId: "post_test", postingFinalizeV2: true });
    const v = n.canonical.media.assets[0]?.video;
    expect(v?.readiness?.instantPlaybackReady).not.toBe(true);
  });
});
