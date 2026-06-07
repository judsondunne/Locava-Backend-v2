/**
 * One-off: verify Gemini curation for Martha Canfield Library (flyer rejection).
 * Usage: npx tsx scripts/debug-pbf-martha-asset-curation.mts
 */
import { loadEnv } from "../src/config/env.js";
import { loadPbfV2FullRunChunkArtifact } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2FullRunStore.js";
import { buildOsmSpecificPhotoQuery } from "../src/lib/pbf/buildOsmSpecificPhotoQuery.js";
import { curatePbfAssetPhotos } from "../src/lib/pbf/curatePbfAssetPhotos.js";
import { searchPlaceImages } from "../src/lib/places/searchPlaceImages.service.js";

const RUN_ID = "pbfv2_1780684699318_slk3md";
const CHUNK_ID = "chunk_0_vt_42.73_-73.44";

async function main(): Promise<void> {
  const env = loadEnv();
  const artifact = await loadPbfV2FullRunChunkArtifact(RUN_ID, CHUNK_ID);
  if (!artifact) throw new Error("chunk artifact missing");
  const doc = artifact.visibleItems.find(
    (item) => item.displayName === "Martha Canfield Library" || item.sourceKeys?.includes("way/614144559"),
  );
  if (!doc) throw new Error("Martha Canfield Library not in chunk");

  const built = buildOsmSpecificPhotoQuery(doc);
  if (built.skip) throw new Error(`query skipped: ${built.skipReason}`);

  const { results } = await searchPlaceImages(
    { rawLine: built.query, displayName: doc.displayName, searchQuery: built.query, scoped: false },
    env,
    { resultLimit: 24 },
  );

  const curated = await curatePbfAssetPhotos({ doc, query: built, rawResults: results, env });
  console.log("query:", built.query);
  console.log("stats:", curated.stats);
  console.log("warnings:", curated.warnings);
  for (const asset of curated.assets) {
    const v = asset.visionJudgment;
    console.log(
      `#${asset.rank}`,
      asset.assetMatchConfidence,
      v ? `${v.assetType} p${v.placeMatchScore} q${v.visualQualityScore}` : "no-vision",
      (asset.caption || "").slice(0, 70),
      asset.sourceDomain,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
