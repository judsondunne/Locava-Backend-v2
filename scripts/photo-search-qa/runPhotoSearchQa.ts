#!/usr/bin/env tsx
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBaseUrl, searchPlaceImagesApi } from "./apiClient.js";
import {
  createCostTracker,
  recordPlaceSearchCost,
  wouldExceedBudget,
} from "./costTracker.js";
import {
  averageHash,
  buildNormalizedUrls,
  findDuplicateIndex,
} from "./duplicateDetection.js";
import {
  probeImageUrl,
  probeSourcePage,
  validateImageMetadata,
} from "./imageValidator.js";
import {
  printBatchSummary,
  printFinalVerdict,
  writeReports,
} from "./reportWriter.js";
import { scorePlace, summarizeBatch, visionPlaceLabel } from "./scoring.js";
import { buildApiPlaceQuery, VERMONT_PHOTO_QA_SEEDS } from "./seeds.vermont.js";
import type { ImageValidationResult, PhotoQaCliOptions, PhotoQaSeedPlace, PlaceQaResult, RunState } from "./types.js";
import {
  judgeImageWithVision,
  manualVisionPlaceholder,
  resolveVisionMode,
} from "./visionJudge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseCli(argv: string[]): PhotoQaCliOptions {
  const opts: PhotoQaCliOptions = {
    target: "local",
    batchSize: 5,
    maxBatches: 1,
    runAll: false,
    resume: false,
    maxCredits: 50,
    minImages: 4,
    concurrency: 1,
    outDir: "",
    vision: "auto",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const [key, inlineVal] = body.split("=");
    const nextVal = inlineVal ?? argv[i + 1];

    switch (key) {
      case "target":
        if (inlineVal) opts.target = inlineVal as PhotoQaCliOptions["target"];
        else if (nextVal && !nextVal.startsWith("--")) {
          opts.target = nextVal as PhotoQaCliOptions["target"];
          i += 1;
        }
        break;
      case "batchSize":
        opts.batchSize = Number(nextVal ?? opts.batchSize);
        if (!inlineVal && nextVal && !nextVal.startsWith("--")) i += 1;
        break;
      case "maxBatches":
        opts.maxBatches = Number(nextVal ?? opts.maxBatches);
        if (!inlineVal && nextVal && !nextVal.startsWith("--")) i += 1;
        break;
      case "runAll":
        opts.runAll = inlineVal ? inlineVal === "true" : true;
        break;
      case "resume":
        opts.resume = inlineVal ? inlineVal === "true" : true;
        break;
      case "maxCredits":
        opts.maxCredits = Number(nextVal ?? opts.maxCredits);
        if (!inlineVal && nextVal && !nextVal.startsWith("--")) i += 1;
        break;
      case "minImages":
        opts.minImages = Number(nextVal ?? opts.minImages);
        if (!inlineVal && nextVal && !nextVal.startsWith("--")) i += 1;
        break;
      case "concurrency":
        opts.concurrency = Number(nextVal ?? opts.concurrency);
        if (!inlineVal && nextVal && !nextVal.startsWith("--")) i += 1;
        break;
      case "outDir":
        opts.outDir = inlineVal ?? nextVal ?? opts.outDir;
        if (!inlineVal && nextVal && !nextVal.startsWith("--")) i += 1;
        break;
      case "vision":
        opts.vision = (inlineVal ?? nextVal ?? opts.vision) as PhotoQaCliOptions["vision"];
        if (!inlineVal && nextVal && !nextVal.startsWith("--")) i += 1;
        break;
      default:
        break;
    }
  }

  if (opts.batchSize !== 5) {
    console.warn(`[photoqa] batchSize=${opts.batchSize} requested; harness default/spec is 5.`);
  }

  if (!opts.outDir) {
    opts.outDir = path.join(__dirname, "runs", new Date().toISOString().replace(/[:.]/g, "-"));
  }

  return opts;
}

async function loadState(outDir: string): Promise<RunState | null> {
  try {
    const raw = await readFile(path.join(outDir, "state.json"), "utf8");
    return JSON.parse(raw) as RunState;
  } catch {
    return null;
  }
}

