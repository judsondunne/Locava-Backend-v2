import { createHash, randomUUID } from "node:crypto";
import { toFeedCardDTO, type FeedCardDTO } from "../../dto/compact-surface-dto.js";
import type {
  FeedForYouMode,
  FeedForYouRepository,
  ForYouCandidate,
} from "../../repositories/surfaces/feed-for-you.repository.js";

const ENGINE_VERSION = "queue-reels-regular-v2";
const CURSOR_PREFIX = "fq:v2:";
const RECENT_POOL_LIMIT = 120;
const RECENT_POOL_TTL_MS = 30_000;
const FALLBACK_WINDOW_LIMIT = 8;

type FeedCursorState = {
  page: number;
  mode: FeedForYouMode;
  reelQueueIndex: number;
  regularQueueIndex: number;
};

type RecentPool = {
  items: ForYouCandidate[];
  loadedAtMs: number;
  lastReadCount: number;
  inFlight: Promise<void> | null;
};

type FallbackPool = {
  items: ForYouCandidate[];
  loadedAtMs: number;
  lastReadCount: number;
};

export class FeedForYouService {
  private readonly recentPool: RecentPool = {
    items: [],
    loadedAtMs: 0,
    lastReadCount: 0,
    inFlight: null,
  };

  private readonly fallbackPool: FallbackPool = {
    items: [],
    loadedAtMs: 0,
    lastReadCount: 0,
  };

  constructor(
    private readonly repository: Pick<FeedForYouRepository, "fetchRecentWindow" | "fetchFallbackWindow">
  ) {}

  async getForYouPage(input: {
    viewerId: string;
    limit: number;
    cursor: string | null;
    debug: boolean;
    requestId?: string;
  }): Promise<{
    requestId: string;
    items: FeedCardDTO[];
    nextCursor: string | null;
    exhausted: boolean;
    feedState: {
      mode: FeedForYouMode;
      reelQueueIndex: number;
      reelQueueCount: number;
      remainingReels: number;
      regularQueueIndex: number;
      regularQueueCount: number;
      remainingRegular: number;
    };
    debug: {
      requestId: string;
      viewerId: string;
      engineVersion: typeof ENGINE_VERSION;
      returnedCount: number;
      reelCount: number;
      regularCount: number;
      recycledRegularCount: number;
      feedStateCreated: boolean;
      reelQueueReadCount: number;
      regularQueueReadCount: number;
      feedStateWriteOk: boolean;
      servedWriteCount: number;
      servedWriteOk: boolean;
      queueRebuilt: boolean;
      emptyReason: string | null;
      latencyMs: number;
      reelQueueIndexBefore: number;
      reelQueueIndexAfter: number;
      reelQueueCount: number;
      regularQueueIndexBefore: number;
      regularQueueIndexAfter: number;
      regularQueueCount: number;
      remainingReels: number;
      remainingRegular: number;
      postIdsReturned: string[];
      poolState: "warm" | "stale" | "warming" | "cold_fallback";
    };
  }> {
    const startedAt = Date.now();
    const requestId = input.requestId ?? randomUUID();
    const viewerId = input.viewerId.trim() || "anonymous";
    const limit = Math.max(1, Math.min(20, Math.floor(input.limit || 5)));
    const cursor = decodeCursor(input.cursor);
    const regularQueueIndexBefore = clamp(cursor?.regularQueueIndex ?? 0, 0, Number.MAX_SAFE_INTEGER);

    const source = await this.loadCandidatesForRequest();
    const ordered = deterministicShuffleCandidates(source.items, buildQueueSeed(viewerId, source.seedLoadedAtMs));
    const pageRows = ordered.slice(regularQueueIndexBefore, regularQueueIndexBefore + limit);
    const regularQueueIndexAfter = clamp(regularQueueIndexBefore + pageRows.length, 0, ordered.length);
    const items = pageRows.map((row, index) => toPostCard(row, index, requestId));
    const exhausted = regularQueueIndexAfter >= ordered.length;
    const remainingRegular = Math.max(0, ordered.length - regularQueueIndexAfter);
    const nextCursor =
      items.length === 0 && exhausted
        ? null
        : encodeCursor({
            page: Math.max(1, (cursor?.page ?? 0) + 1),
            mode: "regular",
            reelQueueIndex: 0,
            regularQueueIndex: regularQueueIndexAfter,
          });

    return {
      requestId,
      items,
      nextCursor,
      exhausted,
      feedState: {
        mode: "regular",
        reelQueueIndex: 0,
        reelQueueCount: 0,
        remainingReels: 0,
        regularQueueIndex: regularQueueIndexAfter,
        regularQueueCount: ordered.length,
        remainingRegular,
      },
      debug: {
        requestId,
        viewerId,
        engineVersion: ENGINE_VERSION,
        returnedCount: items.length,
        reelCount: 0,
        regularCount: items.length,
        recycledRegularCount: 0,
        feedStateCreated: !cursor,
        reelQueueReadCount: 0,
        regularQueueReadCount: source.readCount,
        feedStateWriteOk: true,
        servedWriteCount: 0,
        servedWriteOk: true,
        queueRebuilt: source.queueRebuilt,
        emptyReason: items.length > 0 ? null : "no_eligible_posts",
        latencyMs: Date.now() - startedAt,
        reelQueueIndexBefore: 0,
        reelQueueIndexAfter: 0,
        reelQueueCount: 0,
        regularQueueIndexBefore,
        regularQueueIndexAfter,
        regularQueueCount: ordered.length,
        remainingReels: 0,
        remainingRegular,
        postIdsReturned: items.map((item) => item.postId),
        poolState: source.poolState,
      },
    };
  }

