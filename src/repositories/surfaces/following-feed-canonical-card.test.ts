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
});
