import { classifyHartlandOpenStreetMapFeatures } from "../../src/admin/openstreetmap/openstreetmap.service.js";

async function main() {
  const result = await classifyHartlandOpenStreetMapFeatures({ source: "overpass" });
  const fp = result.diagnostics.finalPolishDiagnostics;
  const swim = fp?.swimmingAndBeach;

  console.log("LOCAVA INVENTORY FINAL POLISH SUMMARY");
  console.log("- rawObjects:", result.rawObjects);
  console.log("- acceptedSpots:", result.acceptedSpots.length);
  console.log("- acceptedRoutes:", result.acceptedRoutes.length);
  console.log("- rejected:", result.rejected.length);
  console.log("- swimmingAccepted:", swim?.acceptedSwimming?.length ?? 0);
  console.log("- beachesAccepted:", swim?.acceptedBeaches?.length ?? 0);
  console.log("- rejectedSwimmingBeachCandidates:", swim?.rejectedSwimmingBeachCandidates?.length ?? 0);
  console.log("- generatedNamesCount:", fp?.names?.generatedNamesCount ?? 0);
  console.log("- weakGenericAcceptedCount:", fp?.names?.weakGenericAcceptedCount ?? 0);
  console.log("- parentSpotsWithAnchors:", fp?.anchors?.parentSpotsWithAnchors ?? 0);
  console.log("- viewpointAnchoredParents:", fp?.anchors?.viewpointAnchoredParents?.length ?? 0);
  console.log("- waterfallAnchoredParents:", fp?.anchors?.waterfallAnchoredParents?.length ?? 0);
  console.log("- swimmingAnchoredParents:", fp?.anchors?.swimmingAnchoredParents?.length ?? 0);
  console.log("- beachAnchoredParents:", fp?.anchors?.beachAnchoredParents?.length ?? 0);
  console.log("- nameOnlyRejected:", fp?.names?.nameOnlyRejectedSamples?.length ?? 0);
  console.log("- privateRejected:", fp?.access?.privateRejectedCount ?? 0);
  console.log("- remainingConcerns:", fp?.remainingConcerns?.length ?? 0);
  console.log("- diagnosticsJsonHasFinalPolish:", Boolean(fp));
  console.log("- productionWritesBlocked:", result.productionWritesBlocked);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
