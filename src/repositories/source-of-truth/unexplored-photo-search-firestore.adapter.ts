import type { UndiscoveredPhotoSearchCache } from "../../contracts/surfaces/undiscovered-photo-search.contract.js";
import {
  getUnexploredRouteById,
  getUnexploredSpotById,
} from "./unexplored-read-firestore.adapter.js";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { incrementDbOps } from "../../observability/request-context.js";

export type UndiscoveredPhotoSearchCollection = "unexploredSpots" | "unexploredRoutes";

export async function getUnexploredDocForPhotoSearch(
  collection: UndiscoveredPhotoSearchCollection,
  id: string,
): Promise<Record<string, unknown> | null> {
  if (collection === "unexploredSpots") {
    return getUnexploredSpotById(id);
  }
  return getUnexploredRouteById(id);
}

export async function writeUnexploredPhotoSearch(
  collection: UndiscoveredPhotoSearchCollection,
  id: string,
  photoSearch: UndiscoveredPhotoSearchCache,
): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("firestore_unavailable");
  }
  incrementDbOps("writes", 1);
  await db.collection(collection).doc(id).set({ photoSearch }, { merge: true });
}

export async function readUnexploredPhotoSearchAfterRefresh(
  collection: UndiscoveredPhotoSearchCollection,
  id: string,
): Promise<UndiscoveredPhotoSearchCache | null> {
  const doc = await getUnexploredDocForPhotoSearch(collection, id);
  if (!doc) return null;
  const photoSearch = doc.photoSearch;
  if (!photoSearch || typeof photoSearch !== "object") return null;
  return photoSearch as UndiscoveredPhotoSearchCache;
}
