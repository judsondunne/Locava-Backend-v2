import { describe, expect, it } from "vitest";
import { compactCanonicalPostForLiveWrite } from "../../../lib/posts/master-post-v2/compactCanonicalPostV2.js";
import { normalizeMasterPostV2 } from "../../../lib/posts/master-post-v2/normalizeMasterPostV2.js";
import {
  applyReelsMvpPublisherFinalizePreWrite,
  extractReelsPublisherEncoderMetaFromGenerationResults
} from "../reelsMvpPublisherFinalizePreWrite.js";

const POST_ID = "post_6db4bb3c3b70443c";
const ASSET_ID = "video_reels_fixture_0";
const S720 = `https://s3.wasabisys.com/locava.app/videos-lab/${POST_ID}/${ASSET_ID}/startup720_faststart_avc.mp4`;
const M720 = `https://s3.wasabisys.com/locava.app/videos-lab/${POST_ID}/${ASSET_ID}/main720_avc.mp4`;
const P360 = `https://s3.wasabisys.com/locava.app/videos-lab/${POST_ID}/${ASSET_ID}/preview360_avc.mp4`;
const ORIG = `https://s3.wasabisys.com/locava.app/videos-lab/${POST_ID}/${ASSET_ID}/original.mp4`;

/** Mirrors reels MVP merged raw after encode: media ready flags but native lifecycle still processing. */
function reelMergedRawMixedLifecycle(): Record<string, unknown> {
  return {
    id: POST_ID,
    userId: "u1",
    userName: "Test",
    userHandle: "t",
    userPic: "https://img/user.jpg",
    activities: ["hike"],
    mediaType: "video",
    privacy: "Public Spot",
    lifecycle: { status: "processing", createdAtMs: 1, createdAt: "2026-05-10T10:00:00.000Z" },
    mediaStatus: "processing",
    videoProcessingStatus: "pending",
    assetsReady: true,
    instantPlaybackReady: true,
    createdAt: "2026-05-10T10:00:00.000Z",
    title: "Reel",
    caption: "",
    description: "",
    content: "",
    geohash: "dr4x27dhh",
    placeName: "Testville",
    moderatorTier: 0,
    likes: [],
    likesCount: 0,
    commentsCount: 0,
    rankingAggregates: { score: 1 },
    rankingRollup: { likes: 0, comments: 0, saves: 0, shares: 0 },
    posterFiles: { newPosterUrl: "https://img/poster-new.jpg" },
    variantMetadata: { poster: { width: 640, height: 1138, aspectRatio: 0.5625 } },
    playbackLab: {
      status: "ready",
      assets: {
        [ASSET_ID]: {
          generated: {
            startup720FaststartAvc: S720,
            main720Avc: M720,
            preview360Avc: P360,
            posterHigh: "https://s3.wasabisys.com/locava.app/videos-lab/poster_high.jpg"
          },
          lastVerifyResults: [
            { label: "main720Avc", url: M720, ok: true, moovHint: "moov_before_mdat_in_prefix" },
            { label: "startup720FaststartAvc", url: S720, ok: true, moovHint: "moov_before_mdat_in_prefix" }
          ]
        }
      }
    },
    assets: [
      {
        id: ASSET_ID,
        type: "video",
        original: ORIG,
        poster: "https://img/poster.jpg",
        codecs: { video: "h264", audio: "none" },
        video: {
          readiness: {
            assetsReady: true,
            instantPlaybackReady: true,
            faststartVerified: true,
            processingStatus: "pending"
          }
        }
      }
    ],
    legacy: {
      photoLinks2: P360,
      photoLinks3: M720
    },
    fallbackVideoUrl: ORIG,
    photoLink: "https://img/poster.jpg",
    displayPhotoLink: "https://img/poster.jpg",
    thumbUrl: "https://img/poster-thumb.jpg"
  };
}

describe("reelsMvpPublisherFinalizePreWrite", () => {
  it("extracts encoder meta from first successful generation row", () => {
    const meta = extractReelsPublisherEncoderMetaFromGenerationResults([
      { assetId: "a", errors: ["x"], durationSec: 10 },
      { assetId: "b", errors: [], durationSec: 14.63, hasAudio: true, bitrateKbps: 1000, sizeBytes: 99, sourceVideoCodec: "hevc", sourceAudioCodec: "aac" }
    ]);
    expect(meta?.durationSec).toBe(14.63);
    expect(meta?.hasAudio).toBe(true);
    expect(meta?.sourceVideoCodec).toBe("hevc");
  });

  it("no mixed compact state: lifecycle active when media ready (post_6db4bb3c3b70443c style)", () => {
    const raw = reelMergedRawMixedLifecycle();
    const broken = normalizeMasterPostV2(raw, { postId: POST_ID, postingFinalizeV2: true });
    expect(broken.canonical.lifecycle.status).toBe("processing");
    expect(broken.canonical.media.status).toBe("ready");

    const encoderMeta = {
      durationSec: 14.63,
      hasAudio: true,
      bitrateKbps: 37240,
      sizeBytes: 68034818,
      sourceVideoCodec: "hevc",
      sourceAudioCodec: "aac"
    };
    const patched = applyReelsMvpPublisherFinalizePreWrite(raw, encoderMeta);
    expect(patched.lifecycle).toMatchObject({ status: "active" });
    expect(patched.mediaStatus).toBe("ready");
    const a0 = (patched.assets as Record<string, unknown>[])[0];
    expect((a0?.video as Record<string, unknown>)?.readiness).toMatchObject({ processingStatus: "completed" });

    const fixed = normalizeMasterPostV2(patched as Record<string, unknown>, { postId: POST_ID, postingFinalizeV2: true });
    expect(fixed.canonical.lifecycle.status).toBe("active");
    expect(fixed.canonical.media.status).toBe("ready");
    expect(fixed.canonical.media.assets[0]?.video?.readiness?.processingStatus).toBe("completed");
    expect(fixed.canonical.media.assets[0]?.video?.durationSec).toBe(14.63);
    expect(fixed.canonical.media.assets[0]?.video?.hasAudio).toBe(true);

    const compact = compactCanonicalPostForLiveWrite({
      canonical: fixed.canonical,
      rawBefore: patched as Record<string, unknown>,
      postId: POST_ID
    });
    const live = compact.livePost as Record<string, unknown>;
    const lc = live.lifecycle as Record<string, unknown>;
    const media = live.media as Record<string, unknown>;
    expect(lc.status).toBe("active");
    expect(media.status).toBe("ready");
    expect(!(lc.status === "processing" && media.status === "ready")).toBe(true);
  });
});
