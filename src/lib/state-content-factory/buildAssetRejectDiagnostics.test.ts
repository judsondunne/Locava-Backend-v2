import { describe, expect, it } from "vitest";
import { buildAssetRejectDiagnostics } from "./buildAssetRejectDiagnostics.js";
import type { WikimediaMvpCandidateAnalysis } from "../wikimediaMvp/WikimediaMvpTypes.js";

function row(overrides: Partial<WikimediaMvpCandidateAnalysis>): WikimediaMvpCandidateAnalysis {
  return {
    sourceTitle: "File:X.jpg",
    generatedTitle: "X",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
    thumbnailUrl: null,
    fullImageUrl: "https://example.com/x.jpg",
    author: null,
    license: "CC",
    credit: null,
    activities: [],
    activityReasoning: [],
    activityUncertainty: null,
    titleConfidence: "low",
    placeMatchConfidence: 0.1,
    qualityScore: 0,
    relevanceScore: 0,
    coolnessScore: 0,
    duplicateScore: null,
    duplicateReason: null,
    status: "KEEP",
    reasoning: [],
    scores: {},
    postPreview: null,
    ...overrides,
  };
}

describe("buildAssetRejectDiagnostics", () => {
  it("aggregates hygiene REJECT rows even when candidate status is KEEP", () => {
    const { topAssetRejectReasons, sampleRejectedAssets } = buildAssetRejectDiagnostics([
      row({
        status: "KEEP",
        hygieneStatus: "REJECT",
        hygieneReasons: ["low_resolution"],
      }),
    ]);
    expect(topAssetRejectReasons.length).toBeGreaterThan(0);
    expect(sampleRejectedAssets[0]?.reasons.join(" ")).toContain("low_resolution");
  });

  it("populates samples when assets are rejected for weak metadata", () => {
    const { topAssetRejectReasons, sampleRejectedAssets } = buildAssetRejectDiagnostics([
      row({
        status: "REJECT",
        reasoning: ["metadata too weak: no categories and weak place match"],
        matchedQuery: "Moss Glen Falls",
        mediaPlaceMatchScore: 12,
      }),
    ]);
    expect(topAssetRejectReasons.length).toBeGreaterThan(0);
    expect(sampleRejectedAssets.length).toBeGreaterThan(0);
  });
});
