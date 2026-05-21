#!/usr/bin/env tsx
import { processInventorySource } from "../../src/admin/inventory/inventoryImport.service.js";
import { buildInventoryTilesForRun } from "../../src/admin/inventory/inventoryTileBuilder.service.js";

async function main() {
  const dryRun = await processInventorySource({ source: "fixture", writeRunDoc: false });
  const tiles = await buildInventoryTilesForRun({ runId: dryRun.run.runId, dryRun: true });
  console.log(
    JSON.stringify(
      {
        runId: dryRun.run.runId,
        tilesGenerated: tiles.tilesGenerated,
        sampleTileKeys: tiles.tiles.slice(0, 5).map((t) => t.tileKey),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
