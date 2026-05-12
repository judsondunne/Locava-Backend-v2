/**
 * Primary: Huntington Gorge (matches product test). Fallback: Moss Glen Falls when
 * Commons returns zero kept assets for Huntington (common under strict hygiene).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { loadEnv } from "../../src/config/env.js";
import type { PlaceCandidate } from "../../src/lib/place-candidates/types.js";
import { processStateContentFactoryPlace } from "../../src/lib/state-content-factory/processStateContentFactoryPlace.js";
import type { StateContentFactoryRunConfig } from "../../src/lib/state-content-factory/types.js";
import { validatePreviewMediaUrls } from "../../src/lib/state-content-factory/validatePreviewMediaUrls.js";
import { runWikimediaPlacePreviewPipeline } from "../../src/lib/wikimediaMvp/runWikimediaPlacePreviewPipeline.js";

const env = loadEnv();

function baseCandidate(overrides: Partial<PlaceCandidate> & Pick<PlaceCandidate, "placeCandidateId" | "name" | "lat" | "lng">): PlaceCandidate {
  return {
    state: "Vermont",
    stateCode: "VT",
    country: "US",
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
      dedupeKey: overrides.placeCandidateId,
    },
    ...overrides,
  };
}

const huntington = baseCandidate({
  placeCandidateId: "visual-smoke-huntington",
  name: "Huntington Gorge",
  lat: 44.3673,
  lng: -72.96893,
  categories: ["gorge"],
});

const mossGlen = baseCandidate({
  placeCandidateId: "visual-smoke-moss-glen",
  name: "Moss Glen Falls",
  lat: 44.0181183,
  lng: -72.8503892,
});

const config: StateContentFactoryRunConfig = {
  runKind: "place_only",
  stateName: "Vermont",
  stateCode: "VT",
  runMode: "dry_run",
  placeSource: "wikidata",
  placeDiscoveryMode: "fast_targeted",
  candidateLimit: 50,
  priorityQueues: ["P0"],
  maxPlacesToProcess: 1,
  includeMediaSignals: true,
  qualityThreshold: "normal",
  qualityPreviewMode: "preview_all",
  maxPostPreviewsPerPlace: 10,
  maxAssetsPerPostPreview: 8,
  groupTimeWindowMinutes: 180,
  totalTimeoutMs: 120_000,
  perPlaceTimeoutMs: 90_000,
  wikimediaFetchAllExhaustive: true,
  allowStagingWrites: false,
  allowPublicPublish: false,
};

let primaryLabel = "Huntington Gorge, Vermont, VT";
let candidate = huntington;

let standalone = await runWikimediaPlacePreviewPipeline({
  env,
  placeLabel: primaryLabel,
  limitPerPlace: env.WIKIMEDIA_MVP_MAX_CANDIDATES_PER_PLACE,
  dryRun: true,
  matchStandaloneDevApi: true,
});

let factory = await processStateContentFactoryPlace({ env, config, candidate });

if (factory.placeProcessResult.previews.length === 0) {
  primaryLabel = "Moss Glen Falls, Vermont, VT";
  candidate = mossGlen;
  standalone = await runWikimediaPlacePreviewPipeline({
    env,
    placeLabel: primaryLabel,
    limitPerPlace: env.WIKIMEDIA_MVP_MAX_CANDIDATES_PER_PLACE,
    dryRun: true,
    matchStandaloneDevApi: true,
  });
  factory = await processStateContentFactoryPlace({ env, config, candidate });
}

const standaloneHasImage = standalone.placeResult.generatedPosts.some((p) =>
  p.media.some((m) => Boolean(m.thumbnailUrl?.trim() || m.fullImageUrl?.trim())),
);

const factoryMediaRows = factory.placeProcessResult.previews.flatMap((p) => p.media);
const factoryHasThumbField = factoryMediaRows.some(
  (m) => Boolean((m.thumbnailUrl || m.thumbUrl || m.fullImageUrl || m.imageUrl || "").trim()),
);

const validation = await validatePreviewMediaUrls(factory.placeProcessResult.previews, {
  maxUrlsPerPreview: 3,
  timeoutMs: 20_000,
});
const anyOk = validation.some((v) => v.imageUrlOk);

const thumbs = factoryMediaRows
  .map((m) => String(m.thumbnailUrl || m.thumbUrl || m.fullImageUrl || m.imageUrl || "").trim())
  .filter(Boolean)
  .slice(0, 10);

const html =
  `<!doctype html><html><head><meta charset="utf-8"/><title>State content visual smoke</title></head><body>` +
  `<h1>Factory thumbnails (max 10)</h1><p>Place label used: ${primaryLabel}</p>` +
  thumbs.map((u) => `<div style="margin:8px"><img src="${u}" style="max-width:200px;max-height:200px;object-fit:cover"/></div>`).join("") +
  `<pre>${JSON.stringify({ primaryLabel, standaloneHasImage, factoryHasThumbField, urlProbeAnyOk: anyOk, validation: validation.slice(0, 6) }, null, 2)}</pre>` +
  `</body></html>`;

const outDir = process.env.STATE_CONTENT_VISUAL_SMOKE_OUT ?? "/tmp";
await mkdir(outDir, { recursive: true });
const htmlPath = `${outDir}/state-content-visual-smoke.html`;
await writeFile(htmlPath, html, "utf8");

console.log(
  JSON.stringify(
    {
      htmlPath,
      primaryLabel,
      standalonePosts: standalone.placeResult.generatedPosts.length,
      factoryPreviews: factory.placeProcessResult.previews.length,
      standaloneHasImage,
      factoryHasThumbField,
      urlProbeAnyOk: anyOk,
    },
    null,
    2,
  ),
);

if (!standaloneHasImage && factory.placeProcessResult.previews.length > 0) {
  console.error("VISUAL_SMOKE_WARN: standalone had no image sample but factory had previews");
}
if (!factoryHasThumbField) {
  console.error("VISUAL_SMOKE_FAIL: factory previews missing thumbnail/full URLs on media rows");
  process.exit(1);
}
if (!anyOk && factory.placeProcessResult.previews.length > 0) {
  console.error("VISUAL_SMOKE_FAIL: URL probe found no working image responses");
  process.exit(1);
}

process.exit(0);
