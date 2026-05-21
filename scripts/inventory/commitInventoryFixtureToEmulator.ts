#!/usr/bin/env tsx
import { processInventorySource, commitInventoryRun } from "../../src/admin/inventory/inventoryImport.service.js";
import { isFirestoreEmulatorActive } from "../../src/admin/inventory/inventoryWriteGuard.js";

async function main() {
  if (!isFirestoreEmulatorActive()) {
    console.error("FIRESTORE_EMULATOR_HOST is required for emulator commit");
    process.exit(1);
  }
  const dryRun = await processInventorySource({ source: "fixture", writeRunDoc: true });
  const commit = await commitInventoryRun({
    runId: dryRun.run.runId,
    commitTarget: "emulator",
    dryRun: false,
  });
  console.log(JSON.stringify({ dryRun: dryRun.run.counts, commit }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