async function processPlace(
  seed: PhotoQaSeedPlace,
  baseUrl: string,
  minImages: number,
  vision: ReturnType<typeof resolveVisionMode>,
): Promise<PlaceQaResult> {
  const apiPlaceQuery = buildApiPlaceQuery(seed);
  const validationStarted = performance.now();

  let api;
  try {
    api = await searchPlaceImagesApi(baseUrl, apiPlaceQuery);
  } catch (error) {
    return scorePlace({
      seedId: seed.id,
      placeName: seed.placeName,
      town: seed.town,
      state: seed.state,
      apiPlaceQuery,
      searchQueryUsed: apiPlaceQuery,
      provider: "none",
      responseMs: 0,
      ttfbMs: null,
      imageValidationMs: 0,
      images: [],
      minImages,
      apiError: error instanceof Error ? error.message : "fetch_failed",
    });
  }

  if (!api.ok) {
    return scorePlace({
      seedId: seed.id,
      placeName: seed.placeName,
      town: seed.town,
      state: seed.state,
      apiPlaceQuery,
      searchQueryUsed: apiPlaceQuery,
      provider: "none",
      responseMs: api.responseMs,
      ttfbMs: api.ttfbMs,
      imageValidationMs: 0,
      images: [],
      minImages,
      apiError: api.error,
    });
  }

  const normalizedUrls = buildNormalizedUrls(api.results.map((r) => r.imageUrl));
  const hashes: Array<bigint | null> = [];
  const images: ImageValidationResult[] = [];

  for (let index = 0; index < api.results.length; index += 1) {
    const result = api.results[index]!;
    const probe = await probeImageUrl(result.imageUrl);
    const meta = validateImageMetadata(result);
    const sourcePageOk = result.sourceUrl ? await probeSourcePage(result.sourceUrl) : false;
    const hash = probe.bytes ? averageHash(probe.bytes) : null;
    hashes.push(hash);
    const duplicateOfIndex = findDuplicateIndex(index, normalizedUrls, hashes, hash);

    const failureReasons: string[] = [];
    if (!probe.loadsOk) failureReasons.push("broken_image");
    if (!meta.metadataOk) failureReasons.push("missing_source_metadata");
    if (!sourcePageOk) failureReasons.push("source_page_unreachable");
    if (duplicateOfIndex != null) failureReasons.push("duplicate");

    let visionResult = null;
    if (vision.mode === "on" && vision.apiKey && probe.bytes) {
      try {
        visionResult = await judgeImageWithVision({
          seed,
          searchQuery: api.searchQuery || apiPlaceQuery,
          bytes: probe.bytes,
          contentType: probe.contentType,
          apiKey: vision.apiKey,
          model: vision.model,
        });
      } catch (error) {
        visionResult = manualVisionPlaceholder(
          error instanceof Error ? error.message : "Vision request failed",
        );
      }
    } else if (vision.mode === "manual") {
      visionResult = manualVisionPlaceholder("Automated vision unavailable — use HTML review buttons.");
    }

    images.push({
      imageId: result.id,
      imageUrl: result.imageUrl,
      caption: result.caption || result.title,
      sourceName: result.sourceName,
      sourceUrl: result.sourceUrl,
      sourceDomain: result.sourceDomain,
      provider: result.provider || api.source,
      backlinkUrl: result.backlinkUrl || result.sourceUrl,
      licenseNote: result.licenseNote,
      copyrightDisclaimer: result.copyrightDisclaimer,
      httpStatus: probe.httpStatus,
      contentType: probe.contentType,
      byteSize: probe.byteSize,
      width: probe.width ?? result.imageWidth ?? null,
      height: probe.height ?? result.imageHeight ?? null,
      loadMs: probe.loadMs,
      loadsOk: probe.loadsOk,
      metadataOk: meta.metadataOk,
      missingMetadataFields: meta.missingMetadataFields,
      sourcePageOk,
      duplicateOfIndex,
      failureReasons,
      vision: visionResult,
      placeLabel: visionPlaceLabel(visionResult),
    });
  }

  return scorePlace({
    seedId: seed.id,
    placeName: seed.placeName,
    town: seed.town,
    state: seed.state,
    apiPlaceQuery,
    searchQueryUsed: api.searchQuery || apiPlaceQuery,
    provider: api.source,
    responseMs: api.responseMs,
    ttfbMs: api.ttfbMs,
    imageValidationMs: Math.round(performance.now() - validationStarted),
    images,
    minImages,
  });
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  if (opts.batchSize <= 0) throw new Error("batchSize must be > 0");
  if (opts.maxCredits <= 0) throw new Error("maxCredits must be > 0");

  const baseUrl = resolveBaseUrl(opts.target);
  const vision = resolveVisionMode(opts.vision);
  await mkdir(opts.outDir, { recursive: true });

  let state: RunState | null = opts.resume ? await loadState(opts.outDir) : null;
  if (!state) {
    state = {
      runId: path.basename(opts.outDir),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      target: opts.target,
      baseUrl,
      batchSize: opts.batchSize,
      minImages: opts.minImages,
      maxCredits: opts.maxCredits,
      completedPlaceIds: [],
      currentBatchNumber: 0,
      estimatedProviderCalls: 0,
      estimatedCredits: 0,
      exactCostKnown: false,
      places: [],
      batches: [],
      visionMode: vision.mode,
      visionModel: vision.mode === "on" ? vision.model : null,
    };
  }

  const cost = createCostTracker();
  cost.estimatedProviderCalls = state.estimatedProviderCalls;
  cost.estimatedCredits = state.estimatedCredits;

  const pendingSeeds = VERMONT_PHOTO_QA_SEEDS.filter(
    (seed) => !state!.completedPlaceIds.includes(seed.id),
  );

  console.log("======================================================================");
  console.log("[photoqa] READ ONLY — external image search QA harness");
  console.log(`[photoqa] target=${opts.target} base=${baseUrl}`);
  console.log(`[photoqa] batchSize=${opts.batchSize} maxBatches=${opts.runAll ? "∞" : opts.maxBatches}`);
  console.log(`[photoqa] maxCredits=${opts.maxCredits} minImages=${opts.minImages}`);
  console.log(`[photoqa] vision=${vision.mode}${vision.model ? ` model=${vision.model}` : ""}`);
  console.log(`[photoqa] outDir=${opts.outDir}`);
  console.log(`[photoqa] endpoint POST /api/places/search-images`);
  console.log("======================================================================");

  if (vision.mode === "manual") {
    console.log("[photoqa] Automated vision unavailable — manual HTML review will be generated.");
  }

  let batchesRun = 0;
  while (pendingSeeds.length > 0) {
    if (!opts.runAll && batchesRun >= opts.maxBatches) break;
    if (wouldExceedBudget(cost, opts.maxCredits)) {
      console.error(`[photoqa] Budget guard: estimated credits ${cost.estimatedCredits} exceeds maxCredits ${opts.maxCredits}`);
      break;
    }

    const batchSeeds = pendingSeeds.splice(0, opts.batchSize);
    const batchPlaces: PlaceQaResult[] = [];

    for (const seed of batchSeeds) {
      if (wouldExceedBudget(cost, opts.maxCredits)) {
        pendingSeeds.unshift(seed, ...batchSeeds.slice(batchSeeds.indexOf(seed) + 1));
        break;
      }

      console.log(`[photoqa] Testing ${seed.placeName} (${seed.town}, ${seed.state})...`);
      const placeResult = await processPlace(seed, baseUrl, opts.minImages, vision);
      batchPlaces.push(placeResult);
      state.places.push(placeResult);
      state.completedPlaceIds.push(seed.id);
      state.updatedAt = new Date().toISOString();

      recordPlaceSearchCost(cost, placeResult.provider, placeResult.totalResults);
      state.estimatedProviderCalls = cost.estimatedProviderCalls;
      state.estimatedCredits = cost.estimatedCredits;

      await writeReports(state, opts.outDir);
      console.log(
        `[photoqa] ${seed.id}: ${placeResult.passFail} | images=${placeResult.totalResults} valid=${placeResult.validImageCount} response=${placeResult.responseMs}ms`,
      );
    }

    if (batchPlaces.length === 0) break;

    state.currentBatchNumber += 1;
    const batchSummary = summarizeBatch(state.currentBatchNumber, batchPlaces);
    state.batches.push(batchSummary);
    batchesRun += 1;

    await writeReports(state, opts.outDir, batchSummary);
    printBatchSummary(batchSummary);

    if (batchSummary.catastrophic) {
      console.error(`[photoqa] Catastrophic batch failure — stopping. ${batchSummary.catastrophicReasons.join("; ")}`);
      break;
    }
    if (wouldExceedBudget(cost, opts.maxCredits)) {
      console.error(`[photoqa] Budget guard after batch — stopping.`);
      break;
    }
  }

  printFinalVerdict(state);
  console.log(`[photoqa] Reports saved to ${opts.outDir}`);
  console.log(`[photoqa] Latest HTML: ${path.join(__dirname, "latest-report.html")}`);
}

main().catch((error) => {
  console.error("[photoqa] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
