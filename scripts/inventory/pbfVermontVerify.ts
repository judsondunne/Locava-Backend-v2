/**
 * Read-only Vermont PBF verification: balanced dry-run + place diagnostics.
 *
 * Run: npx tsx scripts/inventory/pbfVermontVerify.ts
 */
import path from "node:path";
import { dryRunPbfFirstAccepted } from "../../src/admin/openstreetmap/national/pbfCopier/pbfCopierService.js";
import { diagnosePlaceInPbf } from "../../src/admin/openstreetmap/national/pbfCopier/pbfCopierDiagnosePlace.js";
import { DEFAULT_VERMONT_PBF_PATH } from "../../src/admin/openstreetmap/national/pbfCopier/pbfCopierPathHelpers.js";

const PBF = path.resolve(process.cwd(), DEFAULT_VERMONT_PBF_PATH);

const PLACES = [
  "Olcot Falls Mobile Home Park",
  "Cedar Beach",
  "Crystal Beach",
  "Ithiel Falls",
  "Forest City Trail",
];

async function diagnoseAll() {
  console.log("\n=== PLACE DIAGNOSTICS ===");
  for (const searchText of PLACES) {
    const result = await diagnosePlaceInPbf({
      filePath: PBF,
      searchText,
      maxRawObjectsToScan: null,
      stateCode: "VT",
    });
    const match = result.matches[0];
    console.log(`\n--- ${searchText} ---`);
    console.log("  matches:", result.matches.length);
    console.log("  nodesScanned:", result.nodesScanned, "waysScanned:", result.waysScanned);
    if (match) {
      console.log("  osmType:", match.osmType, "osmId:", match.osmId);
      console.log("  tags:", JSON.stringify(match.tags));
      console.log("  classifierDecision:", match.classifierDecision);
      console.log("  rejectionReason:", match.rejectionReason);
      console.log("  primaryCategory:", match.primaryCategory);
      console.log("  activities:", match.activities.join(", ") || "(none)");
      console.log("  wouldBuildSpot:", match.wouldBuildSpot, "wouldBuildRoute:", match.wouldBuildRoute);
    } else {
      console.log("  (no match found in scan)");
    }
  }
}

async function balancedDryRun() {
  console.log("\n=== BALANCED VERMONT DRY-RUN ===");
  console.log("file:", PBF);
  const run = await dryRunPbfFirstAccepted({
    filePath: PBF,
    acceptedLimit: 100,
    maxRawObjectsToScan: null,
    config: {
      filePath: PBF,
      stateCode: "VT",
      balancedPreview: true,
      requireWaysBeforeStop: true,
      dryRunLimit: 100,
      dryRunNodePhaseCap: 15,
      dryRunNodeSpotLimit: 55,
      dryRunWaySpotLimit: 25,
      dryRunRouteLimit: 20,
      minWayCandidatesBeforeStop: 5,
    },
  });

  const m = run.metrics;
  const rtd = run.routeTrailDiagnostics;
  console.log("status:", run.status, "phase:", run.phase);
  console.log("rawObjectsScanned:", m.rawObjectsScanned);
  console.log("nodesScanned:", m.nodesScanned, "waysScanned:", m.waysScanned, "relationsScanned:", m.relationsScanned);
  console.log("candidatesSentToClassifier:", m.candidatesSentToClassifier);
  console.log("docsPreviewed:", m.docsPreviewed, "docsWritten:", m.docsWritten);
  console.log("acceptedSpots:", m.acceptedSpots, "acceptedRoutes:", m.acceptedRoutes);
  console.log("routeTrailDiagnostics:", JSON.stringify(rtd));
  console.log("scanStopReason:", run.scanStopReason);
  console.log("scanWarnings:", run.scanWarnings.slice(0, 5));

  const nameInferred = run.previewDocs.filter((d) => d.nameInferenceUsed === true);
  const routes = run.previewDocs.filter((d) => d.kind === "unexplored_route");
  const ways = run.previewDocs.filter((d) => d.osmType === "way");
  console.log("previewDocs:", run.previewDocs.length);
  console.log("nameInferredPreviews:", nameInferred.length);
  console.log("wayPreviews:", ways.length, "routePreviews:", routes.length);

  const bad = run.previewDocs.find((d) =>
    /olcot falls mobile home park/i.test(d.displayName ?? d.title ?? "")
  );
  console.log("Olcot Falls in preview:", bad ? "YES (BAD)" : "NO (good)");

  console.log("\nSample previews:");
  for (const doc of run.previewDocs.slice(0, 8)) {
    console.log(
      `  - ${doc.displayName ?? doc.title} [${doc.osmType}] cat=${doc.primaryCategory} acts=${(doc.activities ?? []).slice(0, 3).join(",")} nameHint=${doc.nameInferenceUsed ?? false}`
    );
  }
  if (routes.length > 0) {
    console.log("\nSample routes:");
    for (const doc of routes.slice(0, 3)) {
      console.log(`  - ${doc.displayName ?? doc.title} geom=${doc.routeGeometry ? "yes" : "no"}`);
    }
  }

  return run;
}

async function main() {
  await diagnoseAll();
  await balancedDryRun();
  console.log("\n=== SAFETY ===");
  console.log("writeTarget: none, docsWritten: 0 expected, postsWriteForbidden: true");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
