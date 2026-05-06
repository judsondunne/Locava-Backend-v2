import { describe, expect, it } from "vitest";
import { mergePlaybackLabResultsIntoRawPost } from "./videoFastStartRepair.js";
import { normalizeMasterPostV2 } from "./normalizeMasterPostV2.js";
import { validateMasterPostV2 } from "./validateMasterPostV2.js";
import {
  compactCanonicalPostForLiveWrite,
  isCompactCanonicalPostV2
} from "./compactCanonicalPostV2.js";
import { mediaUrlSanityCheckOnSavedCompactPost } from "./savedCompactPostHealth.js";

function verifiedMp4(label: string, url: string) {
  return {
    label,
    url,
    ok: true,
    moovHint: "moov_before_mdat_in_prefix",
    probe: {
      head: { ok: true, status: 200, contentType: "video/mp4", acceptRanges: "bytes" },
      moovHint: "moov_before_mdat_in_prefix"
    }
  };
}

describe("mergePlaybackLabResultsIntoRawPost → normalize → validate (rebuilder promotion)", () => {
  it("promotes verified ladder into nested video + passes strict validation + compact sanity", () => {
    const orig = "https://cdn.example.com/posts/p1/original.mp4";
    const raw: Record<string, unknown> = {
      id: "post_rebuilder_promo_fixture",
      schema: { name: "locava.post", version: 2 },
      userId: "u1",
      /** normalizeMasterPostV2 reads top-level title for canonical text (nested text.title alone is not enough). */
      title: "Hi",
      author: { userId: "u1" },
      lifecycle: {
        status: "active",
        isDeleted: false,
        deletedAt: null,
        createdAt: "2026-05-05T12:00:00.000Z",
        createdAtMs: 1,
        updatedAt: "2026-05-05T12:00:00.000Z",
        lastMediaUpdatedAt: null,
        lastUserVisibleAt: null
      },
      text: { title: "Hi", caption: "", description: "", content: "", searchableText: "Hi" },
      classification: { mediaKind: "video", activities: [], visibility: "public" },
      engagement: { likeCount: 0, commentCount: 0 },
      engagementPreview: { recentLikers: [], recentComments: [] },
      location: {
        coordinates: { lat: 40, lng: -74, geohash: "dr5regw" },
        display: {},
        place: {},
        regions: { city: null, state: null, country: null }
      },
      media: {
        status: "ready",
        assetCount: 1,
        assetsReady: false,
        instantPlaybackReady: false,
        assets: [
          {
            id: "vid_promo_1",
            type: "video",
            video: {
              originalUrl: orig,
              playback: {
                defaultUrl: orig,
                primaryUrl: orig,
                startupUrl: orig,
                selectedReason: "fallback_original_or_main"
              },
              variants: {},
              readiness: {
                assetsReady: false,
                instantPlaybackReady: false,
                faststartVerified: false,
                processingStatus: "ready"
              }
            }
          }
        ]
      },
      compatibility: {
        photoLink: "https://cdn.example.com/cover.jpg",
        displayPhotoLink: "https://cdn.example.com/cover.jpg",
        thumbUrl: "https://cdn.example.com/cover.jpg",
        fallbackVideoUrl: orig,
        mediaType: "video"
      }
    };

    const posterUrl = "https://cdn.example.com/p1/poster-high.jpg";
    const u360 = "https://cdn.example.com/p1/preview360_avc.mp4";
    const uMain720 = "https://cdn.example.com/p1/main720_avc.mp4";
    const u540 = "https://cdn.example.com/p1/startup540_faststart_avc.mp4";
    const u720 = "https://cdn.example.com/p1/startup720_faststart_avc.mp4";

    const repaired = mergePlaybackLabResultsIntoRawPost(raw, [
      {
        assetId: "vid_promo_1",
        generated: {
          posterHigh: posterUrl,
          preview360Avc: u360,
          main720Avc: uMain720,
          startup540FaststartAvc: u540,
          startup720FaststartAvc: u720
        },
        verifyResults: [
          {
            label: "posterHigh",
            url: posterUrl,
            ok: true,
            moovHint: "moov_before_mdat_in_prefix",
            probe: {
              head: { ok: true, status: 200, contentType: "image/jpeg", acceptRanges: "" },
              moovHint: "moov_before_mdat_in_prefix"
            }
          },
          verifiedMp4("preview360Avc", u360),
          verifiedMp4("main720Avc", uMain720),
          verifiedMp4("startup540FaststartAvc", u540),
          verifiedMp4("startup720FaststartAvc", u720)
        ],
        errors: [],
        skipped: false
      }
    ]);

    const nested = (repaired.media as { assets: Array<Record<string, unknown>> }).assets[0]!.video as Record<
      string,
      unknown
    >;
    const nPb = nested.playback as Record<string, unknown>;
    const nVar = nested.variants as Record<string, string>;
    const nRd = nested.readiness as Record<string, unknown>;
    expect(nVar.startup720FaststartAvc).toBe(u720);
    expect(nVar.startup540FaststartAvc).toBe(u540);
    expect(nPb.primaryUrl).toBe(u720);
    expect(nPb.poorNetworkUrl).toBe(u540);
    expect(nPb.fallbackUrl).toBe(orig);
    expect(nRd.faststartVerified).toBe(true);

    const normalized = normalizeMasterPostV2(repaired, {
      postId: "post_rebuilder_promo_fixture",
      strict: true
    });
    expect(normalized.errors.length).toBe(0);

    const validation = validateMasterPostV2(normalized.canonical);
    expect(validation.blockingErrors).toEqual([]);
    expect(validation.status === "valid" || validation.status === "warning").toBe(true);

    const v0 = normalized.canonical.media.assets[0]!.video!;
    expect(v0.variants.startup720FaststartAvc).toBe(u720);
    expect(v0.variants.startup540FaststartAvc).toBe(u540);
    const pb0 = v0.playback as Record<string, string | null>;
    expect(pb0.defaultUrl).toBe(u720);
    expect(pb0.primaryUrl).toBe(u720);
    expect(pb0.startupUrl).toBe(u720);
    expect(pb0.poorNetworkUrl).toBe(u540);
    expect(pb0.selectedReason).toBe("verified_startup_avc_faststart_720");
    expect(v0.readiness.faststartVerified).toBe(true);
    expect(v0.readiness.instantPlaybackReady).toBe(true);
    expect(v0.readiness.assetsReady).toBe(true);
    expect(normalized.canonical.media.assetsReady).toBe(true);
    expect(normalized.canonical.media.instantPlaybackReady).toBe(true);
    expect(normalized.canonical.compatibility.fallbackVideoUrl).toBe(orig);
    expect(normalized.canonical.compatibility.photoLinks2).toBe(u720);
    expect(normalized.canonical.compatibility.photoLinks3).toBe(u720);

    const { livePost } = compactCanonicalPostForLiveWrite({
      canonical: normalized.canonical,
      rawBefore: raw,
      postId: "post_rebuilder_promo_fixture"
    });
    const compact = isCompactCanonicalPostV2(livePost);
    expect(compact.canSkipWrite).toBe(true);
    expect(mediaUrlSanityCheckOnSavedCompactPost(livePost).ok).toBe(true);
  });
});
