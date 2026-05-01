import { FieldPath, type Query } from "firebase-admin/firestore";
import { incrementDbOps } from "../observability/request-context.js";
import { getFirestoreSourceClient } from "./source-of-truth/firestore-client.js";
import { SourceOfTruthRequiredError } from "./source-of-truth/strict-mode.js";
import { getBestPostCover } from "../services/mixes/mixCover.service.js";

export type MixPostRow = Record<string, unknown> & {
  id: string;
  postId: string;
  userId: string;
  time: number;
  activities?: string[];
  lat?: number | null;
  lng?: number | null;
  long?: number | null;
  geoData?: { geohash?: string | null } | null;
  thumbUrl?: string;
  displayPhotoLink?: string;
  assets?: unknown[];
};

const SELECT_FIELDS = [
  FieldPath.documentId(),
  "userId",
  "userHandle",
  "userName",
  "userPic",
  "title",
  "caption",
  "description",
  "content",
  "activities",
  "thumbUrl",
  "displayPhotoLink",
  "photoLink",
  "assets",
  "assetsReady",
  "mediaType",
  "likesCount",
  "likeCount",
  "commentsCount",
  "commentCount",
  "updatedAtMs",
  "createdAtMs",
  "time",
  "lat",
  "lng",
  "long",
  "stateRegionId",
  "cityRegionId",
  "privacy",
  "deleted",
  "isDeleted",
  "archived",
  "hidden",
  "geohash",
  "geoData",
] as const;

function asFiniteInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function mapDoc(doc: FirebaseFirestore.QueryDocumentSnapshot): MixPostRow {
  const data = doc.data() as Record<string, unknown>;
  const time = asFiniteInt(data.time ?? data.updatedAtMs ?? data.createdAtMs) ?? Date.now();
  return {
    id: doc.id,
    postId: doc.id,
    userId: String(data.userId ?? ""),
    time,
    ...data,
  };
}

function isVisiblePost(row: Record<string, unknown>): boolean {
  /** Align with feed surfaces: only hard-private posts are excluded (e.g. "Public Spot" stays visible). */
  const privacy = typeof row.privacy === "string" ? row.privacy.trim().toLowerCase() : "public";
  if (privacy === "private") return false;
  if (row.deleted === true || row.isDeleted === true) return false;
  if (row.archived === true) return false;
  if (row.hidden === true) return false;
  return true;
}

export class MixPostsRepository {
  private readonly db = getFirestoreSourceClient();

  private requireDb() {
    if (!this.db) throw new SourceOfTruthRequiredError("mix_posts_firestore_unavailable");
    return this.db;
  }

  private async runQuery(build: (db: NonNullable<MixPostsRepository["db"]>) => Query): Promise<MixPostRow[]> {
    const db = this.requireDb();
    const snap = await build(db).select(...SELECT_FIELDS).get();
    incrementDbOps("queries", 1);
    incrementDbOps("reads", snap.docs.length);
    return snap.docs.map(mapDoc).filter(isVisiblePost);
  }