  private async loadCandidatesForRequest(): Promise<{
    items: ForYouCandidate[];
    readCount: number;
    queueRebuilt: boolean;
    poolState: "warm" | "stale" | "warming" | "cold_fallback";
    seedLoadedAtMs: number;
  }> {
    const now = Date.now();
    const recentFresh = this.recentPool.items.length > 0 && now - this.recentPool.loadedAtMs < RECENT_POOL_TTL_MS;
    if (recentFresh) {
      return {
        items: this.recentPool.items,
        readCount: 0,
        queueRebuilt: false,
        poolState: "warm",
        seedLoadedAtMs: this.recentPool.loadedAtMs,
      };
    }

    if (this.recentPool.items.length > 0) {
      this.startWarmRefresh();
      return {
        items: this.recentPool.items,
        readCount: 0,
        queueRebuilt: false,
        poolState: "stale",
        seedLoadedAtMs: this.recentPool.loadedAtMs,
      };
    }

    this.startWarmRefresh();

    if (this.fallbackPool.items.length > 0 && now - this.fallbackPool.loadedAtMs < RECENT_POOL_TTL_MS) {
      return {
        items: this.fallbackPool.items,
        readCount: 0,
        queueRebuilt: false,
        poolState: "warming",
        seedLoadedAtMs: this.fallbackPool.loadedAtMs,
      };
    }

    const fallbackRows = await this.repository.fetchFallbackWindow(FALLBACK_WINDOW_LIMIT);
    const items = dedupeCandidates(fallbackRows.filter((candidate) => isRenderableCandidate(candidate)));
    this.fallbackPool.items = items;
    this.fallbackPool.loadedAtMs = Date.now();
    this.fallbackPool.lastReadCount = fallbackRows.length;
    return {
      items,
      readCount: fallbackRows.length,
      queueRebuilt: false,
      poolState: "cold_fallback",
      seedLoadedAtMs: this.fallbackPool.loadedAtMs,
    };
  }

  private startWarmRefresh(): void {
    if (this.recentPool.inFlight) return;
    this.recentPool.inFlight = (async () => {
      const recent = await this.repository.fetchRecentWindow(RECENT_POOL_LIMIT);
      this.recentPool.items = dedupeCandidates(recent.filter((candidate) => isRenderableCandidate(candidate)));
      this.recentPool.loadedAtMs = Date.now();
      this.recentPool.lastReadCount = recent.length;
      if (this.recentPool.items.length > 0) {
        this.fallbackPool.items = this.recentPool.items.slice(0, Math.min(this.recentPool.items.length, FALLBACK_WINDOW_LIMIT));
        this.fallbackPool.loadedAtMs = this.recentPool.loadedAtMs;
        this.fallbackPool.lastReadCount = 0;
      }
    })()
      .catch(() => {
        // Best-effort warmup; callers already have a bounded fallback path.
      })
      .finally(() => {
        this.recentPool.inFlight = null;
      });
  }
}

