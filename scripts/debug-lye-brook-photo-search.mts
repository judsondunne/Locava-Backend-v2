#!/usr/bin/env tsx
import { config as loadEnv } from "dotenv";
loadEnv();

import { curatePlaceImageSearchResults } from "../src/lib/pbf/curatePlaceImageSearchResults.js";
import { buildPlaceQuery, searchPlaceImages } from "../src/lib/places/searchPlaceImages.service.js";
import type { AppEnv } from "../src/config/env.js";
import { processPbfAssetPreviewSpot } from "../src/lib/pbf/pbfAssetPreviewSpot.js";
import { unexploredDocToPbfPreviewDoc } from "../src/lib/undiscovered/unexploredDocToPbfPreviewDoc.js";

const PLACE = "Lye Brook Trail, Arlington, Vermont";

async function main() {
  const env = process.env as unknown as AppEnv;
  const query = buildPlaceQuery(PLACE);
  console.log("Query:", query);

  const { results, source } = await searchPlaceImages(query, env, { resultLimit: 30 });
  console.log(`\nPipeline (${source}): ${results.length} raw results`);

  const curated = curatePlaceImageSearchResults(query, results, {
    scoringProfile: "undiscovered_app",
    strictTitleSourceMatch: false,
  });
  console.log("\nCuration:", {
    assetStatus: curated.assetStatus,
    assetsReady: curated.assetsReady,
    accepted: curated.acceptedAssets.length,
    rejected: curated.rejectedCount,
    topRejectionReasons: curated.topRejectionReasons,
  });
  for (const asset of curated.acceptedAssets.slice(0, 12)) {
    console.log("ACCEPT:", (asset.title || asset.caption || "").slice(0, 90));
  }

  const routeDoc = unexploredDocToPbfPreviewDoc({
    collection: "unexploredRoutes",
    doc: {
      id: "unx_route_lye_brook",
      displayName: "Lye Brook Trail",
      location: { city: "Arlington", state: "Vermont" },
      lat: 43.07,
      lng: -73.15,
      category: "hiking_trail",
    },
  });
  const spot = await processPbfAssetPreviewSpot(routeDoc, {
    env,
    visionMode: "off",
    strictTitleSourceMatch: false,
    scoringProfile: "undiscovered_app",
  });
  console.log("\nRoute doc pipeline:", {
    query: spot.item.assetPreview.query,
    assetStatus: spot.item.assetPreview.assetStatus,
    accepted: spot.item.assetPreview.externalAssets.length,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
