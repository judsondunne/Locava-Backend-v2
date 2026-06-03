/**
 * Read-only parity audit: compare Overpass/fixture classification vs direct
 * classifyOpenStreetMapFeaturesForInventory (same path PBF copier uses).
 *
 * Run: npx tsx scripts/inventory/pbfOsmParityAudit.ts
 */
import { classifyHartlandOpenStreetMapFeatures } from "../../src/admin/openstreetmap/openstreetmap.service.js";
import { classifyOpenStreetMapFeaturesForInventory } from "../../src/admin/openstreetmap/openstreetmap.service.js";

async function main() {
  const overpass = await classifyHartlandOpenStreetMapFeatures({ source: "fixture" });
  const direct = await classifyOpenStreetMapFeaturesForInventory({
    rawFeatures: overpass.rawFeatures,
    elementsById: new Map(),
    source: "fixture",
    stateCode: "VT",
    regionKey: overpass.regionKey,
    label: overpass.label,
    bbox: overpass.bbox,
    offroadSource: "osm",
  });

  const overpassKeys = new Set([
    ...overpass.acceptedSpots.map((s) => s.sourceKey),
    ...overpass.acceptedRoutes.map((r) => r.sourceKey),
  ]);
  const directKeys = new Set([
    ...direct.acceptedSpots.map((s) => s.sourceKey),
    ...direct.acceptedRoutes.map((r) => r.sourceKey),
  ]);

  const onlyOverpass = [...overpassKeys].filter((k) => !directKeys.has(k));
  const onlyDirect = [...directKeys].filter((k) => !overpassKeys.has(k));

  const overpassActivities = new Map<string, string[]>();
  for (const s of overpass.acceptedSpots) {
    overpassActivities.set(s.sourceKey, s.activities ?? []);
  }
  for (const r of overpass.acceptedRoutes) {
    overpassActivities.set(r.sourceKey, r.activities ?? []);
  }

  let activityMismatch = 0;
  for (const key of overpassKeys) {
    if (!directKeys.has(key)) continue;
    const directItem = [...direct.acceptedSpots, ...direct.acceptedRoutes].find((x) => x.sourceKey === key);
    const overpassActs = (overpassActivities.get(key) ?? []).slice().sort().join(",");
    const directActs = (directItem?.activities ?? []).slice().sort().join(",");
    if (overpassActs !== directActs) activityMismatch += 1;
  }

  console.log("PBF/OSM CLASSIFIER PARITY AUDIT (Hartland fixture)");
  console.log("- dataset: same rawFeatures from fixture GeoJSON");
  console.log("- rawFeatures:", overpass.rawFeatures.length);
  console.log("- overpassPathAccepted:", overpassKeys.size);
  console.log("- pbfClassifierPathAccepted:", directKeys.size);
  console.log("- sameClassifierDecision:", onlyOverpass.length === 0 && onlyDirect.length === 0);
  console.log("- activityMismatches:", activityMismatch);
  console.log("- onlyOverpass:", onlyOverpass.slice(0, 10));
  console.log("- onlyDirect:", onlyDirect.slice(0, 10));
  console.log("- overpassRejected:", overpass.rejected.length);
  console.log("- directRejected:", direct.rejected.length);
  console.log("");
  console.log("NOTES:");
  console.log("- Geofabrik PBF and Overpass are the same OSM dataset.");
  console.log("- Overpass returns pre-resolved geometry (out geom); PBF needs adapter geometry.");
  console.log("- If PBF dry-run misses trails, likely causes: stop-before-ways, missing way geometry, or tag filter.");
  console.log("- productionWritesBlocked:", overpass.productionWritesBlocked);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
