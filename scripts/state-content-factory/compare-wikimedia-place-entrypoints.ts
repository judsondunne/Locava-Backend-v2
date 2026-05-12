/**
 * Side-by-side: standalone Wikimedia place pipeline vs State Content Factory place path.
 * Exit 1 on serious regressions (see bottom).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { loadEnv } from "../../src/config/env.js";
import type { PlaceCandidate } from "../../src/lib/place-candidates/types.js";
import { processStateContentFactoryPlace } from "../../src/lib/state-content-factory/processStateContentFactoryPlace.js";
import type { StateContentFactoryEvaluatedPost, StateContentFactoryRunConfig } from "../../src/lib/state-content-factory/types.js";
import { validatePreviewMediaUrls } from "../../src/lib/state-content-factory/validatePreviewMediaUrls.js";
import { runWikimediaPlacePreviewPipeline } from "../../src/lib/wikimediaMvp/runWikimediaPlacePreviewPipeline.js";
import type { WikimediaGeneratedPost } from "../../src/lib/wikimediaMvp/WikimediaMvpTypes.js";
import { evaluateGeneratedPostQuality } from "../../src/lib/state-content-factory/evaluateGeneratedPostQuality.js";
import { computeFactoryPostDisplay } from "../../src/lib/state-content-factory/computeFactoryPostDisplay.js";

const env = loadEnv();

const TEST_PLACES: Array<{
  placeCandidateId: string;
  name: string;
  lat: number;
  lng: number;
  state: string;
  stateCode: string;
}> = [
  {
    placeCandidateId: "test-huntington-gorge",
    name: "Huntington Gorge",
    lat: 44.3673,
    lng: -72.96893,
    state: "Vermont",
    stateCode: "VT",
  },
  {
    placeCandidateId: "test-hamilton-falls",
    name: "Hamilton Falls",
    lat: 43.13627,
    lng: -72.76416,
    state: "Vermont",
    stateCode: "VT",
  },
  {
    placeCandidateId: "test-moss-glen-falls",
    name: "Moss Glen Falls",
    lat: 44.0181183,
    lng: -72.8503892,
    state: "Vermont",
    stateCode: "VT",
  },
  {
    placeCandidateId: "test-rock-of-ages",
    name: "Rock of Ages Granite Quarry",
    lat: 44.186388888,
    lng: -72.4875,
    state: "Vermont",
    stateCode: "VT",
  },
];

function makeCandidate(row: (typeof TEST_PLACES)[0]): PlaceCandidate {
  return {
    placeCandidateId: row.placeCandidateId,
    name: row.name,
    state: row.state,
    stateCode: row.stateCode,
    country: "US",
    lat: row.lat,
    lng: row.lng,
    categories: ["waterfall"],
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
      dedupeKey: row.placeCandidateId,
    },
  };
}

const factoryConfigBase: StateContentFactoryRunConfig = {
  runKind: "place_only",
  stateName: "Vermont",
  stateCode: "VT",
  runMode: "dry_run",
  placeSource: "wikidata",
  placeDiscoveryMode: "fast_targeted",
  candidateLimit: 50,
  priorityQueues: ["P0", "P1"],
  maxPlacesToProcess: 5,
  includeMediaSignals: true,
  qualityThreshold: "normal",
  qualityPreviewMode: "preview_all",
  maxPostPreviewsPerPlace: 8,
  maxAssetsPerPostPreview: 8,
  groupTimeWindowMinutes: 180,
  totalTimeoutMs: 120_000,
  perPlaceTimeoutMs: 90_000,
  allowStagingWrites: false,
  allowPublicPublish: false,
  /** Match standalone `run-place` (no fetchAll) for apples-to-apples counts. */
  wikimediaFetchAllExhaustive: false,
};

function placeLabelForCompare(c: PlaceCandidate): string {
  return [c.name, `${c.state}, ${c.stateCode}`].filter(Boolean).join(", ").slice(0, 120);
}

function countQualityFromEvaluated(rows: StateContentFactoryEvaluatedPost[]) {
  return {
    stageable: rows.filter((r) => r.qualityStatus === "stageable").length,
    needs_review: rows.filter((r) => r.qualityStatus === "needs_review").length,
    rejected: rows.filter((r) => r.qualityStatus === "rejected").length,
  };
}

function summarizePath(input: {
  label: string;
  placeResult: Awaited<ReturnType<typeof runWikimediaPlacePreviewPipeline>>["placeResult"];
  evaluated?: StateContentFactoryEvaluatedPost[];
}) {
  const pr = input.placeResult;
  const s = pr.summary;
  const evaluated = input.evaluated;
  const posts = evaluated?.length ? evaluated.map((e) => e.generatedPost) : pr.generatedPosts;
  const qc = evaluated ? countQualityFromEvaluated(evaluated) : { stageable: 0, needs_review: 0, rejected: 0 };
  const firstTitles = posts.slice(0, 5).map((p) => p.generatedTitle);
  const media = posts.flatMap((p) => p.media.slice(0, 5));
  const firstThumbs = media.map((m) => m.thumbnailUrl || "").filter(Boolean).slice(0, 5);
  const firstFull = media.map((m) => m.fullImageUrl).filter(Boolean).slice(0, 5);
  const firstSources = media.map((m) => m.sourceUrl).filter(Boolean).slice(0, 5);
  const rejectReasons = evaluated
    ? evaluated.flatMap((e) => e.qualityReasons).slice(0, 20)
    : posts.flatMap((p) => (p.rejectionReasons ?? []).map((r) => `wikimedia:${r}`)).slice(0, 20);

  return {
    label: input.label,
    assetsFound: pr.candidateCount,
    assetsKept: pr.keptCount,
    assetsRejected: pr.rejectedCount,
    groupsBuilt: s.assetGroupsCount,
    groupsRejected: pr.assetGroups.filter((g) => g.rejectionReasons.length > 0).length,
    postPreviewsGenerated: posts.length,
    stageable: qc.stageable,
    needs_review: qc.needs_review,
    rejected: qc.rejected,
    firstTitles,
    firstThumbs,
    firstFull,
    firstSources,
    rejectReasons,
    warnings: pr.warnings ?? [],
    wikimediaQueryTerms: pr.wikimediaQueryTerms,
  };
}

