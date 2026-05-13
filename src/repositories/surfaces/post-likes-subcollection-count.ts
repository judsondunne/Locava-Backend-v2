import type { Firestore } from "firebase-admin/firestore";
import { incrementDbOps } from "../../observability/request-context.js";

/**
 * Authoritative like total: Firestore `posts/{postId}/likes` subcollection size
 * (aggregate count query — not post doc denormalized fields).
 */
export async function countPostLikesSubcollection(db: Firestore, postId: string): Promise<number> {
  const id = String(postId ?? "").trim();
  if (!id) return 0;
  incrementDbOps("queries", 1);
  const snap = await db.collection("posts").doc(id).collection("likes").count().get();
  const c = snap.data().count;
  return Math.max(0, Math.floor(typeof c === "number" && Number.isFinite(c) ? c : 0));
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
  for (let i = 0; i < unique.length; i += concurrency) {
    const slice = unique.slice(i, i + concurrency);
    const rows = await Promise.all(
      slice.map(async (postId) => {
        const n = await countPostLikesSubcollection(db, postId);
        return [postId, n] as const;
      })
    );
    for (const [id, n] of rows) out.set(id, n);
  }
  return out;
}
