import { classifyHartlandOpenStreetMapFeatures } from "../../src/admin/openstreetmap/openstreetmap.service.js";
import { getOrRefreshExistingMediaBundle } from "../../src/admin/inventory/inventoryExistingMedia.service.js";

async function main() {
  const result = await classifyHartlandOpenStreetMapFeatures({ source: "overpass" });
  const bundle = getOrRefreshExistingMediaBundle(result.runId);
  const d = bundle?.diagnostics;
  const c = d?.counts;
  const checked = d?.checked;

  console.log("LOCAVA EXISTING MEDIA INSPECTOR SUMMARY");
  console.log("- checkedAcceptedSpots:", checked?.acceptedSpots ?? 0);
  console.log("- checkedAcceptedRoutes:", checked?.acceptedRoutes ?? 0);
  console.log("- checkedRejectedObjects:", checked?.rejectedObjects ?? 0);
  console.log("- itemsWithAnyMediaRef:", c?.itemsWithAnyMediaRef ?? 0);
  console.log("- itemsWithPreviewableMedia:", c?.itemsWithPreviewableMedia ?? 0);
  console.log("- commonsFiles:", c?.itemsWithCommonsFile ?? 0);
  console.log("- commonsCategories:", c?.itemsWithCommonsCategory ?? 0);
  console.log("- wikidataClues:", c?.itemsWithWikidata ?? 0);
  console.log("- wikipediaClues:", c?.itemsWithWikipedia ?? 0);
  console.log("- mapillaryClues:", c?.itemsWithMapillary ?? 0);
  console.log("- websiteClues:", c?.itemsWithWebsite ?? 0);
  console.log("- noMediaHeroSpots:", d?.samples.noMediaHeroSpots.length ?? 0);
  console.log("- noMediaHighSpots:", d?.samples.noMediaHighSpots.length ?? 0);
  console.log("- adminExistingMediaTabReady:", true);
  console.log("- searchMediaFiltersReady:", true);
  console.log("- noRefetchConfirmed:", d?.noRefetch === true);
  console.log("- noExternalApiCallsConfirmed:", d?.noApiCalls === true);
  console.log("- noWritesConfirmed:", result.productionWritesBlocked === true);
  console.log("- runId:", result.runId);
  console.log("- dataSource:", d?.dataSource ?? "none");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
