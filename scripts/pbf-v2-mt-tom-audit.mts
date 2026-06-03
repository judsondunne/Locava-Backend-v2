/**
 * One-off audit: Mt Tom / Woodstock VT viewport coverage for PBF Copier V2.
 * Run: npx tsx scripts/pbf-v2-mt-tom-audit.mts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanPbfViewportPreview } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2ViewportPreview.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PBF = path.join(ROOT, "data/osm/vermont-latest.osm.pbf");

/** Woodstock — Mt Tom, Billings/Faulkner, The Pogue (matches admin map screenshot). */
const MT_TOM_BBOX = {
  westLng: -72.58,
  southLat: 43.60,
  eastLng: -72.48,
  northLat: 43.66,
};

const EXPECTED_NAMES = [
  "Mt Tom",
  "Mount Tom",
  "Pogue",
  "Billings",
  "Faulkner",
  "North Ridge",
  "Mountain Road",
  "Carriage",
  "parking",
  "Parking",
  "Prosper",
  "Elm",
  "Woodstock",
];

async function main() {
  console.log("PBF:", PBF);
  console.log("Bbox:", MT_TOM_BBOX);
  const t0 = Date.now();
  const result = await scanPbfViewportPreview({ pbfPath: PBF, bbox: MT_TOM_BBOX });
  console.log("Stats:", result.stats);
  console.log("Items:", result.items.length, "elapsed", Date.now() - t0, "ms");

  const spots = result.items.filter((d) => d.kind === "unexplored_spot");
  const routes = result.items.filter((d) => d.kind === "unexplored_route");
  console.log("\nSpots:", spots.length);
  for (const d of spots.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""))) {
    console.log(`  - ${d.displayName} (${d.osmType}/${d.osmId}) ${d.primaryActivity || d.primaryCategory}`);
  }
  console.log("\nRoutes:", routes.length);
  for (const d of routes.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""))) {
    const pts = d.routeLineCoordinates?.length ?? 0;
    console.log(`  - ${d.displayName} (${d.osmType}/${d.osmId}) linePts=${pts} geom=${d.hasRouteGeometry}`);
  }

  console.log("\n--- Expected name grep ---");
  for (const needle of EXPECTED_NAMES) {
    const hits = result.items.filter((d) =>
      (d.displayName || "").toLowerCase().includes(needle.toLowerCase())
    );
    console.log(`${needle}: ${hits.length} — ${hits.map((h) => h.displayName).join("; ") || "(none)"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
