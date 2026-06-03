import { INVENTORY_MVP_DEFAULT_VIEWPORT, resolveAdminViewport } from "../../src/lib/inventory/inventoryBbox.js";
import { runOffroadDryRun } from "../../src/admin/inventory/inventoryOffroad.service.js";
import { isInventoryProductionWriteUnlocked } from "../../src/admin/inventory/inventoryWriteGuard.js";

async function main(): Promise<void> {
  const viewport = resolveAdminViewport();
  const mode = (process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "vtrans") as
    | "osm"
    | "vtrans"
    | "osm_vtrans";

  const result = await runOffroadDryRun({
    sourceMode: mode,
    viewport: { centerLat: viewport.center.lat, centerLng: viewport.center.lng, radiusKm: 12 },
    includeClass4: true,
    includeLegalTrails: true,
  });

  const v = result.diagnostics.vtrans;
  console.log("LOCAVA VTRANS CLASS 4 IMPORT SUMMARY");
  console.log(`- bbox: ${JSON.stringify(result.bbox)}`);
  console.log(`- vtransRawFeatures: ${v?.rawFeatures ?? 0}`);
  console.log(`- acceptedClass4: ${v?.acceptedClass4 ?? 0}`);
  console.log(`- acceptedLegalTrails: ${v?.acceptedLegalTrails ?? 0}`);
  console.log(`- restrictedOrClosed: ${v?.restrictedOrClosed ?? 0}`);
  console.log(`- pentRoads: ${v?.pentRoads ?? 0}`);
  console.log(`- duplicatesMergedWithOsm: ${v?.duplicatesMergedWithOsm ?? 0}`);
  console.log(`- featuresMissingGeometry: ${v?.featuresMissingGeometry ?? 0}`);
  console.log(`- totalMiles: ${v?.totalMilesFromAotMiles ?? 0}`);
  console.log(`- sampleClass4: ${JSON.stringify(v?.sampleClass4?.slice(0, 3) ?? [])}`);
  console.log(`- sampleLegalTrails: ${JSON.stringify(v?.sampleLegalTrails?.slice(0, 3) ?? [])}`);
  console.log(`- adminOffroadSourceReady: true`);
  console.log(`- diagnosticsVtransReady: ${Boolean(v?.enabled)}`);
  console.log(`- productionWritesBlocked: ${!isInventoryProductionWriteUnlocked()}`);
  console.log(`- region: ${result.label}`);
  console.log(`- totalOffroadRoutes: ${result.routes.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
