import { describe, expect, it } from "vitest";
import { tryMapSimpleFeedCandidate } from "./feed-for-you-simple.repository.js";
import { buildFeedCardFromSimpleCandidate } from "../../services/surfaces/feed-for-you-simple-post-card.js";

describe("following feed shares For You simple postcard builder", () => {
  it("produces appPostV2 from bounded Firestore-shaped raw post", () => {
    const raw: Record<string, unknown> = {
      userId: "authorxxxxxxxxxx1",
      deleted: false,
      privacy: "public",
      status: "active",
      displayPhotoLink: "https://example.com/p.jpg",
      thumbUrl: "https://example.com/t.jpg",
      media: {
        assets: [
          {
            type: "image",
            id: "a1",
            image: { displayUrl: "https://example.com/full.jpg", thumbnailUrl: "https://example.com/th.jpg" },
          },
        ],
      },
      assets: [
        {
          type: "image",
          id: "a1",
          variants: { md: "https://example.com/md.jpg" },
        },
      ],
      mediaType: "image",
      userHandle: "h1",
      userName: "N1",
      likesCount: 1,
      commentCount: 0,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };
    const mapped = tryMapSimpleFeedCandidate("docId", "post-canonical-1", raw);
    expect("candidate" in mapped).toBe(true);
    if (!("candidate" in mapped)) return;
    const card = buildFeedCardFromSimpleCandidate(mapped.candidate, 0, "viewerxxxxxxxx1");
    expect(card.appPostV2 && typeof card.appPostV2 === "object").toBe(true);
    expect(card.postContractVersion).toBe(3);
    expect((card as Record<string, unknown>).likesSubcollectionCount).toBe(mapped.candidate.likeCount);
  });

  it("exposes instantPlaybackReady and posterPresent on video cards for native skip-batch", () => {
    const raw: Record<string, unknown> = {
      userId: "authorxxxxxxxxxx1",
      deleted: false,
      privacy: "public",
      status: "active",
      mediaType: "video",
      instantPlaybackReady: true,
      assetsReady: true,
      videoProcessingStatus: "ready",
      displayPhotoLink: "https://example.com/p.jpg",
      thumbUrl: "https://example.com/t.jpg",
      assets: [
        {
          type: "video",
          id: "v1",
          poster: "https://example.com/poster.jpg",
          variants: {
            startup720FaststartAvc: "https://example.com/startup720_faststart_avc.mp4",
            main720Avc: "https://example.com/main720_avc.mp4",
          },
          width: 720,
          height: 1280,
          aspectRatio: 0.5625,
        },
      ],
      userHandle: "h1",
      userName: "N1",
      likesCount: 1,
      commentCount: 0,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };
    const mapped = tryMapSimpleFeedCandidate("docId", "post-video-1", raw);
    expect("candidate" in mapped).toBe(true);
    if (!("candidate" in mapped)) return;
    mapped.candidate.instantPlaybackReady = true;
    mapped.candidate.assetsReady = true;
    mapped.candidate.videoProcessingStatus = "ready";
    const card = buildFeedCardFromSimpleCandidate(mapped.candidate, 0, "viewerxxxxxxxx1") as Record<string, unknown>;
    expect(card.instantPlaybackReady).toBe(true);
    expect(card.posterPresent).toBe(true);
    expect(card.playbackReady).toBe(true);
    expect(card.hasVideo).toBe(true);
  });
});
