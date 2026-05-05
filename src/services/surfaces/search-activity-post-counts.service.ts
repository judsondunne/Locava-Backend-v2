import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "../../repositories/source-of-truth/strict-mode.js";

type CacheEntry = { expiresAtMs: number; count: number };
const CACHE_TTL_MS = 50_000;
const MAX_CACHE_KEYS = 400;
const cache = new Map<string, CacheEntry>();

function trimCache(): void {
  if (cache.size <= MAX_CACHE_KEYS) return;
  const keys = [...cache.keys()].slice(0, cache.size - MAX_CACHE_KEYS + 20);
  for (const k of keys) cache.delete(k);
}

function normalizeActivityKey(raw: string): string {
  return String(raw ?? "").trim().toLowerCase();
}

export class SearchActivityPostCountsService {
  async countsForActivities(input: { activities: string[] }): Promise<Record<string, number>> {
    const db = getFirestoreSourceClient();
    if (!db) throw new SourceOfTruthRequiredError("search_activity_counts_firestore_unavailable");
    const unique = [...new Set(input.activities.map(normalizeActivityKey).filter(Boolean))].slice(0, 40);
    const out: Record<string, number> = {};
    await Promise.all(
      unique.map(async (activity) => {
        const cacheKey = activity;
        const hit = cache.get(cacheKey);
        if (hit && hit.expiresAtMs > Date.now()) {
          out[activity] = hit.count;
          return;
        }
        const snap = await db.collection("posts").where("activities", "array-contains", activity).count().get();
        const count = Number(snap.data().count ?? 0) || 0;
        cache.set(cacheKey, { expiresAtMs: Date.now() + CACHE_TTL_MS, count });
        trimCache();
        out[activity] = count;
      }),
    );
    return out;
  }
}
