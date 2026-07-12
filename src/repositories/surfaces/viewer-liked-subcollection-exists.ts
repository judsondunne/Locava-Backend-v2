import type { Firestore } from "firebase-admin/firestore";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { incrementDbOps, recordEntityCacheHit, recordEntityCacheMiss } from "../../observability/request-context.js";

const TTL_MS = 20_000;

/**
 * Resolve whether the viewer has liked each post via `posts/{id}/likes/{viewerId}` existence.
 * Short-TTL cached so social-batch re-scrolls of the same visible set skip getAll.
 */
export async function batchResolveViewerHasLiked(
  db: Firestore,
  viewerId: string,
  postIds: string[],
): Promise<Map<string, boolean>> {
  const vid = String(viewerId ?? "").trim();
  const unique = [...new Set(postIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const out = new Map<string, boolean>();
  if (!vid || unique.length === 0) return out;

  const missing: string[] = [];
  await Promise.all(
    unique.map(async (postId) => {
      const cached = await globalCache.get<boolean>(entityCacheKeys.viewerLikedExists(vid, postId));
      if (typeof cached === "boolean") {
        recordEntityCacheHit();
        out.set(postId, cached);
        return;
      }
      recordEntityCacheMiss();
      missing.push(postId);
    }),
  );

  if (missing.length === 0) return out;

  const chunkSize = 30;
  for (let i = 0; i < missing.length; i += chunkSize) {
    const chunk = missing.slice(i, i + chunkSize);
    const refs = chunk.map((postId) => db.collection("posts").doc(postId).collection("likes").doc(vid));
    incrementDbOps("queries", 1);
    const snaps = await db.getAll(...refs);
    incrementDbOps("reads", snaps.filter((snap) => snap.exists).length);
    chunk.forEach((postId, index) => {
      const liked = snaps[index]?.exists === true;
      out.set(postId, liked);
      void globalCache.set(entityCacheKeys.viewerLikedExists(vid, postId), liked, TTL_MS);
    });
  }
  return out;
}