  private sortByTimeDescIdDesc<T extends { time?: unknown; postId?: unknown; id?: unknown }>(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
      const ta = Number((a as any)?.time ?? 0);
      const tb = Number((b as any)?.time ?? 0);
      if (ta !== tb) return tb - ta;
      const ida = String((a as any)?.postId ?? (a as any)?.id ?? "");
      const idb = String((b as any)?.postId ?? (b as any)?.id ?? "");
      return idb.localeCompare(ida);
    });
  }

  private applyCursorDesc<T extends { time?: unknown; postId?: unknown; id?: unknown }>(
    rows: T[],
    cursor: { lastTime: number | null; lastId: string | null } | null,
  ): T[] {
    if (!cursor?.lastId || cursor.lastTime == null) return rows;
    const lastTime = Number(cursor.lastTime) || 0;
    const lastId = String(cursor.lastId ?? "");
    // Desc order means: return items strictly AFTER the cursor, i.e. (time < lastTime) OR (time == lastTime AND id < lastId).
    return rows.filter((row) => {
      const t = Number((row as any)?.time ?? 0) || 0;
      const id = String((row as any)?.postId ?? (row as any)?.id ?? "");
      if (t < lastTime) return true;
      if (t > lastTime) return false;
      return id && id.localeCompare(lastId) < 0;
    });
  }

  /**
   * Recent public posts for one author. Single-field `userId` equality + bounded limit (no orderBy) to avoid composite indexes; sort in-memory.
   */
  async listRecentPostsByUserId(userId: string, limit = 12): Promise<MixPostRow[]> {
    const uid = String(userId ?? "").trim();
    if (!uid) return [];
    const safe = Math.max(1, Math.min(40, Math.floor(limit)));
    const rows = await this.runQuery((db) => db.collection("posts").where("userId", "==", uid).limit(safe));
    return this.sortByTimeDescIdDesc(rows.filter(isVisiblePost)).slice(0, safe);
  }

  async loadRecentPool(limit = 420): Promise<MixPostRow[]> {
    const safe = Math.max(60, Math.min(900, Math.floor(limit)));
    // Single query: recency only. Visibility filtering is done in-memory via runQuery().
    const pooled = await this.runQuery((db) => db.collection("posts").orderBy("time", "desc").limit(safe));
    return this.sortByTimeDescIdDesc(pooled);
  }

  /**
   * One bounded pool query per mix using `array-contains` or `array-contains-any` (max 10 tags — Firestore limit).
   */
  async pageByActivityAliases(input: {
    aliases: string[];
    limit: number;
    cursor: { lastTime: number | null; lastId: string | null } | null;
  }): Promise<{ items: MixPostRow[]; nextCursor: { lastTime: number; lastId: string } | null; hasMore: boolean }> {
    const tags = [...new Set((input.aliases ?? []).map((a) => String(a ?? "").trim().toLowerCase()).filter(Boolean))].slice(
      0,
      10,
    );
    if (tags.length === 0) return { items: [], nextCursor: null, hasMore: false };
    const limit = Math.max(1, Math.min(36, Math.floor(input.limit)));
    const poolCap = Math.max(72, Math.min(520, limit * 22));
    /** No composite index required — ordering is applied in-memory after fetch. */
    const pooled = await this.runQuery((db) => {
      if (tags.length === 1) {
        return db.collection("posts").where("activities", "array-contains", tags[0]!).limit(poolCap);
      }
      return db.collection("posts").where("activities", "array-contains-any", tags).limit(poolCap);
    });
    const ranked = this.sortByTimeDescIdDesc(pooled);
    const afterCursor = this.applyCursorDesc(ranked, input.cursor);
    const slice = afterCursor.slice(0, limit);
    const hasMore = afterCursor.length > limit;
    const last = slice[slice.length - 1];
    return {
      items: slice,
      nextCursor: hasMore && last ? { lastTime: Number(last.time ?? 0) || 0, lastId: String(last.postId ?? last.id ?? "") } : null,
      hasMore,
    };
  }

  async pageByActivity(input: {
    activity: string;
    limit: number;
    cursor: { lastTime: number | null; lastId: string | null } | null;
  }): Promise<{ items: MixPostRow[]; nextCursor: { lastTime: number; lastId: string } | null; hasMore: boolean }> {
    const activity = String(input.activity ?? "").trim().toLowerCase();
    if (!activity) return { items: [], nextCursor: null, hasMore: false };
    return this.pageByActivityAliases({ aliases: [activity], limit: input.limit, cursor: input.cursor });
  }

  async pageByActivities(input: {
    activities: string[];
    limit: number;
    cursor: { lastTime: number | null; lastId: string | null } | null;
  }): Promise<{ items: MixPostRow[]; nextCursor: { lastTime: number; lastId: string } | null; hasMore: boolean }> {
    const activities = [...new Set((input.activities ?? []).map((a) => String(a ?? "").trim().toLowerCase()).filter(Boolean))].slice(0, 4);
    if (activities.length === 0) return { items: [], nextCursor: null, hasMore: false };
    const limit = Math.max(1, Math.min(36, Math.floor(input.limit)));
    const poolLimit = Math.max(64, Math.min(220, limit * 10));
    const merged: MixPostRow[] = [];
    const seen = new Set<string>();
    for (const activity of activities) {
      const pooled = await this.runQuery((db) => db.collection("posts").where("activities", "array-contains", activity).limit(poolLimit));
      for (const row of pooled) {
        const id = String((row as any)?.postId ?? (row as any)?.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        merged.push(row);
      }
    }
    const ranked = this.sortByTimeDescIdDesc(merged);
    const afterCursor = this.applyCursorDesc(ranked, input.cursor);
    const slice = afterCursor.slice(0, limit);
    const hasMore = afterCursor.length > limit;
    const last = slice[slice.length - 1];
    return {
      items: slice,
      nextCursor: hasMore && last ? { lastTime: Number(last.time ?? 0) || 0, lastId: String(last.postId ?? last.id ?? "") } : null,
      hasMore,
    };
  }

  async pageRecent(input: {
    limit: number;
    cursor: { lastTime: number | null; lastId: string | null } | null;
  }): Promise<{ items: MixPostRow[]; nextCursor: { lastTime: number; lastId: string } | null; hasMore: boolean }> {
    const limit = Math.max(1, Math.min(36, Math.floor(input.limit)));
    // Avoid composite-index requirements (privacy == public + orderBy time + __name__) by querying
    // recent posts and filtering visibility (including privacy) in-memory.
    const poolCap = Math.max(120, Math.min(600, limit * 22));
    const pooled = await this.runQuery((db) => db.collection("posts").orderBy("time", "desc").limit(poolCap));
    const ranked = this.sortByTimeDescIdDesc(pooled);
    const afterCursor = this.applyCursorDesc(ranked, input.cursor);
    const slice = afterCursor.slice(0, limit);
    const hasMore = afterCursor.length > limit;
    const last = slice[slice.length - 1];
    return {
      items: slice,
      nextCursor: hasMore && last ? { lastTime: Number((last as any)?.time ?? 0) || 0, lastId: String((last as any)?.postId ?? (last as any)?.id ?? "") } : null,
      hasMore,
    };
  }

  async previewRecent(limit = 3): Promise<{ postIds: string[]; coverImageUrl: string | null; coverPostId: string | null }> {
    const safeLimit = Math.max(1, Math.min(6, Math.floor(limit)));
    const fetchLimit = Math.max(12, Math.min(36, safeLimit * 8));
    const page = await this.pageRecent({ limit: fetchLimit, cursor: null });
    const ids = page.items
      .map((p) => String((p as any)?.postId ?? (p as any)?.id ?? "").trim())
      .filter(Boolean)
      .slice(0, safeLimit);
    if (page.items.length === 0) return { postIds: [], coverImageUrl: null, coverPostId: null };
    for (const candidate of page.items) {
      const cover = getBestPostCover(candidate);
      if (cover.coverImageUrl) return { postIds: ids, coverImageUrl: cover.coverImageUrl, coverPostId: cover.coverPostId };
    }
    return { postIds: ids, coverImageUrl: null, coverPostId: ids[0] ?? null };
  }

  async pageByAuthorIdsMerged(input: {
    authorIdChunks: string[][];
    limit: number;
    perChunkCursor: Array<{ lastTime: number | null; lastId: string | null; exhausted: boolean }>;
  }): Promise<{
    items: MixPostRow[];
    nextPerChunkCursor: Array<{ lastTime: number | null; lastId: string | null; exhausted: boolean }>;
    hasMore: boolean;
    debug: { chunksQueried: number; candidateCount: number };
  }> {
    const limit = Math.max(1, Math.min(36, Math.floor(input.limit)));
    const cursors = input.perChunkCursor.map((c) => ({ ...c }));
    const fetched: Array<{ chunkIndex: number; rows: MixPostRow[] }> = [];
    let chunksQueried = 0;
    let candidateCount = 0;
    for (let i = 0; i < input.authorIdChunks.length; i += 1) {
      const chunk = input.authorIdChunks[i] ?? [];
      const c = cursors[i] ?? { lastTime: null, lastId: null, exhausted: false };
      cursors[i] = c;
      if (c.exhausted || chunk.length === 0) continue;
      chunksQueried += 1;
      const poolLimit = Math.max(18, Math.min(120, limit * 12));
      const rows = await this.runQuery((db) => {
        // Avoid composite-index requirements (userId IN + orderBy time + __name__) by fetching a
        // bounded pool per chunk and cursoring in-memory.
        return db.collection("posts").where("userId", "in", chunk).limit(poolLimit);
      });
      const ranked = this.sortByTimeDescIdDesc(rows);
      const afterCursor = this.applyCursorDesc(ranked, c.lastTime != null && c.lastId ? { lastTime: c.lastTime, lastId: c.lastId } : null);
      candidateCount += afterCursor.length;
      fetched.push({ chunkIndex: i, rows: afterCursor });
      if (rows.length < poolLimit) {
        cursors[i] = { ...c, exhausted: true };
      }
    }

    const merged: MixPostRow[] = [];
    const heads = fetched.map((f) => ({
      chunkIndex: f.chunkIndex,
      idx: 0,
      rows: f.rows,
    }));
    const seen = new Set<string>();
    while (merged.length < limit && heads.some((h) => h.idx < h.rows.length)) {
      heads.sort((a, b) => {
        const ra = a.rows[a.idx];
        const rb = b.rows[b.idx];
        const ta = Number((ra as any)?.time ?? 0);
        const tb = Number((rb as any)?.time ?? 0);
        if (ta !== tb) return tb - ta;
        const ida = String((ra as any)?.postId ?? (ra as any)?.id ?? "");
        const idb = String((rb as any)?.postId ?? (rb as any)?.id ?? "");
        return idb.localeCompare(ida);
      });
      const h = heads[0];
      if (!h) break;
      const row = h.rows[h.idx];
      if (!row) break;
      h.idx += 1;
      const pid = String((row as any)?.postId ?? (row as any)?.id ?? "");
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      merged.push(row);
    }

    // Update cursors: set to the last row consumed per chunk, mark exhausted if we fetched nothing or fully consumed short batch.
    const byChunkLast = new Map<number, MixPostRow>();
    for (const h of heads) {
      const consumed = h.idx;
      if (consumed > 0) {
        const last = h.rows[Math.min(consumed, h.rows.length) - 1];
        if (last) byChunkLast.set(h.chunkIndex, last);
      }
      if (h.rows.length === 0 || consumed >= h.rows.length) {
        // Exhaustion is tracked at fetch time based on poolLimit; nothing to do here.
      }
    }
    for (const [chunkIndex, last] of byChunkLast.entries()) {
      cursors[chunkIndex] = {
        lastTime: Number((last as any)?.time ?? 0) || 0,
        lastId: String((last as any)?.postId ?? (last as any)?.id ?? ""),
        exhausted: cursors[chunkIndex]?.exhausted ?? false,
      };
    }

    const hasMore = cursors.some((c) => c && !c.exhausted);
    return { items: merged, nextPerChunkCursor: cursors, hasMore, debug: { chunksQueried, candidateCount } };
  }

  async bestCoverForActivity(activity: string): Promise<{ coverImageUrl: string | null; coverPostId: string | null }> {
    const page = await this.pageByActivity({ activity, limit: 18, cursor: null });
    for (const candidate of page.items) {
      const cover = getBestPostCover(candidate);
      if (cover.coverImageUrl) return { coverImageUrl: cover.coverImageUrl, coverPostId: cover.coverPostId };
    }
    const first = page.items[0];
    const firstId = first ? String((first as any)?.postId ?? (first as any)?.id ?? "").trim() : null;
    return { coverImageUrl: null, coverPostId: firstId || null };
  }

  async previewForActivity(activity: string, limit = 3): Promise<{ postIds: string[]; coverImageUrl: string | null; coverPostId: string | null }> {
    const safeLimit = Math.max(1, Math.min(6, Math.floor(limit)));
    // Fetch deeper than the preview window to guarantee a real cover if one exists.
    const fetchLimit = Math.max(12, Math.min(36, safeLimit * 8));
    const page = await this.pageByActivity({ activity, limit: fetchLimit, cursor: null });
    const ids = page.items.map((p) => String((p as any)?.postId ?? (p as any)?.id ?? "").trim()).filter(Boolean).slice(0, safeLimit);
    if (page.items.length === 0) return { postIds: [], coverImageUrl: null, coverPostId: null };
    for (const candidate of page.items) {
      const cover = getBestPostCover(candidate);
      if (cover.coverImageUrl) return { postIds: ids, coverImageUrl: cover.coverImageUrl, coverPostId: cover.coverPostId };
    }
    return { postIds: ids, coverImageUrl: null, coverPostId: ids[0] ?? null };
  }

  async firstCoverByActivity(activity: string): Promise<{ coverImageUrl: string | null; coverPostId: string | null }> {
    const normalized = String(activity ?? "").trim().toLowerCase();
    if (!normalized) return { coverImageUrl: null, coverPostId: null };
    const pooled = await this.runQuery((db) =>
      db.collection("posts").where("activities", "array-contains", normalized).limit(10)
    );
    const ranked = this.sortByTimeDescIdDesc(pooled);
    for (const candidate of ranked) {
      const cover = getBestPostCover(candidate);
      if (cover.coverImageUrl) {
        return { coverImageUrl: cover.coverImageUrl, coverPostId: cover.coverPostId };
      }
    }
    const first = ranked[0];
    const firstId = first ? String((first as any)?.postId ?? (first as any)?.id ?? "").trim() : null;
    return { coverImageUrl: null, coverPostId: firstId || null };
  }

  async loadTopActivities(limit = 24): Promise<string[]> {
    const safe = Math.max(1, Math.min(48, Math.floor(limit)));
    const rows = await this.runQuery((db) =>
      db.collection("posts").orderBy("time", "desc").select("activities", "privacy", "deleted", "isDeleted", "archived", "hidden").limit(220)
    );
    const counts = new Map<string, number>();
    for (const row of rows) {
      const list = Array.isArray((row as any).activities) ? ((row as any).activities as unknown[]) : [];
      for (const raw of list) {
        const a = String(raw ?? "").trim().toLowerCase();
        if (!a) continue;
        counts.set(a, (counts.get(a) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, safe)
      .map(([a]) => a);
  }
}
