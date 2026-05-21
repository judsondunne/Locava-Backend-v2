import { describe, expect, it } from "vitest";
import { normalizeFinalRanksForCuratorDecisions } from "../wikiSpotCuratorNormalize.js";
import { enforcePublishCapAndDedupeFromPosts, type RankPostRef } from "../wikiSpotCuratorPostProcess.js";
import type { WikiSpotCuratorDecisionRow } from "../wikiSpotCurator.schema.js";

function row(partial: Partial<WikiSpotCuratorDecisionRow> & { postId: string }): WikiSpotCuratorDecisionRow {
  return {
    postId: partial.postId,
    decision: partial.decision ?? "publish",
    moderatorTier: partial.moderatorTier ?? 4,
    visitWorthyScore: partial.visitWorthyScore ?? 8,
    visualAppealScore: partial.visualAppealScore ?? 8,
    authenticityScore: partial.authenticityScore ?? 7,
    captionQualityScore: partial.captionQualityScore ?? 6,
    finalRankForSpot: partial.finalRankForSpot ?? 1,
    shouldUseInFinalSpotSet: partial.shouldUseInFinalSpotSet ?? true,
    refinedTitle: partial.refinedTitle ?? "T",
    refinedCaption: partial.refinedCaption ?? "C",
    reasons: partial.reasons ?? ["r"],
    concerns: partial.concerns ?? [],
    imageNotes: partial.imageNotes ?? [],
    viewType: partial.viewType ?? "unknown",
    visualMagnetScore: partial.visualMagnetScore ?? 5,
    locationRelation: partial.locationRelation ?? "unclear",
    distanceBucket: partial.distanceBucket ?? "unclear"
  };
}

describe("enforcePublishCapAndDedupeFromPosts", () => {
  it("keeps a strong two-photo coastal publish at rank 1 within cap", () => {
    const decisions = [
      row({ postId: "a", decision: "publish", finalRankForSpot: 1, moderatorTier: 5 }),
      row({ postId: "b", decision: "skip", finalRankForSpot: 2 })
    ];
    const postsById = new Map<string, RankPostRef>([
      ["a", { postId: "a", title: "Coast", caption: null, media: [{ imageUrl: "https://commons.wikimedia.org/a.jpg" }], primaryMediaIndex: 0 }],
      ["b", { postId: "b", title: "Sand", caption: null, media: [{ imageUrl: "https://commons.wikimedia.org/b.jpg" }], primaryMediaIndex: 0 }]
    ]);
    const out = enforcePublishCapAndDedupeFromPosts(decisions, postsById, 3);
    expect(out.find((d) => d.postId === "a")?.decision).toBe("publish");
  });

  it("downgrades extra publishes beyond maxPostsPerSpot", () => {
    const decisions = [
      row({ postId: "p1", decision: "publish", finalRankForSpot: 1 }),
      row({ postId: "p2", decision: "publish", finalRankForSpot: 2 }),
      row({ postId: "p3", decision: "publish", finalRankForSpot: 3 })
    ];
    const postsById = new Map<string, RankPostRef>(
      ["p1", "p2", "p3"].map((id) => [
        id,
        {
          postId: id,
          title: id,
          caption: null,
          media: [{ imageUrl: `https://example.com/${id}.jpg` }],
          primaryMediaIndex: 0
        }
      ])
    );
    const out = enforcePublishCapAndDedupeFromPosts(decisions, postsById, 2);
    const pubs = out.filter((d) => d.decision === "publish");
    expect(pubs).toHaveLength(2);
    expect(out.find((d) => d.postId === "p3")?.decision).toBe("skip");
  });

  it("dedupes near-identical primary image fingerprints", () => {
    const url = "https://upload.wikimedia.org/wikipedia/commons/thumb/x/y.jpg/800px-y.jpg";
    const decisions = [
      row({ postId: "a", decision: "publish", finalRankForSpot: 1 }),
      row({ postId: "b", decision: "publish", finalRankForSpot: 2 })
    ];
    const postsById = new Map<string, RankPostRef>([
      ["a", { postId: "a", title: "A", caption: null, media: [{ imageUrl: url }], primaryMediaIndex: 0 }],
      ["b", { postId: "b", title: "B", caption: null, media: [{ imageUrl: url }], primaryMediaIndex: 0 }]
    ]);
    const out = enforcePublishCapAndDedupeFromPosts(decisions, postsById, 3);
    expect(out.find((d) => d.postId === "a")?.decision).toBe("publish");
    expect(out.find((d) => d.postId === "b")?.decision).toBe("skip");
  });
});

describe("normalizeFinalRanksForCuratorDecisions", () => {
  it("coerces ranks below 1 to 999 for publish and skip rows", () => {
    const decisions = [
      row({ postId: "a", decision: "publish", finalRankForSpot: 1 }),
      row({ postId: "b", decision: "publish", finalRankForSpot: 0 }),
      row({ postId: "c", decision: "skip", finalRankForSpot: 0 })
    ];
    const out = normalizeFinalRanksForCuratorDecisions(decisions);
    expect(out[0]?.finalRankForSpot).toBe(1);
    expect(out[1]?.finalRankForSpot).toBe(999);
    expect(out[2]?.finalRankForSpot).toBe(999);
  });
});
