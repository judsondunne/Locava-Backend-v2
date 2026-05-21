import { beforeEach, describe, expect, it, vi } from "vitest";
import { processInventorySource, commitInventoryRun } from "./inventoryImport.service.js";
import { resetInventoryRunStoreForTests } from "./inventoryImportRunStore.js";
import * as spotsAdapter from "../../repositories/source-of-truth/inventory-spots-firestore.adapter.js";
import * as routesAdapter from "../../repositories/source-of-truth/inventory-routes-firestore.adapter.js";
import * as runsAdapter from "../../repositories/source-of-truth/inventory-import-runs-firestore.adapter.js";
import * as tilesAdapter from "../../repositories/source-of-truth/inventory-tiles-firestore.adapter.js";
import { buildInventoryTilesForRun } from "./inventoryTileBuilder.service.js";

describe("inventoryImport.service", () => {
  beforeEach(() => {
    resetInventoryRunStoreForTests();
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.INVENTORY_IMPORT_ALLOW_PROD_WRITE;
    delete process.env.INVENTORY_DRY_RUN_WRITE_RUN_DOC;
  });

  it("dry run produces accepted + rejected counts without Firestore writes", async () => {
    const writeRunSpy = vi.spyOn(runsAdapter, "writeInventoryImportRun");
    const spotSpy = vi.spyOn(spotsAdapter, "bulkWriteInventorySpots");
    const routeSpy = vi.spyOn(routesAdapter, "bulkWriteInventoryRoutes");

    const result = await processInventorySource({ source: "fixture", writeRunDoc: false });
    expect(result.run.status).toBe("dry_run_complete");
    expect(result.run.counts.rawObjects).toBeGreaterThan(0);
    expect(result.run.counts.acceptedSpots).toBeGreaterThan(0);
    expect(result.run.counts.acceptedRoutes).toBeGreaterThan(0);
    expect(result.run.counts.rejected).toBeGreaterThan(0);
    expect(writeRunSpy).not.toHaveBeenCalled();
    expect(spotSpy).not.toHaveBeenCalled();
    expect(routeSpy).not.toHaveBeenCalled();
  });

  it("commit refuses production by default", async () => {
    const result = await processInventorySource({ source: "fixture", writeRunDoc: false });
    await expect(
      commitInventoryRun({
        runId: result.run.runId,
        commitTarget: "production",
        dryRun: false,
        confirmProductionWrite: "I_UNDERSTAND_THIS_WRITES_INVENTORY_TO_PRODUCTION",
      })
    ).rejects.toThrow();
  });

  it("builds tiles in dry run mode", async () => {
    const result = await processInventorySource({ source: "fixture", writeRunDoc: false });
    const tileSpy = vi.spyOn(tilesAdapter, "bulkWriteInventoryTiles");
    const tiles = await buildInventoryTilesForRun({ runId: result.run.runId, dryRun: true });
    expect(tiles.tilesGenerated).toBeGreaterThan(0);
    expect(tiles.dryRun).toBe(true);
    expect(tileSpy).not.toHaveBeenCalled();
  });
});
