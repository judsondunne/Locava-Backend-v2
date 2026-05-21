import { afterEach, describe, expect, it } from "vitest";
import {
  assertInventoryCollectionTarget,
  assertInventoryWriteAllowed,
  INVENTORY_PRODUCTION_CONFIRMATION,
  InventoryWriteBlockedError,
} from "./inventoryWriteGuard.js";

describe("inventoryWriteGuard", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("blocks production writes by default", () => {
    delete process.env.INVENTORY_IMPORT_ALLOW_PROD_WRITE;
    expect(() =>
      assertInventoryWriteAllowed({
        commitTarget: "production",
        operation: "test.production",
        confirmProductionWrite: INVENTORY_PRODUCTION_CONFIRMATION,
      })
    ).toThrow(InventoryWriteBlockedError);
  });

  it("blocks emulator writes without emulator host", () => {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    expect(() =>
      assertInventoryWriteAllowed({
        commitTarget: "emulator",
        operation: "test.emulator",
      })
    ).toThrow(InventoryWriteBlockedError);
  });

  it("allows emulator writes when emulator host is active", () => {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    process.env.GCLOUD_PROJECT = "demo-locava";
    expect(() =>
      assertInventoryWriteAllowed({
        commitTarget: "emulator",
        operation: "test.emulator",
      })
    ).not.toThrow();
  });

  it("never allows posts collection target", () => {
    expect(() => assertInventoryCollectionTarget("posts")).toThrow(/INVENTORY_COLLECTION_FORBIDDEN|posts/);
  });

  it("allows inventory collections", () => {
    expect(() => assertInventoryCollectionTarget("inventorySpots")).not.toThrow();
    expect(() => assertInventoryCollectionTarget("inventoryRoutes")).not.toThrow();
    expect(() => assertInventoryCollectionTarget("inventoryTiles")).not.toThrow();
    expect(() => assertInventoryCollectionTarget("inventoryImportRuns")).not.toThrow();
  });
});
