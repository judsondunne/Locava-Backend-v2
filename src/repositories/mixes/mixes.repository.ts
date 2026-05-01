import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type { Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";

export type MixSourcePost = Record<string, unknown> & { postId: string };

export type MixPoolState = "cold" | "warming" | "warm" | "stale" | "failed";

type MixPool = {
  posts: MixSourcePost[];
  loadedAtMs: number;
  state: MixPoolState;
  inFlight: Promise<void> | null;
  lastBuildLatencyMs: number;
  lastBuildReadCount: number;
  lastRefreshStartedAtMs: number;
  lastRefreshFailedAtMs: number;
  lastRefreshErrorMessage: string | null;
};

const DEFAULT_REFRESH_MS = 60_000;
const DEFAULT_MAX_STALE_MS = 10 * 60_000;
const DEFAULT_MAX_DOCS = 600;
const DEFAULT_COLD_START_DOCS = 120;
const DEFAULT_SNAPSHOT_PATH = path.join(process.cwd(), "state", "mixes-preview-snapshot.json");

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
  private dbClient: ReturnType<typeof getFirestoreSourceClient> | null | undefined;
  private readonly refreshMs = toIntEnv("MIXES_POOL_REFRESH_MS", DEFAULT_REFRESH_MS, 15_000, 300_000);
  private readonly maxStaleMs = toIntEnv("MIXES_POOL_MAX_STALE_MS", DEFAULT_MAX_STALE_MS, 30_000, 3_600_000);
  private readonly maxDocs = toIntEnv("MIXES_POOL_MAX_DOCS", DEFAULT_MAX_DOCS, 200, 30_000);
  private readonly coldStartDocs = toIntEnv("MIXES_POOL_COLD_START_DOCS", DEFAULT_COLD_START_DOCS, 60, 10_000);
  private readonly snapshotPath = process.env.MIXES_POOL_SNAPSHOT_PATH ?? DEFAULT_SNAPSHOT_PATH;
  private readonly pool: MixPool = {
    posts: [],
    loadedAtMs: 0,
    state: "cold",
    inFlight: null,
    lastBuildLatencyMs: 0,
    lastBuildReadCount: 0,
    lastRefreshStartedAtMs: 0,
    lastRefreshFailedAtMs: 0,
    lastRefreshErrorMessage: null,
  };
  private refreshTimer: NodeJS.Timeout | null = null;
  private log: FastifyBaseLogger | undefined;
  private snapshotLoadPromise: Promise<void> | null = null;

  startBackgroundRefresh(log?: FastifyBaseLogger): void {
    if (this.refreshTimer) return;
    const db = this.getDb();
    if (!db || typeof (db as any).collection !== "function") return;
    this.log = log ?? this.log;
    void this.scheduleRefresh(this.coldStartDocs, "startup");
    this.refreshTimer = setInterval(() => {
      void this.scheduleRefresh(this.maxDocs, "scheduled");
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
    poolState: MixPoolState;
    poolBuiltAt: string | null;
    poolBuildLatencyMs: number;
    poolBuildReadCount: number;
    servedStale: boolean;
    servedEmptyWarming: boolean;
  }> {
    const now = Date.now();
    await this.loadSnapshotIfNeeded();
    const builtAt = this.pool.loadedAtMs > 0 ? new Date(this.pool.loadedAtMs).toISOString() : null;
    const ageMs = this.pool.loadedAtMs > 0 ? Math.max(0, now - this.pool.loadedAtMs) : Number.POSITIVE_INFINITY;
    const hasPosts = this.pool.posts.length > 0;

    if (!hasPosts) {
      void this.scheduleRefresh(this.coldStartDocs, "route_cold");
      const poolState = this.pool.state === "failed" ? "failed" : "warming";
      if (poolState === "warming") {
        this.log?.info({ event: "served_empty_warming", pool_state: poolState }, "mixes pool served empty while warming");
      }
      return {
        posts: [],
        readCount: 0,
        source: "memory_pool_empty_warming",
        poolLimit: this.maxDocs,
        poolState,
        poolBuiltAt: builtAt,
        poolBuildLatencyMs: this.pool.lastBuildLatencyMs,
        poolBuildReadCount: this.pool.lastBuildReadCount,
        servedStale: false,
        servedEmptyWarming: true,
      };
    }

    if (ageMs > this.refreshMs) {
      void this.scheduleRefresh(this.maxDocs, ageMs > this.maxStaleMs ? "route_expired" : "route_stale");
      this.log?.info(
        { event: "served_stale", pool_state: "stale", ageMs, staleBeyondMax: ageMs > this.maxStaleMs },
        "mixes pool served stale snapshot"
      );
      return {
        posts: this.pool.posts,
        readCount: 0,
        source: ageMs > this.maxStaleMs ? "memory_pool_stale_expired" : "memory_pool_stale",
        poolLimit: this.maxDocs,
        poolState: "stale",
        poolBuiltAt: builtAt,
        poolBuildLatencyMs: this.pool.lastBuildLatencyMs,
        poolBuildReadCount: this.pool.lastBuildReadCount,
        servedStale: true,
        servedEmptyWarming: false,
      };
    }

    return {
      posts: this.pool.posts,
      readCount: 0,
      source: "memory_pool",
      poolLimit: this.maxDocs,
      poolState: "warm",
      poolBuiltAt: builtAt,
      poolBuildLatencyMs: this.pool.lastBuildLatencyMs,
      poolBuildReadCount: this.pool.lastBuildReadCount,
      servedStale: false,
      servedEmptyWarming: false,
    };
  }

  private async scheduleRefresh(
    maxDocsOverride?: number,
    reason: string = "manual",
    log?: FastifyBaseLogger,
  ): Promise<void> {
    const logger = log ?? this.log;
    if (this.pool.inFlight) return this.pool.inFlight;
    const db = this.getDb();
    if (!db) {
      this.pool.posts = [];
      this.pool.loadedAtMs = Date.now();
      this.pool.state = "failed";
      this.pool.lastRefreshFailedAtMs = this.pool.loadedAtMs;
      this.pool.lastRefreshErrorMessage = "firestore_unavailable";
      logger?.warn({ event: "pool_refresh_failed", pool_state: this.pool.state, reason }, "mixes pool refresh failed");
      return;
    }
    const targetDocs = Math.max(1, Math.min(this.maxDocs, Math.floor(maxDocsOverride ?? this.maxDocs)));
    this.pool.state = this.pool.posts.length > 0 ? "stale" : "warming";
    this.pool.lastRefreshStartedAtMs = Date.now();
    logger?.info(
      {
        event: "pool_refresh_started",
        pool_state: this.pool.state,
        reason,
        targetDocs,
        existingDocs: this.pool.posts.length,
      },
      "mixes pool refresh started"
    );
    this.pool.inFlight = (async () => {
      const started = Date.now();
      const out: MixSourcePost[] = [];
      let totalReads = 0;
      const pageSize = 1000;
      let lastDoc: QueryDocumentSnapshot | null = null;
      if (!db) {
        this.pool.posts = [];
        this.pool.loadedAtMs = Date.now();
        this.pool.state = "failed";
        this.pool.lastRefreshFailedAtMs = this.pool.loadedAtMs;
        this.pool.lastRefreshErrorMessage = "firestore_unavailable";
        return;
      }
      while (out.length < targetDocs) {
        const want = Math.min(pageSize, targetDocs - out.length);
        const collectionRef = db.collection("posts") as any;
        if (!collectionRef || typeof collectionRef.orderBy !== "function") {
          this.pool.posts = [];
          this.pool.loadedAtMs = Date.now();
          this.pool.state = "failed";
          this.pool.lastRefreshFailedAtMs = this.pool.loadedAtMs;
          this.pool.lastRefreshErrorMessage = "invalid_collection_ref";
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
      this.pool.lastRefreshErrorMessage = null;
      this.pool.state = "warm";
      await this.persistSnapshot().catch(() => undefined);
      logger?.info(
        {
          event: "pool_refresh_completed",
          pool_state: this.pool.state,
          reason,
          docs: this.pool.posts.length,
          reads: totalReads,
          latencyMs: this.pool.lastBuildLatencyMs,
        },
        "mixes pool refresh completed"
      );
    })()
      .catch((error) => {
        this.pool.lastRefreshFailedAtMs = Date.now();
        this.pool.lastRefreshErrorMessage = error instanceof Error ? error.message : String(error);
        this.pool.state = this.pool.posts.length > 0 ? "stale" : "failed";
        logger?.error(
          {
            event: "pool_refresh_failed",
            pool_state: this.pool.state,
            reason,
            error: this.pool.lastRefreshErrorMessage,
          },
          "mixes pool refresh failed"
        );
      })
      .finally(() => {
        this.pool.inFlight = null;
      });
    return this.pool.inFlight ?? Promise.resolve();
  }

  private getDb() {
    if (this.dbClient !== undefined) return this.dbClient;
    this.dbClient = getFirestoreSourceClient();
    return this.dbClient;
  }

  private async loadSnapshotIfNeeded(): Promise<void> {
    if (this.pool.posts.length > 0 || this.snapshotLoadPromise) return this.snapshotLoadPromise ?? Promise.resolve();
    this.snapshotLoadPromise = (async () => {
      try {
        const raw = await readFile(this.snapshotPath, "utf8");
        const parsed = JSON.parse(raw) as { posts?: MixSourcePost[]; loadedAtMs?: number } | null;
        const posts = Array.isArray(parsed?.posts) ? parsed!.posts.filter((row) => row && typeof row === "object") : [];
        if (posts.length === 0) return;
        this.pool.posts = sortDeterministicNewestFirst(posts.filter(isPublicVisiblePost));
        this.pool.loadedAtMs = typeof parsed?.loadedAtMs === "number" ? parsed.loadedAtMs : Date.now();
        this.pool.state = "stale";
      } catch {
        // No persisted snapshot yet.
      }
    })().finally(() => {
      this.snapshotLoadPromise = null;
    });
    return this.snapshotLoadPromise;
  }

  private async persistSnapshot(): Promise<void> {
    if (this.pool.posts.length === 0) return;
    await mkdir(path.dirname(this.snapshotPath), { recursive: true });
    await writeFile(
      this.snapshotPath,
      JSON.stringify(
        {
          loadedAtMs: this.pool.loadedAtMs,
          posts: this.pool.posts.slice(0, Math.min(this.pool.posts.length, this.coldStartDocs)),
        },
        null,
        2
      ),
      "utf8"
    );
  }
}

export const mixesRepository = new MixesRepository();
