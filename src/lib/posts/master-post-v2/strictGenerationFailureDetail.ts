import type { FastStartAnalyzeResult, FastStartAssetNeeds } from "./videoFastStartRepair.js";

/** Actionable JSON for Post Rebuilder when strict mode blocks after fast-start repair analysis. */
export function buildStrictGenerationFailureDetail(input: {
  postId: string;
  unresolvedRequiredAssets: FastStartAssetNeeds[];
  analyzeAfterRepair: FastStartAnalyzeResult;
  generationErrors: string[];
  generatedAssets: Array<{ assetId: string; generated: Record<string, string> }>;
  skippedAssets: string[];
}): Record<string, unknown> {
  const classifyUrl = (url: string | null): string => {
    if (!url || !String(url).trim()) return "missing";
    const u = String(url).trim();
    if (/^https?:\/\//i.test(u)) return "present_http";
    return "present_non_http";
  };
  return {
    reason: "strict_mode_blocked_unresolved_video_variants_after_repair",
    postId: input.postId,
    analyzeSummary: {
      videoAssetCount: input.analyzeAfterRepair.videoAssetCount,
      alreadyOptimizedCount: input.analyzeAfterRepair.alreadyOptimizedCount,
      needsGenerationCount: input.analyzeAfterRepair.needsGenerationCount,
      skippedCount: input.analyzeAfterRepair.skippedCount,
      missingSourceCount: input.analyzeAfterRepair.missingSourceCount
    },
    perAsset: input.unresolvedRequiredAssets.map((a) => ({
      assetId: a.assetId,
      isVideo: a.isVideo,
      sourceUrl: a.sourceUrl,
      sourceUrlState: classifyUrl(a.sourceUrl),
      sourceWidth: a.sourceWidth,
      sourceHeight: a.sourceHeight,
      supports1080: a.supports1080,
      needs: a.needs,
      alreadyOptimized: a.alreadyOptimized,
      skipReasons: a.skipReasons
    })),
    generationErrors: input.generationErrors,
    generationErrorsDistinct: [...new Set(input.generationErrors)],
    generatedAssetIds: input.generatedAssets.map((g) => g.assetId),
    skippedAssetIds: input.skippedAssets
  };
}