let exitCode = 0;
function fail(msg: string) {
  console.error("COMPARE_FAIL:", msg);
  exitCode = 1;
}

for (const row of TEST_PLACES) {
  const candidate = makeCandidate(row);
  const placeLabel = placeLabelForCompare(candidate);
  console.log("\n==========", row.name, "==========");
  console.log("placeLabel (both paths):", placeLabel);

  const standaloneBundle = await runWikimediaPlacePreviewPipeline({
    env,
    placeLabel,
    limitPerPlace: env.WIKIMEDIA_MVP_MAX_CANDIDATES_PER_PLACE,
    dryRun: true,
    matchStandaloneDevApi: true,
  });
  const standaloneEvaluatedPosts: StateContentFactoryEvaluatedPost[] = standaloneBundle.placeResult.generatedPosts
    .slice(0, factoryConfigBase.maxPostPreviewsPerPlace)
    .map((generatedPost) => {
      const factoryDisplay = computeFactoryPostDisplay({ candidate, generatedPost });
      const quality = evaluateGeneratedPostQuality({
        candidate,
        generatedPost,
        qualityPreviewMode: factoryConfigBase.qualityPreviewMode,
        qualityThreshold: factoryConfigBase.qualityThreshold,
        effectiveTitle: factoryDisplay.title,
        effectiveDescription: factoryDisplay.description,
        effectiveLat: factoryDisplay.lat,
        effectiveLng: factoryDisplay.lng,
      });
      return {
        generatedPost,
        placeCandidate: candidate,
        factoryDisplay,
        qualityStatus: quality.status,
        qualityReasons: quality.reasons,
        qualityRuleFailures: quality.ruleFailures,
        qualityPrimaryFailure: quality.primaryFailure,
        duplicateHash: quality.duplicateHash,
      };
    });

  const standaloneMetrics = summarizePath({
    label: "standalone",
    placeResult: standaloneBundle.placeResult,
    evaluated: standaloneEvaluatedPosts,
  });

  const factoryOut = await processStateContentFactoryPlace({
    env,
    config: factoryConfigBase,
    candidate,
  });
  const factoryMetrics = summarizePath({
    label: "factory",
    placeResult: factoryOut.placeResult,
    evaluated: factoryOut.evaluatedPosts,
  });

  console.log("Standalone:", JSON.stringify(standaloneMetrics, null, 2));
  console.log("Factory:    ", JSON.stringify(factoryMetrics, null, 2));

  console.log("\n--- Diff (key Wikimedia counts) ---");
  const keys: Array<keyof typeof standaloneMetrics> = [
    "assetsFound",
    "assetsKept",
    "assetsRejected",
    "groupsBuilt",
    "groupsRejected",
    "postPreviewsGenerated",
  ];
  for (const k of keys) {
    if (standaloneMetrics[k] !== factoryMetrics[k]) {
      console.log(`  ${k}: standalone=${standaloneMetrics[k]} factory=${factoryMetrics[k]}`);
    }
  }

  if (standaloneMetrics.postPreviewsGenerated > 0 && factoryMetrics.postPreviewsGenerated === 0) {
    fail(`${row.name}: standalone had previews, factory produced zero`);
  }
  const sUrls = standaloneMetrics.firstFull.filter(Boolean).length;
  const fUrls = factoryMetrics.firstFull.filter(Boolean).length;
  if (sUrls > 0 && fUrls === 0) {
    fail(`${row.name}: standalone had full image URLs in sample, factory sample empty`);
  }

  const standaloneOk =
    standaloneMetrics.stageable + standaloneMetrics.needs_review > 0 ||
    standaloneMetrics.postPreviewsGenerated === 0;
  const factoryOk = factoryMetrics.stageable + factoryMetrics.needs_review > 0 || factoryMetrics.postPreviewsGenerated === 0;
  if (standaloneOk && !factoryOk && factoryMetrics.rejected === factoryMetrics.postPreviewsGenerated && factoryMetrics.postPreviewsGenerated > 0) {
    fail(`${row.name}: factory rejected all previews while standalone had usable (stageable/review) rows`);
  }

  const factoryValidation = await validatePreviewMediaUrls(factoryOut.placeProcessResult.previews, {
    maxUrlsPerPreview: 2,
    timeoutMs: 15_000,
  });
  const badUrls = factoryValidation.filter((v) => !v.imageUrlOk && (v.thumbnailUrl || v.fullImageUrl));
  if (badUrls.length) {
    console.log("Factory URL validation issues (sample):", JSON.stringify(badUrls.slice(0, 4), null, 2));
  }
}

const outDir = process.env.STATE_CONTENT_COMPARE_OUT ?? "/tmp";
await mkdir(outDir, { recursive: true });
const outPath = `${outDir}/state-content-wikimedia-compare-summary.json`;
await writeFile(outPath, JSON.stringify({ ok: exitCode === 0, places: TEST_PLACES.map((p) => p.name) }, null, 2));
console.log("\nWrote", outPath);
process.exit(exitCode);
