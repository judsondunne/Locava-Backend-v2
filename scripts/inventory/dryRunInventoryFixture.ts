#!/usr/bin/env tsx
import { processInventorySource } from "../../src/admin/inventory/inventoryImport.service.js";
import { runOsmDebugBbox } from "../../src/admin/inventory/inventoryOsmDebug.service.js";
import { buildInventoryTilesForRun } from "../../src/admin/inventory/inventoryTileBuilder.service.js";
import { isFirestoreEmulatorActive, isInventoryProductionWriteUnlocked } from "../../src/admin/inventory/inventoryWriteGuard.js";

async function main() {
  const dryRun = await processInventorySource({ source: "fixture", writeRunDoc: false });
  const debug = await runOsmDebugBbox({ source: "fixture" });
  const tiles = await buildInventoryTilesForRun({ runId: dryRun.run.runId, dryRun: true });

  const firestoreWrites =
    dryRun.run.counts.firestoreSpotWrites +
    dryRun.run.counts.firestoreRouteWrites +
    dryRun.run.counts.firestoreTileWrites;

  console.log("OSM MIRROR MVP SUMMARY");
  console.log(`- bbox: Hartland / Upper Valley`);
  console.log(`- rawObjects: ${dryRun.run.counts.rawObjects}`);
  console.log(`- acceptedSpots: ${dryRun.run.counts.acceptedSpots}`);
  console.log(`- acceptedRoutes: ${dryRun.run.counts.acceptedRoutes}`);
  console.log(`- rejected: ${dryRun.run.counts.rejected}`);
  console.log(`- coordinateWarnings: ${debug.counts.coordinateWarnings}`);
  console.log(`- likelySwappedCoordinates: ${debug.counts.likelySwappedCoordinates}`);
  console.log(`- missingGeometry: ${debug.counts.missingGeometry}`);
  console.log(`- outsideBbox: ${debug.counts.outsideBbox}`);
  console.log(`- duplicates: ${debug.counts.duplicates}`);
  console.log(`- tilesGenerated: ${tiles.tilesGenerated}`);
  console.log(`- firestoreWrites: ${firestoreWrites}`);
  console.log(`- productionWritesBlocked: ${!isInventoryProductionWriteUnlocked()}`);
  console.log(`- emulatorActive: ${isFirestoreEmulatorActive()}`);
  console.log(`- sampleSpotNames: ${debug.sampleSpots.slice(0, 8).map((s) => s.name).join(", ")}`);
  console.log(`- sampleRouteNames: ${debug.sampleRoutes.slice(0, 6).map((r) => r.name).join(", ")}`);
  console.log(`- adminPage: /admin/inventory`);
  console.log(`- endpoints: /admin/inventory/api/osm-debug/bbox, /v2/inventory/tiles, /v2/inventory/spots/:id, /v2/inventory/routes/:id`);
  console.log(`- runId: ${dryRun.run.runId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
