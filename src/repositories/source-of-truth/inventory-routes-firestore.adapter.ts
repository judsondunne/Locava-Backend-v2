import type { InventoryRoute } from "../../contracts/entities/inventory-entities.contract.js";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { incrementDbOps } from "../../observability/request-context.js";
import {
  chunkedSetDocuments,
  type InventoryWriteOptions,
} from "./inventory-import-runs-firestore.adapter.js";

const COLLECTION = "inventoryRoutes";

export async function getInventoryRouteById(id: string): Promise<InventoryRoute | null> {
  const db = getFirestoreSourceClient();
  if (!db) return null;
  incrementDbOps("reads", 1);
  incrementDbOps("queries", 1);
  const snap = await db.collection(COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return snap.data() as InventoryRoute;
}

export async function bulkWriteInventoryRoutes(
  routes: InventoryRoute[],
  options: InventoryWriteOptions
): Promise<number> {
  return chunkedSetDocuments(COLLECTION, routes, "id", {
    ...options,
    operation: options.operation || "bulkWriteInventoryRoutes",
  });
}
