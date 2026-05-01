import type { FastifyBaseLogger } from "fastify";
import type { Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";

export type MixSourcePost = Record<string, unknown> & { postId: string };

type MixPool = {
  posts: MixSourcePost[];
  loadedAtMs: number;
  loading: boolean;
  inFlight: Promise<void> | null;
  lastBuildLatencyMs: number;
  lastBuildReadCount: number;
};

const DEFAULT_REFRESH_MS = 60_000;
const DEFAULT_MAX_DOCS = 12_000;

function toIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function parsePostTimeMs(row: Record<string, unknown>): number {
  const raw = row.time ?? row.updatedAtMs ?? row.createdAtMs ?? row.lastUpdated ?? 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw > 1e12 ? raw : raw * 1000;
  if (raw && typeof raw === "object") {
    const maybe = raw as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof maybe.toMillis === "function") return maybe.toMillis();
    if (typeof maybe.seconds === "number") return maybe.seconds * 1000;
    if (typeof maybe._seconds === "number") return maybe._seconds * 1000;
  }
  return 0;
}

export function isPublicVisiblePost(row: Record<string, unknown>): boolean {
  const privacy = String(row.privacy ?? "public").trim().toLowerCase();
  if (privacy === "private" || privacy === "friends spot" || privacy === "secret spot") return false;
  if (row.deleted === true || row.isDeleted === true) return false;
  if (row.archived === true || row.hidden === true) return false;
  if (row.assetsReady === false) return false;
  return true;
}

function sortDeterministicNewestFirst(rows: MixSourcePost[]): MixSourcePost[] {
  return [...rows].sort((a, b) => {
    const ta = parsePostTimeMs(a);
    const tb = parsePostTimeMs(b);
    if (ta !== tb) return tb - ta;
    return String(b.postId).localeCompare(String(a.postId));
  });
}

function mapDoc(doc: QueryDocumentSnapshot): MixSourcePost {
  return { postId: doc.id, id: doc.id, ...doc.data() } as MixSourcePost;
}

export class MixesRepository {
  private readonly db = getFirestoreSourceClient();
  private readonly refreshMs = toIntEnv("MIXES_POOL_REFRESH_MS", DEFAULT_REFRESH_MS, 15_000, 300_000);
  private readonly maxDocs = toIntEnv("MIXES_POOL_MAX_DOCS", DEFAULT_MAX_DOCS, 500, 30_000);
  private readonly coldStartDocs = toIntEnv("MIXES_POOL_COLD_START_DOCS", 1200, 200, 10_000);
  private readonly pool: MixPool = {
    posts: [],
    loadedAtMs: 0,
    loading: false,
    inFlight: null,
    lastBuildLatencyMs: 0,
    lastBuildReadCount: 0,
  };
  private refreshTimer: NodeJS.Timeout | null = null;

  startBackgroundRefresh(log?: FastifyBaseLogger): void {
    if (this.refreshTimer) return;
    if (!this.db || typeof (this.db as any).collection !== "function") return;
    void this.refreshPool(log);
    this.refreshTimer = setInterval(() => {
      void this.refreshPool(log);
    }, this.refreshMs);
  }

  stopBackgroundRefresh(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  async listFromPool(): Promise<{
    posts: MixSourcePost[];
    readCount: number;
    source: string;
    poolLimit: number;
    poolBuiltAt: string | null;
    poolBuildLatencyMs: number;
    poolBuildReadCount: number;
  }> {
    if (this.pool.posts.length === 0) {
      const loaded = await this.refreshPool(undefined, this.coldStartDocs);
      // Cold-start serves a bounded subset fast, then continues to full pool in background.
      if (this.pool.posts.length < this.maxDocs && !this.pool.loading) {
        void this.refreshPool();
      }
      return {
        posts: loaded.posts,
        readCount: loaded.readCount,
        source: loaded.source,
        poolLimit: this.maxDocs,
        poolBuiltAt: this.pool.loadedAtMs > 0 ? new Date(this.pool.loadedAtMs).toISOString() : null,
        poolBuildLatencyMs: this.pool.lastBuildLatencyMs,
        poolBuildReadCount: this.pool.lastBuildReadCount,
      };
    }
    if (Date.now() - this.pool.loadedAtMs > this.refreshMs && !this.pool.loading) {
      void this.refreshPool();
    }
    return {
      posts: this.pool.posts,
      readCount: 0,
      source: "memory_pool",
      poolLimit: this.maxDocs,
      poolBuiltAt: this.pool.loadedAtMs > 0 ? new Date(this.pool.loadedAtMs).toISOString() : null,
      poolBuildLatencyMs: this.pool.lastBuildLatencyMs,
      poolBuildReadCount: this.pool.lastBuildReadCount,
    };
  }

  private async refreshPool(
    log?: FastifyBaseLogger,
    maxDocsOverride?: number,
  ): Promise<{ posts: MixSourcePost[]; readCount: number; source: string }> {
    if (this.pool.loading && this.pool.inFlight) {
      await this.pool.inFlight;
      return { posts: this.pool.posts, readCount: 0, source: "memory_pool_shared_refresh" };
    }
    if (!this.db) {
      this.pool.posts = [];
      this.pool.loadedAtMs = Date.now();
      return { posts: [], readCount: 0, source: "memory_pool_firestore_unavailable" };
    }
    const targetDocs = Math.max(1, Math.min(this.maxDocs, Math.floor(maxDocsOverride ?? this.maxDocs)));
    this.pool.loading = true;
    let completedReads = 0;
    this.pool.inFlight = (async () => {
      const started = Date.now();
      const out: MixSourcePost[] = [];
      let totalReads = 0;
      const pageSize = 1000;
      let lastDoc: QueryDocumentSnapshot | null = null;
      const db = this.db;
      if (!db) {
        this.pool.posts = [];
        this.pool.loadedAtMs = Date.now();
        completedReads = totalReads;
        return;
      }
      while (out.length < targetDocs) {
        const want = Math.min(pageSize, targetDocs - out.length);
        const collectionRef = db.collection("posts") as any;
        if (!collectionRef || typeof collectionRef.orderBy !== "function") {
          this.pool.posts = [];
          this.pool.loadedAtMs = Date.now();
          completedReads = totalReads;
          return;
        }
        let q: Query = collectionRef.orderBy("time", "desc").limit(want);
        if (lastDoc) q = q.startAfter(lastDoc);
        const snap = await q.get();
        totalReads += snap.docs.length;
        if (snap.empty) break;
        for (const doc of snap.docs) out.push(mapDoc(doc));
        lastDoc = snap.docs[snap.docs.length - 1] ?? null;
        if (snap.size < want) break;
      }
      this.pool.posts = sortDeterministicNewestFirst(out.filter(isPublicVisiblePost));
      this.pool.loadedAtMs = Date.now();
      this.pool.lastBuildLatencyMs = Math.max(0, this.pool.loadedAtMs - started);
      this.pool.lastBuildReadCount = totalReads;
      completedReads = totalReads;
      log?.info({ event: "mixes_pool_refreshed", docs: this.pool.posts.length }, "mixes pool refreshed");
    })()
      .finally(() => {
        this.pool.loading = false;
        this.pool.inFlight = null;
      });
    await this.pool.inFlight;
    const source = targetDocs < this.maxDocs ? "firestore_pool_cold_start" : "firestore_pool_refresh";
    return { posts: this.pool.posts, readCount: completedReads, source };
  }
}

export const mixesRepository = new MixesRepository();
