import { classifyHartlandOpenStreetMapFeatures } from "../../src/admin/openstreetmap/openstreetmap.service.js";
import { searchOpenStreetMapClassification } from "../../src/admin/openstreetmap/openstreetmap.search.service.js";

async function main() {
  const result = await classifyHartlandOpenStreetMapFeatures({ source: "overpass" });
  const d = result.diagnostics;
  const fa = d.filterAudit ?? {};
  const td = d.trailDiagnostics ?? {};
  const spotCats: Record<string, number> = {};
  for (const s of result.acceptedSpots) spotCats[s.category] = (spotCats[s.category] ?? 0) + 1;
  const routeActs: Record<string, number> = {};
  for (const r of result.acceptedRoutes) routeActs[r.activity] = (routeActs[r.activity] ?? 0) + 1;
  const search = searchOpenStreetMapClassification({ decision: "all", limit: 5 });

  console.log("LOCAVA INVENTORY TUNING V2 SUMMARY");
  console.log("- rawObjects:", result.rawObjects);
  console.log("- acceptedSpots:", result.acceptedSpots.length);
  console.log("- acceptedRoutes:", result.acceptedRoutes.length);
  console.log("- rejected:", result.rejected.length);
  console.log("- duplicatesSuppressed:", result.duplicatesSuppressed);
  console.log("- acceptedJunkCategories:", JSON.stringify(fa.acceptedJunkCategories ?? {}));
  console.log("- suspiciousSpotCategories:", JSON.stringify(fa.suspiciousSpotCategories ?? {}));
  console.log("- suspiciousRouteActivities:", JSON.stringify(fa.suspiciousRouteActivities ?? {}));
  console.log("- fullTrailsAssembled:", td.fullTrailsAssembled ?? 0);
  console.log("- relationTrails:", td.relationTrails ?? 0);
  console.log("- namedWayGroupTrails:", td.namedWayGroupTrails ?? 0);
  console.log("- singleWaySegments:", td.singleWaySegments ?? 0);
  console.log("- suppressedTinySegments:", td.suppressedTinySegments ?? 0);
  console.log("- routesWithParking:", td.routesWithParking ?? 0);
  console.log("- routesWithoutParking:", td.routesWithoutParking ?? 0);
  console.log("- routeMapHighlightReady:", td.routeMapHighlightReady ?? false);
  console.log("- searchEndpointReady:", search != null);
  console.log("- diagnosticsJsonHasFilterAudit:", Boolean(d.filterAudit));
  console.log("- diagnosticsJsonHasTrailDiagnostics:", Boolean(d.trailDiagnostics));
  console.log("- productionWritesBlocked:", result.productionWritesBlocked);
  console.log("- topSpotCategories:", JSON.stringify(Object.entries(spotCats).sort((a, b) => b[1] - a[1]).slice(0, 15)));
  console.log("- topRouteActivities:", JSON.stringify(Object.entries(routeActs).sort((a, b) => b[1] - a[1]).slice(0, 15)));
  console.log("- filterAuditVerdict:", fa.verdict);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
