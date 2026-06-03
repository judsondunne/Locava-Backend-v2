import { classifyHartlandOpenStreetMapFeatures } from "../../src/admin/openstreetmap/openstreetmap.service.js";

async function main() {
  const result = await classifyHartlandOpenStreetMapFeatures({ source: "overpass" });
  const od = result.diagnostics.offroadDiagnostics;
  const ph = result.diagnostics.placeHierarchyDiagnostics;
  const pk = result.diagnostics.parkingDiagnostics;
  const offroadRoutes = result.acceptedRoutes.filter((r) => r.activity === "offroading");

  console.log("LOCAVA OFFROAD + PLACE HIERARCHY FINAL SUMMARY");
  console.log("- rawObjects:", result.rawObjects);
  console.log("- acceptedSpots:", result.acceptedSpots.length);
  console.log("- acceptedRoutes:", result.acceptedRoutes.length);
  console.log("- acceptedOffroadRoutes:", od?.acceptedOffroadRoutes ?? offroadRoutes.length);
  console.log("- hiddenOffroadCandidates:", od?.hiddenOffroadCandidates ?? 0);
  console.log("- rejectedOffroadCandidates:", od?.rejectedOffroadCandidates ?? 0);
  console.log("- class4Signals:", od?.class4Signals ?? 0);
  console.log("- class6Signals:", od?.class6Signals ?? 0);
  console.log("- atvSignals:", od?.atvSignals ?? 0);
  console.log("- ohvSignals:", od?.ohvSignals ?? 0);
  console.log("- ohrvSignals:", od?.ohrvSignals ?? 0);
  console.log("- fourWdOnlySignals:", od?.fourWdOnlySignals ?? 0);
  console.log("- offroadRoutesWithParking:", od?.routesWithParking ?? 0);
  console.log("- offroadRoutesWithoutParking:", od?.routesWithoutParking ?? 0);
  console.log("- parentPlaces:", ph?.parentPlaces ?? 0);
  console.log("- childFeatures:", ph?.childFeatures ?? 0);
  console.log("- parentPlacesWithChildRoutes:", ph?.parentPlacesWithChildRoutes ?? 0);
  console.log("- parentPlacesWithChildSpots:", ph?.parentPlacesWithChildSpots ?? 0);
  console.log("- parentPlacesWithParking:", ph?.parentPlacesWithParking ?? 0);
  console.log("- routesWithParking:", pk?.routesWithParking ?? 0);
  console.log("- routesWithoutParking:", pk?.routesWithoutParking ?? 0);
  console.log("- spotParkingReady:", Boolean(pk));
  console.log("- routeParkingReady:", Boolean(pk?.routesChecked));
  console.log("- offroadDiagnosticsReady:", Boolean(od));
  console.log("- placeHierarchyDiagnosticsReady:", Boolean(ph));
  console.log("- parkingDiagnosticsReady:", Boolean(pk));
  console.log("- productionWritesBlocked:", result.productionWritesBlocked);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
