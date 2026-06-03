import { getFirestoreSourceClient } from "../../../../repositories/source-of-truth/firestore-client.js";
import { incrementDbOps } from "../../../../observability/request-context.js";

/**
 * Batched existence check for unexplored doc IDs.
 *
 * Used by the copier when `skipExisting=true` so we don't pay write cost on
 * docs that are already present in Firestore.
 *
 * Returns the set of IDs that DO exist. If Firestore is unavailable (test mode
 * disabled / no credentials) the function returns an empty set — i.e. "we
 * could not check, so do not skip anything". This is intentional: skipping is
 * an optimization, never a safety guarantee. The write path itself uses
 * deterministic IDs + `set({ merge: true })`, so re-runs remain idempotent.
 */

const BATCH_SIZE = 200;

export async function findExistingUnexploredIds(
  collection: "unexploredSpots" | "unexploredRoutes",
  ids: string[]
): Promise<Set<string>> {
  const existing = new Set<string>();
  if (ids.length === 0) return existing;

  const db = getFirestoreSourceClient();
  if (!db) return existing;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const slice = ids.slice(i, i + BATCH_SIZE);
    if (slice.length === 0) continue;
    const refs = slice.map((id) => db.collection(collection).doc(id));
    try {
      const snaps = await db.getAll(...refs);
      incrementDbOps("reads", snaps.length);
      for (const snap of snaps) {
        if (snap.exists) existing.add(snap.id);
      }
    } catch (error) {
      // Reading should never throw on the safety path. Log and bail with what
      // we have so far; the writer will still merge by deterministic id.
      console.warn(
        "osm_national_copier_exists_check_failed",
        collection,
        error instanceof Error ? error.message : String(error)
      );
      return existing;
    }
  }

  return existing;
}
