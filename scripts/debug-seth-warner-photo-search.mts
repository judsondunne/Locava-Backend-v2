#!/usr/bin/env tsx
import { config as loadEnv } from "dotenv";
loadEnv();

import type { AppEnv } from "../src/config/env.js";
import { buildOsmSpecificPhotoQuery } from "../src/lib/pbf/buildOsmSpecificPhotoQuery.js";
import { enrichPreviewDocForPhotoSearch } from "../src/lib/undiscovered/enrichPreviewDocForPhotoSearch.js";
import { processPbfAssetPreviewSpot } from "../src/lib/pbf/pbfAssetPreviewSpot.js";
import { scorePhotoResultMetadata } from "../src/lib/pbf/scorePhotoResultMetadata.js";
import { scorePhotoSearchResultsForPlace } from "../src/lib/pbf/scorePhotoSearchResultsForPlace.js";
import { deriveTargetPlaceIdentityFromDoc } from "../src/lib/pbf/deriveTargetPlaceIdentity.js";
import { unexploredDocToPbfPreviewDoc } from "../src/lib/undiscovered/unexploredDocToPbfPreviewDoc.js";
import { searchPlaceImages } from "../src/lib/places/searchPlaceImages.service.js";
import { getUnexploredDocForPhotoSearch } from "../src/repositories/source-of-truth/unexplored-photo-search-firestore.adapter.js";

const SPOT_ID = "unx_spot_641506a623ee";

async function main() {
  const env = process.env as unknown as AppEnv;
  const doc = await getUnexploredDocForPhotoSearch("unexploredSpots", SPOT_ID);
  if (!doc) {
    console.error("doc not found");
    process.exit(1);
  }

  console.log("displayName:", doc.displayName ?? doc.title);
  console.log("location:", doc.location);
  console.log("lat/lng:", doc.lat, doc.lng, doc.center);
  console.log("sourceTags:", doc.sourceTags);

  const preview = unexploredDocToPbfPreviewDoc({ collection: "unexploredSpots", doc });
  const enriched = await enrichPreviewDocForPhotoSearch(preview);
  const built = buildOsmSpecificPhotoQuery(enriched);
  console.log("\nQUERY:", built);

  const identity = deriveTargetPlaceIdentityFromDoc(enriched, built);
  console.log("\nIDENTITY:", identity);

  const parsed = {
    rawLine: built.query,
    displayName: enriched.displayName,
    searchQuery: built.query,
    scoped: false,
  };
  const { results, source } = await searchPlaceImages(parsed, env, {
    resultLimit: 40,
    skipLoadVerification: true,
  });
  console.log(`\nSERPER (${source}): ${results.length} results`);
  for (const r of results.slice(0, 12)) {
    const meta = scorePhotoResultMetadata(identity, r, { scoringProfile: "undiscovered_app" });
    console.log({
      title: (r.title || r.caption || "").slice(0, 90),
      hardReject: meta.hardReject,
      score: meta.score,
      confidence: meta.confidence,
      reject: meta.rejectReasons,
      positive: meta.positiveReasons,
    });
  }

  const scored = scorePhotoSearchResultsForPlace(enriched, built, results, {
    scoringProfile: "undiscovered_app",
    strictTitleSourceMatch: false,
  });
  console.log("\nSCORED:", {
    accepted: scored.acceptedAssets.length,
    status: scored.assetStatus,
    ready: scored.assetsReady,
    topReject: scored.topRejectionReasons,
    warnings: scored.warnings,
  });

  const full = await processPbfAssetPreviewSpot(preview, {
    env,
    visionMode: "off",
    strictTitleSourceMatch: false,
    scoringProfile: "undiscovered_app",
  });
  console.log("\nFULL:", {
    status: full.item.assetPreview.assetStatus,
    accepted: full.item.assetPreview.acceptedCount,
    query: full.item.assetPreview.query,
    topReject: full.item.assetPreview.topRejectionReasons,
  });

  for (const q of [
    "Old Seth Warner Shelter Site Vermont",
    "Old Seth Warner Shelter Site Bennington Vermont",
    "Sucker Pond Bennington Vermont",
  ]) {
    const altBuilt = { ...built, query: q };
    const altParsed = { rawLine: q, displayName: enriched.displayName, searchQuery: q, scoped: false };
    const altSearch = await searchPlaceImages(altParsed, env, {
      resultLimit: 40,
      skipLoadVerification: true,
    });
    const altScored = scorePhotoSearchResultsForPlace(enriched, altBuilt, altSearch.results, {
      scoringProfile: "undiscovered_app",
      strictTitleSourceMatch: false,
    });
    console.log("\nALT QUERY:", q, "->", {
      serper: altSearch.results.length,
      accepted: altScored.acceptedAssets.length,
      status: altScored.assetStatus,
    });
  }

  const noEnrichBuilt = buildOsmSpecificPhotoQuery(preview);
  console.log("\nNO ENRICH QUERY:", noEnrichBuilt);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
