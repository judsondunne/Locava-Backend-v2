/**
 * Dry-run report for Ludlow / Buttermilk Falls map layer behavior at multiple zoom levels.
 * Read-only — does not write Firestore.
 *
 * Run: npx tsx scripts/map/undiscoveredLudlowRegionReport.ts
 */
import { applyUndiscoveredZoomFilter } from "../../src/services/map/undiscoveredMapLayer.zoomFilter.js";
import { normalizeUnexploredLayerDocs } from "../../src/services/map/undiscoveredMapLayer.normalizer.js";

/** ~Ludlow VT / Buttermilk Falls viewport */
const LUDLOW_BBOX = { minLng: -72.82, minLat: 43.35, maxLng: -72.58, maxLat: 43.52 };

async function main() {
  const { dryRunPbfFirstAccepted } = await import(
    "../../src/admin/openstreetmap/national/pbfCopier/pbfCopierService.js"
  );
  const { DEFAULT_VERMONT_PBF_PATH } = await import(
    "../../src/admin/openstreetmap/national/pbfCopier/pbfCopierPathHelpers.js"
  );
  const path = await import("node:path");
  const pbf = path.resolve(process.cwd(), DEFAULT_VERMONT_PBF_PATH);

  console.log("=== Ludlow region undiscovered layer dry-run (PBF classifier) ===\n");
  console.log("bbox:", LUDLOW_BBOX);
  console.log("pbf:", pbf);

  const run = await dryRunPbfFirstAccepted({
    filePath: pbf,
    acceptedLimit: 400,
    maxRawObjectsToScan: null,
    config: {
      filePath: pbf,
      stateCode: "VT",
      balancedPreview: true,
      dryRunLimit: 400,
      includeSpots: true,
      includeRoutes: true,
    },
  });

  const previews = run.previewDocs ?? [];
  const inBbox = previews.filter((doc) => {
    const lat = doc.lat;
    const lng = doc.lng;
    return (
      lat >= LUDLOW_BBOX.minLat &&
      lat <= LUDLOW_BBOX.maxLat &&
      lng >= LUDLOW_BBOX.minLng &&
      lng <= LUDLOW_BBOX.maxLng
    );
  });

  const spots = inBbox
    .filter((d) => d.collection === "unexploredSpots")
    .map((d) => ({ ...(d.writePayload ?? {}), id: d.id }));
  const routes = inBbox
    .filter((d) => d.collection === "unexploredRoutes")
    .map((d) => ({ ...(d.writePayload ?? {}), id: d.id }));

  const normalized = await normalizeUnexploredLayerDocs({ spots, routes });
  const sourceDocs = new Map<string, Record<string, unknown>>();
  for (const doc of [...spots, ...routes]) {
    if (typeof doc.id === "string") sourceDocs.set(doc.id, doc);
  }

  console.log("\n--- Generation summary (bbox-filtered preview) ---");
  console.log("raw preview docs in bbox:", inBbox.length);
  console.log("spots:", spots.length, "routes:", routes.length);
  console.log("normalized features:", normalized.features.length);
  console.log("dropped:", normalized.dropped.length);

  for (const zoom of [8, 10, 12, 14, 16]) {
    const filtered = applyUndiscoveredZoomFilter({
      features: normalized.features,
      zoom,
      sourceDocs,
    });
    console.log(`\n--- zoom ${zoom} ---`);
    console.log(JSON.stringify(filtered.counts, null, 2));
    console.log(
      "features returned:",
      filtered.features.length,
      "(clusters:",
      filtered.features.filter((f) => f.featureKind === "cluster").length,
      ")",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
