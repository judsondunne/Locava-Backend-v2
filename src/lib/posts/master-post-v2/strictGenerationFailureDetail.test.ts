import { describe, expect, it } from "vitest";
import { buildStrictGenerationFailureDetail } from "./strictGenerationFailureDetail.js";
import type { FastStartAnalyzeResult, FastStartAssetNeeds } from "./videoFastStartRepair.js";

describe("buildStrictGenerationFailureDetail", () => {
  it("includes per-asset needs, source URL state, and distinct generation errors", () => {
    const unresolved: FastStartAssetNeeds[] = [
      {
        assetId: "vid1",
        isVideo: true,
        sourceUrl: "",
        sourceWidth: 1920,
        sourceHeight: 1080,
        supports1080: true,
        needs: {
          posterHigh: false,
          preview360Avc: true,
          main720Avc: true,
          startup540FaststartAvc: true,
          startup720FaststartAvc: true,
          startup1080FaststartAvc: true,
          upgrade1080FaststartAvc: false
        },
        skipReasons: ["source_missing"],
        alreadyOptimized: false
      }
    ];
    const analyzeAfterRepair: FastStartAnalyzeResult = {
      postId: "post_8f2bbb6641728ed1",
      videoAssetCount: 1,
      alreadyOptimizedCount: 0,
      needsGenerationCount: 1,
      skippedCount: 0,
      missingSourceCount: 1,
      assetNeeds: unresolved,
      skipReasons: []
    };
    const detail = buildStrictGenerationFailureDetail({
      postId: "post_8f2bbb6641728ed1",
      unresolvedRequiredAssets: unresolved,
      analyzeAfterRepair,
      generationErrors: ["encode_failed", "encode_failed"],
      generatedAssets: [],
      skippedAssets: []
    });
    expect(detail.reason).toBeTruthy();
    expect(detail.postId).toBe("post_8f2bbb6641728ed1");
    expect(Array.isArray(detail.perAsset)).toBe(true);
    expect((detail.perAsset as { sourceUrlState: string }[])[0]!.sourceUrlState).toBe("missing");
    expect(detail.generationErrorsDistinct).toEqual(["encode_failed"]);
  });
});
