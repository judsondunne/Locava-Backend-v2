import type { InventorySpot } from "../../contracts/entities/inventory-entities.contract.js";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { incrementDbOps } from "../../observability/request-context.js";
import {
  chunkedSetDocuments,
  type InventoryWriteOptions,
} from "./inventory-import-runs-firestore.adapter.js";

const COLLECTION = "inventorySpots";

export async function getInventorySpotById(id: string): Promise<InventorySpot | null> {
  const db = getFirestoreSourceClient();
  if (!db) return null;
  incrementDbOps("reads", 1);
  incrementDbOps("queries", 1);
  const snap = await db.collection(COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return snap.data() as InventorySpot;
}

export async function bulkWriteInventorySpots(
  spots: InventorySpot[],
  options: InventoryWriteOptions
): Promise<number> {
  return chunkedSetDocuments(COLLECTION, spots, "id", {
    ...options,
    operation: options.operation || "bulkWriteInventorySpots",
  });
}
