import type { InventoryTilePayload } from "../../contracts/entities/inventory-entities.contract.js";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { incrementDbOps } from "../../observability/request-context.js";
import {
  chunkedSetDocuments,
  type InventoryWriteOptions,
} from "./inventory-import-runs-firestore.adapter.js";

const COLLECTION = "inventoryTiles";

export async function getInventoryTile(tileKey: string): Promise<InventoryTilePayload | null> {
  const db = getFirestoreSourceClient();
  if (!db) return null;
  incrementDbOps("reads", 1);
  incrementDbOps("queries", 1);
  const snap = await db.collection(COLLECTION).doc(tileKey).get();
  if (!snap.exists) return null;
  return snap.data() as InventoryTilePayload;
}

export async function getInventoryTilesByKeys(tileKeys: string[]): Promise<InventoryTilePayload[]> {
  const db = getFirestoreSourceClient();
  if (!db || tileKeys.length === 0) return [];
  const unique = [...new Set(tileKeys)];
  const tiles: InventoryTilePayload[] = [];
  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10);
    incrementDbOps("reads", chunk.length);
    incrementDbOps("queries", 1);
    const snaps = await db.getAll(...chunk.map((key) => db.collection(COLLECTION).doc(key)));
    for (const snap of snaps) {
      if (snap.exists) tiles.push(snap.data() as InventoryTilePayload);
    }
  }
  return tiles;
}

export async function bulkWriteInventoryTiles(
  tiles: InventoryTilePayload[],
  options: InventoryWriteOptions
): Promise<number> {
  return chunkedSetDocuments(COLLECTION, tiles, "tileKey", {
    ...options,
    operation: options.operation || "bulkWriteInventoryTiles",
  });
}