function isRenderableCandidate(candidate: ForYouCandidate): boolean {
  return Boolean(candidate.postId && candidate.authorId && candidate.posterUrl && candidate.posterUrl.trim().length > 0);
}

function dedupeCandidates(rows: ForYouCandidate[]): ForYouCandidate[] {
  const seen = new Set<string>();
  const out: ForYouCandidate[] = [];
  for (const row of rows) {
    if (seen.has(row.postId)) continue;
    seen.add(row.postId);
    out.push(row);
  }
  return out;
}

function carouselCompactAssetCap(assetCount: number): number {
  const n = Math.max(1, Math.floor(assetCount || 1));
  return Math.min(12, n);
}

function toPostCard(candidate: ForYouCandidate, idx: number, requestId: string): FeedCardDTO {
  return toFeedCardDTO({
    postId: candidate.postId,
    rankToken: `fy:${requestId.slice(0, 8)}:${idx + 1}`,
    author: {
      userId: candidate.authorId,
      handle: candidate.authorHandle,
      name: candidate.authorName,
      pic: candidate.authorPic,
    },
    activities: candidate.activities,
    address: candidate.address,
    carouselFitWidth: candidate.carouselFitWidth,
    layoutLetterbox: candidate.layoutLetterbox,
    letterboxGradientTop: candidate.letterboxGradientTop,
    letterboxGradientBottom: candidate.letterboxGradientBottom,
    letterboxGradients: candidate.letterboxGradients,
    geo: candidate.geo,
    assets: candidate.assets,
    compactAssetLimit: carouselCompactAssetCap(candidate.assets.length),
    title: candidate.title,
    captionPreview: candidate.captionPreview,
    firstAssetUrl: candidate.firstAssetUrl,
    media: {
      type: candidate.mediaType,
      posterUrl: candidate.posterUrl,
      aspectRatio: candidate.assets[0]?.aspectRatio ?? 9 / 16,
      startupHint: candidate.mediaType === "video" ? "poster_then_preview" : "poster_only",
    },
    social: {
      likeCount: candidate.likeCount,
      commentCount: candidate.commentCount,
    },
    viewer: {
      liked: false,
      saved: false,
    },
    createdAtMs: candidate.createdAtMs,
    updatedAtMs: candidate.updatedAtMs,
  });
}

function deterministicShuffleCandidates(rows: ForYouCandidate[], seed: string): ForYouCandidate[] {
  return [...rows]
    .map((row, index) => ({
      row,
      index,
      sortKey: createHash("sha256").update(`${seed}:${row.postId}`).digest("hex"),
    }))
    .sort((a, b) => b.row.createdAtMs - a.row.createdAtMs || a.sortKey.localeCompare(b.sortKey) || a.index - b.index)
    .map((entry) => entry.row);
}

function buildQueueSeed(viewerId: string, loadedAtMs: number): string {
  const bucket = Math.floor(loadedAtMs / RECENT_POOL_TTL_MS);
  return `${viewerId}:${ENGINE_VERSION}:${bucket}`;
}

function encodeCursor(state: FeedCursorState): string {
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(state), "utf8").toString("base64url")}`;
}

function decodeCursor(cursor: string | null): FeedCursorState | null {
  if (!cursor) return null;
  const normalized = cursor.trim();
  if (!normalized.startsWith(CURSOR_PREFIX)) return null;
  try {
    const raw = Buffer.from(normalized.slice(CURSOR_PREFIX.length), "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Partial<FeedCursorState>;
    const page = Number(parsed.page);
    const reelQueueIndex = Number(parsed.reelQueueIndex);
    const regularQueueIndex = Number(parsed.regularQueueIndex);
    if (
      !Number.isFinite(page) ||
      page < 0 ||
      !Number.isFinite(reelQueueIndex) ||
      reelQueueIndex < 0 ||
      !Number.isFinite(regularQueueIndex) ||
      regularQueueIndex < 0
    ) {
      return null;
    }
    return {
      page: Math.floor(page),
      mode: "regular",
      reelQueueIndex: 0,
      regularQueueIndex: Math.floor(regularQueueIndex),
    };
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
