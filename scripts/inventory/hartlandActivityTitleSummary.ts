import { classifyHartlandOpenStreetMapFeatures } from "../../src/admin/openstreetmap/openstreetmap.service.js";
import { searchOpenStreetMapClassification } from "../../src/admin/openstreetmap/openstreetmap.search.service.js";

async function main() {
  const result = await classifyHartlandOpenStreetMapFeatures({ source: "overpass" });
  const at = result.diagnostics.activityTitleDiagnostics;

  const searchSunset = searchOpenStreetMapClassification({ runId: result.runId, q: "sunset view", limit: 20 });
  const searchSwim = searchOpenStreetMapClassification({ runId: result.runId, q: "swimming hole", limit: 20 });
  const searchOffroad = searchOpenStreetMapClassification({ runId: result.runId, q: "offroading", limit: 20 });
  const searchForestHike = searchOpenStreetMapClassification({ runId: result.runId, q: "forest hike", limit: 20 });
  const searchWaterfall = searchOpenStreetMapClassification({ runId: result.runId, q: "waterfall hike", limit: 20 });
  const searchIceCream = searchOpenStreetMapClassification({ runId: result.runId, q: "ice cream", limit: 20 });
  const searchHistoric = searchOpenStreetMapClassification({ runId: result.runId, q: "historic museum", limit: 20 });

  const readyPublic = result.acceptedSpots.filter((s) => s.mapReadiness === "ready").length +
    result.acceptedRoutes.filter((r) => r.mapReadiness === "ready").length;
  const hidden = result.acceptedSpots.filter((s) => s.mapReadiness === "hidden").length +
    result.acceptedRoutes.filter((r) => r.mapReadiness === "hidden").length;
  const review = result.acceptedSpots.filter((s) => s.mapReadiness === "review").length +
    result.acceptedRoutes.filter((r) => r.mapReadiness === "review").length;

  const topPrimary = Object.entries(at?.byPrimaryActivity ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  console.log("LOCAVA ACTIVITY + TITLE INTELLIGENCE SUMMARY");
  console.log("- totalItems:", at?.totalItems ?? 0);
  console.log("- readyItems:", at?.readyItems ?? 0);
  console.log("- hiddenItems:", at?.hiddenItems ?? 0);
  console.log("- reviewItems:", at?.reviewItems ?? 0);
  console.log("- itemsWithPrimaryActivity:", at?.itemsWithPrimaryActivity ?? 0);
  console.log("- itemsMissingPrimaryActivity:", at?.itemsMissingPrimaryActivity ?? 0);
  console.log("- generatedTitles:", at?.generatedTitles?.length ?? 0);
  console.log("- weakTitles:", at?.weakTitles?.length ?? 0);
  console.log("- naturalFeaturesKept:", at?.naturalFeaturesKept?.length ?? 0);
  console.log("- nicheReadyItems:", at?.nicheReadyItems?.length ?? 0);
  console.log("- hiddenJunkItems:", at?.badTitlesHidden?.length ?? 0);
  console.log("- suspiciousReadyItems:", at?.suspiciousReadyItems?.length ?? 0);
  console.log("- topPrimaryActivities:", JSON.stringify(topPrimary));
  console.log("- activityCombos:", JSON.stringify(at?.activityCombos ?? {}));
  console.log("- publicTileItemCount:", readyPublic);
  console.log("- debugTileItemCount:", hidden + review);
  console.log("- diagnosticsReady:", Boolean(at));
  console.log("- productionWritesBlocked:", result.productionWritesBlocked);
  console.log("- searchSunsetView:", searchSunset?.total ?? 0);
  console.log("- searchSwimmingHole:", searchSwim?.total ?? 0);
  console.log("- searchOffroading:", searchOffroad?.total ?? 0);
  console.log("- searchForestHike:", searchForestHike?.total ?? 0);
  console.log("- searchWaterfallHike:", searchWaterfall?.total ?? 0);
  console.log("- searchIceCream:", searchIceCream?.total ?? 0);
  console.log("- searchHistoricMuseum:", searchHistoric?.total ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
