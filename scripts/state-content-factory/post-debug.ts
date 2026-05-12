/**
 * One-place Wikimedia + post preview diagnostics (dry-run, no Firestore writes).
 *
 * Usage:
 *   npm run state-content:post-debug -- --placeName "Moss Glen Falls" --stateName Vermont --stateCode VT --lat 44.0181183 --lng -72.8503892 --wikimediaMode balanced
 */
import { loadEnv } from "../../src/config/env.js";
import type { PlaceCandidate } from "../../src/lib/place-candidates/types.js";
import { processStateContentFactoryPlace } from "../../src/lib/state-content-factory/processStateContentFactoryPlace.js";
import type { StateContentFactoryRunConfig } from "../../src/lib/state-content-factory/types.js";

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

function makeCandidate(input: {
  placeCandidateId: string;
  name: string;
  lat: number;
  lng: number;
  state: string;
  stateCode: string;
  categories: string[];
}): PlaceCandidate {
  return {
    placeCandidateId: input.placeCandidateId,
    name: input.name,
    state: input.state,
    stateCode: input.stateCode,
    country: "US",
    lat: input.lat,
    lng: input.lng,
    categories: input.categories,
    candidateTier: "A",
    sourceIds: {},
    sourceUrls: {},
    rawSources: [],
    sourceConfidence: 0.9,
    locavaScore: 0.85,
    signals: {
      hasCoordinates: true,
      hasWikipedia: false,
      hasWikidata: true,
      hasCommonsCategory: false,
      hasUsefulCategory: true,
      isOutdoorLikely: true,
      isLandmarkLikely: true,
      isTourismLikely: true,
      isTooGeneric: false,
    },
    debug: {
      matchedSourceCategories: [],
      normalizedFrom: [],
      scoreReasons: [],
      tierReasons: [],
      dedupeKey: input.placeCandidateId,
    },
  };
}

const env = loadEnv();
const placeName = readArg("placeName", "")!.trim();
const stateName = readArg("stateName", "Vermont")!;
const stateCode = readArg("stateCode", "VT")!;
const lat = Number(readArg("lat", "0"));
const lng = Number(readArg("lng", "0"));
const wikimediaMode = (readArg("wikimediaMode", "balanced") ?? "balanced") as StateContentFactoryRunConfig["wikimediaMode"];
const locationTrustMode = (readArg("locationTrustMode", "asset_geotag_required") ??
  "asset_geotag_required") as StateContentFactoryRunConfig["locationTrustMode"];

if (!placeName || !Number.isFinite(lat) || !Number.isFinite(lng)) {
  console.error("Required: --placeName ... --lat ... --lng ... (and optional --stateName --stateCode --wikimediaMode)");
  process.exit(1);
}

const candidate = makeCandidate({
  placeCandidateId: `post-debug-${placeName.replace(/\s+/g, "-").toLowerCase()}`,
  name: placeName,
  lat,
  lng,
  state: stateName,
  stateCode,
  categories: ["outdoor"],
});

const config: StateContentFactoryRunConfig = {
  runKind: "full",
  stateName,
  stateCode,
  runMode: "dry_run",
  placeSource: "wikidata",
  placeDiscoveryMode: "fast_targeted",
  candidateLimit: 20,
  priorityQueues: ["P0"],
  maxPlacesToProcess: 1,
  includeMediaSignals: true,
  qualityThreshold: "normal",
  qualityPreviewMode: "preview_all",
  maxPostPreviewsPerPlace: 8,
  maxAssetsPerPostPreview: 8,
  groupTimeWindowMinutes: 180,
  totalTimeoutMs: 120_000,
  perPlaceTimeoutMs: 60_000,
  wikimediaMode,
  wikimediaFetchAllExhaustive: wikimediaMode === "exhaustive",
  locationTrustMode,
  allowStagingWrites: false,
  allowPublicPublish: false,
};

async function main() {
  const t0 = Date.now();
  const { placeResult, evaluatedPosts, placeProcessResult } = await processStateContentFactoryPlace({
    env,
    config,
    candidate,
  });
  const ms = Date.now() - t0;

  const stats = placeProcessResult.commonsQueryStats ?? [];
  console.log(
    JSON.stringify(
      {
        runtimeMs: ms,
        errors: placeResult.errors,
        warnings: placeResult.warnings,
        partialReason: placeResult.partialReason,
        commonsQueryPlan: placeResult.commonsQueryPlan,
      },
      null,
      2,
    ),
  );
  for (const row of stats) {
    console.log(
      JSON.stringify(
        {
          query: row.query,
          queryVariantType: row.variantType,
          resultCount: row.resultCount,
          newTitlesIngested: row.newTitlesIngested,
          hydratedCount: row.hydratedCount,
          keptCount: row.keptAssetCount,
          rejectedCount: row.rejectedAssetCount,
          topRejectionReasons: row.topRejectionReasons,
        },
        null,
        2,
      ),
    );
  }

  const firstTitles = placeResult.candidateAnalysis.slice(0, 10).map((c) => c.sourceTitle);
  console.log(
    JSON.stringify(
      {
        titlesDiscovered: placeResult.titlesDiscoveredCount,
        assetsFound: placeProcessResult.mediaAssetsFound,
        assetsHydrated: placeProcessResult.mediaAssetsHydrated,
        assetsAccepted: placeProcessResult.mediaAssetsAcceptedForPipeline,
        assetsStrictKeep: placeProcessResult.mediaAssetsStrictKeep,
        assetsRejected: placeProcessResult.mediaAssetsRejected,
        assetsGrouped: placeProcessResult.mediaAssetsGroupedIntoPreviews,
        groupsBuilt: placeProcessResult.groupsBuilt,
        previewsGenerated: placeProcessResult.postPreviewsGenerated,
        stageable: placeProcessResult.stageablePostPreviews,
        needs_review: placeProcessResult.needsReviewPostPreviews,
        rejected: placeProcessResult.postPreviewsRejected,
        wouldStageForReview: placeProcessResult.wouldStageForReview,
        wouldAutoApprove: placeProcessResult.wouldAutoApprove,
        topAssetRejectReasons: placeProcessResult.topAssetRejectReasons,
        sampleRejectedAssets: placeProcessResult.sampleRejectedAssets,
        samplePreviewTitles: evaluatedPosts.map((e) => e.factoryDisplay?.title ?? e.generatedPost.generatedTitle),
        sampleThumbnailUrls: evaluatedPosts.flatMap((e) =>
          e.generatedPost.media.map((m) => m.thumbnailUrl || "").filter(Boolean),
        ),
        firstTenHydratedTitles: firstTitles,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
