import { type Query } from "firebase-admin/firestore";
import { incrementDbOps } from "../observability/request-context.js";
import { getFirestoreSourceClient } from "./source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "./source-of-truth/strict-mode.js";

export class NearbyMixRepository {
  private readonly db = getFirestoreSourceClient();

  private requireDb() {
    if (!this.db) throw new SourceOfTruthRequiredError("nearby_mix_firestore_unavailable");
    return this.db;
  }

  async pageByGeohashPrefix(input: {
    prefix: string;
    limit: number;
    cursor: { lastGeohash: string; lastTime: number; lastId: string } | null;
  }): Promise<{ items: Array<Record<string, unknown>>; nextCursor: { lastGeohash: string; lastTime: number; lastId: string } | null; hasMore: boolean }> {
    const db = this.requireDb();
    const start = input.prefix;
    const end = `${input.prefix}\uf8ff`;
    const limit = Math.max(1, Math.min(120, Math.floor(input.limit)));
    const poolCap = Math.max(36, Math.min(260, limit * 10));
    let q = db
      .collection("posts")
      .where("geohash", ">=", start)
      .where("geohash", "<=", end)
      .orderBy("geohash", "asc")
      .limit(poolCap) as Query;
    if (input.cursor) {
      // Cursoring happens in-memory; Firestore cursor would require composite indexes.
      q = q.startAfter(input.cursor.lastGeohash);
    }
    const snap = await q.get();
    incrementDbOps("queries", 1);
    incrementDbOps("reads", snap.docs.length);
    const pooled = snap.docs.map((doc) => ({ id: doc.id, postId: doc.id, ...doc.data() })) as Array<Record<string, unknown>>;
    const visible = pooled.filter((row) => {
      const privacy = String((row as any)?.privacy ?? "public");
      if (privacy !== "public") return false;
      if ((row as any)?.deleted === true || (row as any)?.isDeleted === true) return false;
      if ((row as any)?.archived === true) return false;
      if ((row as any)?.hidden === true) return false;
      return true;
    });
    const ranked = [...visible].sort((a, b) => {
      const ta = Number((a as any)?.time ?? (a as any)?.updatedAtMs ?? (a as any)?.createdAtMs ?? 0) || 0;
      const tb = Number((b as any)?.time ?? (b as any)?.updatedAtMs ?? (b as any)?.createdAtMs ?? 0) || 0;
      if (ta !== tb) return tb - ta;
      const ida = String((a as any)?.postId ?? (a as any)?.id ?? "");
      const idb = String((b as any)?.postId ?? (b as any)?.id ?? "");
      return idb.localeCompare(ida);
    });
    const afterCursor = input.cursor
      ? ranked.filter((row) => {
          const gh = String((row as any)?.geohash ?? "").trim();
          const t = Number((row as any)?.time ?? (row as any)?.updatedAtMs ?? (row as any)?.createdAtMs ?? 0) || 0;
          const id = String((row as any)?.postId ?? (row as any)?.id ?? "");
          if (gh > input.cursor!.lastGeohash) return true;
          if (gh < input.cursor!.lastGeohash) return false;
          if (t < input.cursor!.lastTime) return true;
          if (t > input.cursor!.lastTime) return false;
          return id && id.localeCompare(input.cursor!.lastId) < 0;
        })
      : ranked;
    const slice = afterCursor.slice(0, limit);
    const hasMore = afterCursor.length > limit;
    const last = slice[slice.length - 1];
    const nextCursor =
      hasMore && last
        ? {
            lastGeohash: String((last as any)?.geohash ?? "").trim(),
            lastTime: Number((last as any)?.time ?? (last as any)?.updatedAtMs ?? (last as any)?.createdAtMs ?? 0) || 0,
            lastId: String((last as any)?.postId ?? (last as any)?.id ?? ""),
          }
        : null;
    return { items: slice, nextCursor, hasMore };
  }
}

