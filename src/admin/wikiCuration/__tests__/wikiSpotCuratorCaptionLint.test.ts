import { describe, expect, it } from "vitest";
import { buildCaptionStyleWarningsForDryReview } from "../wikiSpotCuratorCaptionLint.js";
import type { WikiSpotCuratorDecisionRow } from "../wikiSpotCurator.schema.js";

function baseRow(over: Partial<WikiSpotCuratorDecisionRow> & { postId: string }): WikiSpotCuratorDecisionRow {
  return {
    postId: over.postId,
    decision: over.decision ?? "publish",
    moderatorTier: over.moderatorTier ?? 4,
    visitWorthyScore: over.visitWorthyScore ?? 8,
    visualAppealScore: over.visualAppealScore ?? 8,
    authenticityScore: over.authenticityScore ?? 7,
    captionQualityScore: over.captionQualityScore ?? 7,
    finalRankForSpot: over.finalRankForSpot ?? 1,
    shouldUseInFinalSpotSet: over.shouldUseInFinalSpotSet ?? true,
    refinedTitle: over.refinedTitle ?? "T",
    refinedCaption: over.refinedCaption ?? "",
    reasons: over.reasons ?? [],
    concerns: over.concerns ?? [],
    imageNotes: over.imageNotes ?? [],
    viewType: over.viewType ?? "unknown",
    visualMagnetScore: over.visualMagnetScore ?? 5,
    locationRelation: over.locationRelation ?? "unclear",
    distanceBucket: over.distanceBucket ?? "unclear"
  };
}

describe("buildCaptionStyleWarningsForDryReview", () => {
  it("flags travel-guide filler substrings in refinedCaption", () => {
    const w = buildCaptionStyleWarningsForDryReview([
      baseRow({
        postId: "a",
        refinedCaption: "Drakes Beach offers beautiful coastal scenery and wildlife viewing."
      }),
      baseRow({ postId: "b", refinedCaption: "SICK cliffs and blue water." })
    ]);
    expect(w).toHaveLength(1);
    expect(w[0]?.postId).toBe("a");
    expect(w[0]?.patternsMatched).toContain("offers");
  });

  it("is case-insensitive", () => {
    const w = buildCaptionStyleWarningsForDryReview([
      baseRow({ postId: "x", refinedCaption: "A POPULAR SPOT for sunset photos." })
    ]);
    expect(w[0]?.patternsMatched).toContain("popular spot");
  });
});
