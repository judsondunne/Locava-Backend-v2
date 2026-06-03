/**
 * Full metadata dump for a place name in the Vermont PBF.
 * Run: npx tsx scripts/inventory/pbfDiagnosePlaceVerbose.ts "Cadys Falls"
 */
import { diagnosePlaceInPbf } from "../../src/admin/openstreetmap/national/pbfCopier/pbfCopierDiagnosePlace.js";

const searchText = process.argv[2] ?? "Cadys Falls";

async function main() {
  const r = await diagnosePlaceInPbf({
    filePath: "./data/osm/vermont-latest.osm.pbf",
    searchText,
    maxRawObjectsToScan: null,
    stateCode: "VT",
  });

  console.log("\n=== SUMMARY ===");
  console.log(r.summaryNote ?? "(single match)");
  console.log("matches:", r.matches.length);

  for (const [i, m] of r.matches.entries()) {
    console.log("\n--- Match", i + 1, ":", m.osmType + "/" + m.osmId, "---");
    console.log("name:", m.name);
    console.log("coords:", m.lat, m.lng, m.distanceMetersFromFirstMatch != null ? `(+${m.distanceMetersFromFirstMatch}m from first)` : "");
    console.log("ALL OSM tags:", JSON.stringify(m.tags, null, 2));
    console.log("Activity-relevant tags:", JSON.stringify(m.activityRelevantTags, null, 2));
    console.log("Locava nature signals (tag-only):", m.locavaNatureSignals.join(", ") || "(none)");
    console.log("Activities from tags ONLY:", m.activitiesFromTagsOnly.join(", ") || "(none)");
    console.log("Classifier:", m.classifierDecision, "score:", m.classifierScore, "reason:", m.rejectionReason);
    console.log("Primary category:", m.primaryCategory);
    console.log("Classifier activities (pipeline):", m.activities.join(", ") || "(none)");
    console.log("Would build spot/route:", m.wouldBuildSpot, m.wouldBuildRoute);
    if (m.diagnosticNote) console.log("Note:", m.diagnosticNote);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
