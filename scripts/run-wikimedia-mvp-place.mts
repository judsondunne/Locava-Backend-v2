import { loadEnv } from "../src/config/env.js";
import { runWikimediaPlacePreviewPipeline } from "../src/lib/wikimediaMvp/runWikimediaPlacePreviewPipeline.js";

const place = process.argv.slice(2).join(" ").trim() || "Eiffel Tower, Paris, France";
const env = loadEnv();

const { runId, placeResult, summary } = await runWikimediaPlacePreviewPipeline({
  env,
  placeLabel: place,
  limitPerPlace: env.WIKIMEDIA_MVP_MAX_CANDIDATES_PER_PLACE,
  dryRun: true,
  matchStandaloneDevApi: true,
});

const previewPosts = placeResult.generatedPosts.slice(0, 3).map((post) => ({
  title: post.generatedTitle,
  originalAssetCount: post.originalAssetCount ?? post.assetCount,
  keptAssetCount: post.keptAssetCount ?? post.assetCount,
  rejectedDuplicateCount: post.rejectedDuplicateCount ?? 0,
  rejectedHygieneCount: post.rejectedHygieneCount ?? 0,
  reviewAssetCount: post.reviewAssetCount ?? 0,
  removedAssets: post.removedAssets ?? [],
  selectedLocation: post.selectedLocation,
  activities: post.activities,
  status: post.status,
  reasoning: post.reasoning,
  dryRun: post.dryRunPostPreview.dryRun,
}));

console.log(
  JSON.stringify(
    {
      runId,
      place: placeResult.placeName,
      candidateCount: summary.candidateCount,
      generatedPostsCount: summary.generatedPostsCount,
      originalAssetCount: summary.originalAssetCount,
      rejectedDuplicateCount: summary.rejectedDuplicateCount,
      rejectedHygieneCount: summary.rejectedHygieneCount,
      possibleDuplicateReviewCount: summary.possibleDuplicateReviewCount,
      rejectedPanoramaCount: summary.rejectedPanoramaCount,
      rejectedLowQualityCount: summary.rejectedLowQualityCount,
      rejectedBlackAndWhiteOrFilterCount: summary.rejectedBlackAndWhiteOrFilterCount,
      multiAssetPostCount: summary.multiAssetPostCount,
      rejectedNoLocationGroupCount: summary.rejectedNoLocationGroupCount,
      previewPosts,
      budget: summary.budget,
      firestoreWritesSkippedDryRun: summary.budget.firestoreWritesSkippedDryRun,
      firestoreWritesAttempted: summary.budget.firestoreWritesAttempted,
    },
    null,
    2,
  ),
);
