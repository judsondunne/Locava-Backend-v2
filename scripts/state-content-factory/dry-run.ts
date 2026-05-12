import { loadEnv } from "../../src/config/env.js";
import { startStateContentFactoryRun } from "../../src/lib/state-content-factory/stateContentFactoryDevRunner.js";
import { getStateContentFactoryRun } from "../../src/lib/state-content-factory/stateContentFactoryRunStore.js";

const args = process.argv.slice(2);

function readArg(name: string, fallback?: string): string | undefined {
  const direct = args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
  if (direct) return direct;
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1] && !args[index + 1]!.startsWith("--")) {
    return args[index + 1];
  }
  return fallback;
}

const env = loadEnv();
const stateName = readArg("stateName", "Vermont")!;
const stateCode = readArg("stateCode", "VT");
const candidateLimit = Number(readArg("candidateLimit", "100"));
const maxPlacesToProcess = Number(readArg("maxPlacesToProcess", "20"));
const includeMediaSignals = readArg("includeMediaSignals", "true") !== "false";
const wikimediaMode = (readArg("wikimediaMode", "balanced") ?? "balanced") as "fast_preview" | "balanced" | "exhaustive";
const locationTrustMode = (readArg("locationTrustMode", "asset_geotag_required") ?? "asset_geotag_required") as
  | "asset_geotag_required"
  | "legacy_place_fallback_allowed";
const debugPlaceResults = readArg("debugPlaceResults", "true") !== "false";
const qualityPreviewMode = (readArg("qualityPreviewMode", "preview_all") ?? "preview_all") as
  | "strict"
  | "normal"
  | "preview_all";
const priorityQueues = (readArg("priorityQueues", "P0,P1") ?? "P0,P1")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean) as Array<"P0" | "P1" | "P2" | "P3">;

const run = startStateContentFactoryRun({
  env,
  config: {
    runKind: "full",
    stateName,
    stateCode,
    runMode: "dry_run",
    placeSource: "wikidata",
    placeDiscoveryMode: "fast_targeted",
    candidateLimit,
    priorityQueues,
    maxPlacesToProcess,
    includeMediaSignals,
    qualityThreshold: "normal",
    qualityPreviewMode,
    maxPostPreviewsPerPlace: Number(readArg("maxPostPreviewsPerPlace", "10")),
    maxAssetsPerPostPreview: 8,
    groupTimeWindowMinutes: 180,
    totalTimeoutMs: Number(readArg("totalTimeoutMs", "300000")),
    perPlaceTimeoutMs: Number(readArg("perPlaceTimeoutMs", "25000")),
    wikimediaMode,
    wikimediaFetchAllExhaustive: readArg("wikimediaFetchAllExhaustive", "false") !== "false",
    locationTrustMode,
    allowStagingWrites: false,
    allowPublicPublish: false,
  },
});

while (true) {
  const current = getStateContentFactoryRun(run.runId);
  if (!current || current.status === "completed" || current.status === "failed") {
    const result = current?.result;
    const payload = {
      runId: run.runId,
      status: current?.status,
      error: current?.error,
      elapsedMs: result?.elapsedMs,
      usingPostGenerationEntrypoint: result?.usingPostGenerationEntrypoint,
      wikimediaFetchAllExhaustive: result?.wikimediaFetchAllExhaustive,
      wikimediaMode: result?.wikimediaMode,
      selectedPlaces: result?.counts.selectedPlaces,
      placesProcessed: result?.counts.placesProcessed,
      placesWithPreviews: result?.counts.placesWithPreviews,
      placesWithNoMedia: result?.counts.placesWithNoMedia,
      placesWithNoPostPreviews: result?.counts.placesWithNoPostPreviews,
      postPreviewsGenerated: result?.counts.postPreviewsGenerated,
      stageablePostPreviews: result?.counts.postPreviewsStageable,
      wouldStageForReview: result?.counts.wouldStageForReviewPosts ?? result?.counts.wouldStagePosts,
      wouldAutoApprove: result?.counts.wouldAutoApprovePosts,
      wouldStage: result?.counts.wouldStagePosts,
      stagedPostsCreated: result?.counts.stagedPostsCreated,
      firestoreReads: result?.budget.firestoreReads,
      firestoreWrites: result?.budget.firestoreWrites,
      publicPostsWritten: result?.publicPostsWritten,
      placeResults: debugPlaceResults
        ? result?.placeResults?.map((place) => ({
            placeName: place.placeName,
            status: place.status,
            mediaAssetsFound: place.mediaAssetsFound,
            mediaAssetsHydrated: place.mediaAssetsHydrated,
            mediaAssetsAccepted: place.mediaAssetsAcceptedForPipeline,
            mediaAssetsRejected: place.mediaAssetsRejected,
            commonsQueryStatsCount: place.commonsQueryStats?.length ?? 0,
            topRejectReasons: place.topAssetRejectReasons?.slice(0, 5),
            groupsBuilt: place.groupsBuilt,
            postPreviewsGenerated: place.postPreviewsGenerated,
            stageablePostPreviews: place.stageablePostPreviews,
            wouldStage: place.wouldStage,
            failureReason: place.failureReason,
          }))
        : undefined,
    };
    console.log(JSON.stringify(payload, null, 2));
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
