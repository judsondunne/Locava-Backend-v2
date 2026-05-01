import { createHash, randomUUID } from "node:crypto";
import { buildPostEnvelope } from "../../lib/posts/post-envelope.js";
import type {
  FeedForYouMode,
  FeedForYouRepository,
  ForYouCandidate,
} from "../../repositories/surfaces/feed-for-you.repository.js";

const ENGINE_VERSION = "queue-reels-regular-v2";
const CURSOR_PREFIX = "fq:v2:";
const RECENT_POOL_LIMIT = 240;
const RECENT_POOL_TTL_MS = 30_000;

type FeedCursorState = {
  page: number;
  mode: FeedForYouMode;
  reelQueueIndex: number;
  regularQueueIndex: number;
};

type ForYouPostCard = {
  postId: string;
  rankToken: string;
  author: { userId: string; handle: string; name: string | null; pic: string | null };
  activities: string[];
  address: string | null;
  carouselFitWidth?: boolean;
  layoutLetterbox?: boolean;
  letterboxGradientTop?: string | null;
  letterboxGradientBottom?: string | null;
  letterboxGradients?: Array<{ top: string; bottom: string }>;
  geo: ForYouCandidate["geo"];
  assets: ForYouCandidate["assets"];
  comments: ForYouCandidate["comments"];
  commentsPreview: ForYouCandidate["commentsPreview"];
  title: string | null;
  captionPreview: string | null;
  firstAssetUrl: string | null;
  media: { type: "image" | "video"; posterUrl: string; aspectRatio: number; startupHint: "poster_only" | "poster_then_preview" };
  social: { likeCount: number; commentCount: number };
  viewer: { liked: boolean; saved: boolean };
  createdAtMs: number;
  updatedAtMs: number;
};

type RecentPool = {
  items: ForYouCandidate[];
  loadedAtMs: number;
  lastReadCount: number;
  inFlight: Promise<void> | null;
};

export class FeedForYouService {
  private readonly recentPool: RecentPool = {
    items: [],
    loadedAtMs: 0,
    lastReadCount: 0,
    inFlight: null,
  };

  constructor(
    private readonly repository: Pick<FeedForYouRepository, "fetchRecentWindow">
  ) {}

  async getForYouPage(input: {
    viewerId: string;
    limit: number;
    cursor: string | null;
    debug: boolean;
    requestId?: string;
  }): Promise<{
    requestId: string;
    items: ForYouPostCard[];
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
    };
  }> {
    const startedAt = Date.now();
    const requestId = input.requestId ?? randomUUID();
    const viewerId = input.viewerId.trim() || "anonymous";
    const limit = Math.max(1, Math.min(20, Math.floor(input.limit || 5)));
    const cursor = decodeCursor(input.cursor);
    const regularQueueIndexBefore = clamp(cursor?.regularQueueIndex ?? 0, 0, Number.MAX_SAFE_INTEGER);

    const { items: poolItems, queueRebuilt, readCount } = await this.loadRecentPool();
    const ordered = deterministicShuffleCandidates(poolItems, buildQueueSeed(viewerId, this.recentPool.loadedAtMs));
    const pageRows = ordered.slice(regularQueueIndexBefore, regularQueueIndexBefore + limit);
    const regularQueueIndexAfter = clamp(
      regularQueueIndexBefore + pageRows.length,
      0,
      ordered.length
    );
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
        regularQueueReadCount: readCount,
        feedStateWriteOk: true,
        servedWriteCount: 0,
        servedWriteOk: true,
        queueRebuilt,
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
      },
    };
  }

  private async loadRecentPool(): Promise<{
    items: ForYouCandidate[];
    queueRebuilt: boolean;
    readCount: number;
  }> {
    const now = Date.now();
    if (this.recentPool.items.length > 0 && now - this.recentPool.loadedAtMs < RECENT_POOL_TTL_MS) {
      return { items: this.recentPool.items, queueRebuilt: false, readCount: 0 };
    }
    if (this.recentPool.inFlight) {
      await this.recentPool.inFlight;
      return { items: this.recentPool.items, queueRebuilt: false, readCount: 0 };
    }
    this.recentPool.inFlight = (async () => {
      const recent = await this.repository.fetchRecentWindow(RECENT_POOL_LIMIT);
      this.recentPool.items = dedupeCandidates(
        recent.filter((candidate) => isRenderableCandidate(candidate))
      );
      this.recentPool.loadedAtMs = Date.now();
      this.recentPool.lastReadCount = recent.length;
    })().finally(() => {
      this.recentPool.inFlight = null;
    });
    await this.recentPool.inFlight;
    return {
      items: this.recentPool.items,
      queueRebuilt: true,
      readCount: this.recentPool.lastReadCount,
    };
  }
}

function isRenderableCandidate(candidate: ForYouCandidate): boolean {
  return Boolean(
    candidate.postId &&
      candidate.authorId &&
      candidate.posterUrl &&
      candidate.posterUrl.trim().length > 0
  );
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

function toPostCard(candidate: ForYouCandidate, idx: number, requestId: string): ForYouPostCard {
  const seed: ForYouPostCard = {
    postId: candidate.postId,
    rankToken: `fy:${requestId.slice(0, 8)}:${idx + 1}`,
    author: {
      userId: candidate.authorId,
      handle: candidate.authorHandle,
      name: candidate.authorName,
      pic: candidate.authorPic
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
    comments: candidate.comments,
    commentsPreview: candidate.commentsPreview,
    title: candidate.title,
    captionPreview: candidate.captionPreview,
    firstAssetUrl: candidate.firstAssetUrl,
    media: {
      type: candidate.mediaType,
      posterUrl: candidate.posterUrl,
      aspectRatio: 9 / 16,
      startupHint: candidate.mediaType === "video" ? "poster_then_preview" : "poster_only"
    },
    social: {
      likeCount: candidate.likeCount,
      commentCount: candidate.commentCount
    },
    viewer: {
      liked: false,
      saved: false
    },
    createdAtMs: candidate.createdAtMs,
    updatedAtMs: candidate.updatedAtMs
  };
  return buildPostEnvelope({
    postId: candidate.postId,
    seed,
    sourcePost: candidate.sourcePost ?? candidate.rawPost ?? (candidate as unknown as Record<string, unknown>),
    rawPost: candidate.rawPost ?? candidate.sourcePost ?? (candidate as unknown as Record<string, unknown>),
    hydrationLevel: "card",
    sourceRoute: "feed_for_you.service",
    rankToken: seed.rankToken,
    author: seed.author,
    social: seed.social,
    viewer: seed.viewer,
    debugSource: "FeedForYouService.toPostCard",
  }) as ForYouPostCard;
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
      regularQueueIndex: Math.floor(regularQueueIndex)
    };
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
