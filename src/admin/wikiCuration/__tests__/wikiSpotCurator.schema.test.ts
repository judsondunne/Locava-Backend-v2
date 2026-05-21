import { describe, expect, it } from "vitest";
import { WikiSpotCuratorAiResponseSchema } from "../wikiSpotCurator.schema.js";

describe("WikiSpotCuratorAiResponseSchema", () => {
  it("accepts stringified numeric fields from Gemini-style JSON", () => {
    const parsed = WikiSpotCuratorAiResponseSchema.safeParse({
      spotId: "spot_x",
      spotName: "Test",
      maxPostsForSpot: "3",
      summary: {
        candidateCount: "2",
        recommendedPublishCount: "1",
        recommendedSkipCount: "1",
        recommendedNeedsReviewCount: "0",
        overallReasoning: "ok"
      },
      decisions: [
        {
          postId: "p1",
          decision: "publish",
          moderatorTier: "4",
          visitWorthyScore: "8",
          visualAppealScore: "7",
          authenticityScore: "6",
          captionQualityScore: "5",
          finalRankForSpot: "1",
          shouldUseInFinalSpotSet: true,
          refinedTitle: "T",
          refinedCaption: "C",
          reasons: ["r"],
          concerns: [],
          imageNotes: []
        }
      ]
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.maxPostsForSpot).toBe(3);
      expect(parsed.data.decisions[0]?.moderatorTier).toBe(4);
      expect(parsed.data.decisions[0]?.visitWorthyScore).toBe(8);
    }
  });

  it("accepts finalRankForSpot 0 (Gemini often emits for skip/needs_review)", () => {
    const parsed = WikiSpotCuratorAiResponseSchema.safeParse({
      spotId: "spot_x",
      spotName: "Test",
      maxPostsForSpot: 3,
      summary: {
        candidateCount: 2,
        recommendedPublishCount: 1,
        recommendedSkipCount: 1,
        recommendedNeedsReviewCount: 0,
        overallReasoning: "ok"
      },
      decisions: [
        {
          postId: "p1",
          decision: "publish",
          moderatorTier: 4,
          visitWorthyScore: 8,
          visualAppealScore: 7,
          authenticityScore: 6,
          captionQualityScore: 5,
          finalRankForSpot: 1,
          shouldUseInFinalSpotSet: true,
          refinedTitle: "T",
          refinedCaption: "C",
          reasons: ["r"],
          concerns: [],
          imageNotes: []
        },
        {
          postId: "p2",
          decision: "skip",
          moderatorTier: 3,
          visitWorthyScore: 4,
          visualAppealScore: 4,
          authenticityScore: 4,
          captionQualityScore: 4,
          finalRankForSpot: 0,
          shouldUseInFinalSpotSet: false,
          refinedTitle: "S",
          refinedCaption: "",
          reasons: ["weak"],
          concerns: [],
          imageNotes: []
        }
      ]
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.decisions[1]?.finalRankForSpot).toBe(0);
    }
  });

  it("accepts locationRelation extended_context when model confuses with distanceBucket", () => {
    const parsed = WikiSpotCuratorAiResponseSchema.safeParse({
      spotId: "spot_x",
      spotName: "Test",
      maxPostsForSpot: 8,
      summary: {
        candidateCount: 1,
        recommendedPublishCount: 0,
        recommendedSkipCount: 1,
        recommendedNeedsReviewCount: 0,
        overallReasoning: "ok"
      },
      decisions: [
        {
          postId: "p1",
          decision: "skip",
          moderatorTier: 3,
          visitWorthyScore: 5,
          visualAppealScore: 5,
          authenticityScore: 5,
          captionQualityScore: 5,
          finalRankForSpot: 1,
          shouldUseInFinalSpotSet: false,
          refinedTitle: "T",
          refinedCaption: "",
          reasons: ["r"],
          concerns: [],
          imageNotes: [],
          locationRelation: "extended_context",
          distanceBucket: "nearby"
        }
      ]
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.decisions[0]?.locationRelation).toBe("extended_context");
    }
  });
});
