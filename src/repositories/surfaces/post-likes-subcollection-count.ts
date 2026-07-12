import type { Firestore } from "firebase-admin/firestore";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { incrementDbOps, recordEntityCacheHit, recordEntityCacheMiss } from "../../observability/request-context.js";

/**
 * Authoritative like total: Firestore `posts/{postId}/likes` subcollection size
 * (aggregate count query — not post doc denormalized fields).
 *
 * Results are short-TTL cached so concurrent feed scrollers / re-hydration of the
 * same postIds do not re-pay N aggregate queries. Invalidated on like/unlike.
 */
export async function countPostLikesSubcollection(db: Firestore, postId: string): Promise<number> {
  const id = String(postId ?? "").trim();
  if (!id) return 0;
  const cacheKey = entityCacheKeys.likesSubcollectionCount(id);
  const cached = await globalCache.get<number>(cacheKey);
  if (typeof cached === "number" && Number.isFinite(cached) && cached >= 0) {
    recordEntityCacheHit();
    return Math.floor(cached);
  }
  recordEntityCacheMiss();
  incrementDbOps("queries", 1);
  const snap = await db.collection("posts").doc(id).collection("likes").count().get();
  const c = snap.data().count;
  const n = Math.max(0, Math.floor(typeof c === "number" && Number.isFinite(c) ? c : 0));
  void globalCache.set(cacheKey, n, 20_000);
  return n;
}

const DEFAULT_CONCURRENCY = 24;

export async function countPostLikesSubcollectionBatch(
  db: Firestore,
  postIds: string[],
  concurrency = DEFAULT_CONCURRENCY
): Promise<Map<string, number>> {
  const unique = [...new Set(postIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const out = new Map<string, number>();
  if (unique.length === 0) return out;

  const missing: string[] = [];
  await Promise.all(
    unique.map(async (postId) => {
      const cached = await globalCache.get<number>(entityCacheKeys.likesSubcollectionCount(postId));
      if (typeof cached === "number" && Number.isFinite(cached) && cached >= 0) {
        recordEntityCacheHit();
        out.set(postId, Math.floor(cached));
        return;
      }
      recordEntityCacheMiss();
      missing.push(postId);
    }),
  );

  for (let i = 0; i < missing.length; i += concurrency) {
    const slice = missing.slice(i, i + concurrency);
    const rows = await Promise.all(
      slice.map(async (postId) => {
        incrementDbOps("queries", 1);
        const snap = await db.collection("posts").doc(postId).collection("likes").count().get();
        const c = snap.data().count;
        const n = Math.max(0, Math.floor(typeof c === "number" && Number.isFinite(c) ? c : 0));
        void globalCache.set(entityCacheKeys.likesSubcollectionCount(postId), n, 20_000);
        return [postId, n] as const;
      }),
    );
    for (const [id, n] of rows) out.set(id, n);
  }
  return out;
}
