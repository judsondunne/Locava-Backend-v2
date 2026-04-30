import { createHash, randomUUID } from "node:crypto";
import type {
  FeedForYouMode,
  FeedForYouState,
  FeedForYouRepository,
  ForYouCandidate,
  ForYouServedWriteRecord,
  ForYouSourceBucket
} from "../../repositories/surfaces/feed-for-you.repository.js";

const ENGINE_VERSION = "queue-reels-v1";
const CURSOR_PREFIX = "fq:v1:";
const REEL_QUEUE_LIMIT = 500;
const REEL_SKIP_BUFFER = 10;
const REEL_FETCH_CHUNK = 10;
const REGULAR_WINDOW_LIMIT = 30;
const REGULAR_RECENT_CAP = 100;

type FeedCursorState = {
  page: number;
  mode: FeedForYouMode;
  reelQueueIndex: number;
};

type RankedCandidate = ForYouCandidate & { sourceBucket: ForYouSourceBucket };

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

export class FeedForYouService {
  constructor(
    private readonly repository: Pick<
      FeedForYouRepository,
      "getFeedState" | "saveFeedState" | "fetchEligibleReelIds" | "fetchPostsByIds" | "fetchRecentWindow" | "writeServedPosts"
    >
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
    };
    debug: {
      requestId: string;
      viewerId: string;
      engineVersion: string;
      returnedCount: number;
      reelCount: number;
      regularCount: number;
      recycledRegularCount: number;
      feedStateCreated: boolean;
      reelQueueReadCount: number;
      reelQueueConsumed: number;
      feedStateWriteOk: boolean;
      servedWriteCount: number;
      servedWriteOk: boolean;
      regularWindowFetched: number;
      emptyReason: string | null;
      latencyMs: number;
      reelQueueIndexBefore: number;
      reelQueueIndexAfter: number;
    };
  }> {
    const startedAt = Date.now();
    const requestId = input.requestId ?? randomUUID();
    const viewerId = input.viewerId.trim() || "anonymous";
    const limit = Math.max(1, Math.min(20, Math.floor(input.limit || 5)));
    const cursor = decodeCursor(input.cursor);

    let feedStateCreated = false;
    let state = normalizeState(await this.repository.getFeedState(viewerId));
    if (!state) {
      state = await this.buildInitialState(viewerId);
      feedStateCreated = true;
    }

    const reelQueueIndexBefore = state.reelQueueIndex;
    const reelSelection = await this.readQueuedReels(state, limit);
    const rankedReels = reelSelection.items.map((row) => ({ ...row, sourceBucket: "reel" as const }));

    const regularWindow = rankedReels.length < limit ? await this.repository.fetchRecentWindow(REGULAR_WINDOW_LIMIT) : [];
    const regularWindowFetched = regularWindow.length;
    const regularSelection = selectRegularPosts({
      rows: regularWindow,
      regularServedRecent: state.regularServedRecent,
      excludePostIds: rankedReels.map((row) => row.postId),
      limit: limit - rankedReels.length
    });

    const rankedRegular = [
      ...regularSelection.fresh.map((row) => ({ ...row, sourceBucket: "regular" as const })),
      ...regularSelection.recycled.map((row) => ({ ...row, sourceBucket: "recycled_real_posts" as const }))
    ];

    const ranked = [...rankedReels, ...rankedRegular].slice(0, limit);
    const mode = resolveMode(rankedReels.length, rankedRegular.length);
    const postCards = ranked.map((row, index) => toPostCard(row, index, requestId));

    let servedWriteCount = 0;
    let servedWriteOk = true;
    try {
      servedWriteCount = await this.repository.writeServedPosts(
        viewerId,
        ranked.map((item, index) => toServedWrite(item, index, requestId))
      );
    } catch (error) {
      servedWriteOk = false;
      console.error("[feed-for-you][served-write-failed]", {
        requestId,
        viewerId,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error)
      });
    }

    const nextState: FeedForYouState = {
      ...state,
      reelQueueIndex: reelSelection.nextIndex,
      reelQueueCount: state.reelQueue.length,
      regularCursorTime: rankedRegular[rankedRegular.length - 1]?.createdAtMs ?? state.regularCursorTime ?? null,
      regularCursorPostId: rankedRegular[rankedRegular.length - 1]?.postId ?? state.regularCursorPostId ?? null,
      regularServedRecent: pushRecentIds(
        state.regularServedRecent,
        regularSelection.fresh.map((row) => row.postId).concat(regularSelection.recycled.map((row) => row.postId)),
        REGULAR_RECENT_CAP
      ),
      updatedAtMs: Date.now()
    };

    let feedStateWriteOk = true;
    try {
      await this.repository.saveFeedState(viewerId, nextState);
    } catch (error) {
      feedStateWriteOk = false;
      console.error("[feed-for-you][feed-state-write-failed]", {
        requestId,
        viewerId,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error)
      });
    }

    const remainingReels = Math.max(0, nextState.reelQueue.length - nextState.reelQueueIndex);
    const hasRegularOptions = regularSelection.fresh.length > 0 || regularSelection.recycled.length > 0;
    const exhausted = postCards.length === 0 && remainingReels === 0 && !hasRegularOptions;
    const nextCursor = exhausted
      ? null
      : encodeCursor({
          page: Math.max(1, (cursor?.page ?? 0) + 1),
          mode,
          reelQueueIndex: nextState.reelQueueIndex
        });

    const reelCount = rankedReels.length;
    const regularCount = regularSelection.fresh.length;
    const recycledRegularCount = regularSelection.recycled.length;

    return {
      requestId,
      items: postCards,
      nextCursor,
      exhausted,
      feedState: {
        mode,
        reelQueueIndex: nextState.reelQueueIndex,
        reelQueueCount: nextState.reelQueue.length,
        remainingReels
      },
      debug: {
        requestId,
        viewerId,
        engineVersion: ENGINE_VERSION as const,
        returnedCount: postCards.length,
        reelCount,
        regularCount,
        recycledRegularCount,
        feedStateCreated,
        reelQueueReadCount: reelSelection.readCount,
        reelQueueConsumed: reelSelection.consumed,
        feedStateWriteOk,
        servedWriteCount,
        servedWriteOk,
        regularWindowFetched,
        emptyReason: postCards.length > 0 ? null : exhausted ? "no_eligible_posts" : "pending_more_posts",
        latencyMs: Date.now() - startedAt,
        reelQueueIndexBefore,
        reelQueueIndexAfter: nextState.reelQueueIndex
      }
    };
  }

  private async buildInitialState(viewerId: string): Promise<FeedForYouState> {
    const now = Date.now();
    const randomSeed = `${viewerId}:${ENGINE_VERSION}`;
    const reelIds = await this.repository.fetchEligibleReelIds(REEL_QUEUE_LIMIT);
    const reelQueue = deterministicShuffle(reelIds.slice(0, REEL_QUEUE_LIMIT), randomSeed);
    return {
      viewerId,
      surface: "home_for_you",
      reelQueue,
      reelQueueGeneratedAtMs: now,
      reelQueueSourceVersion: ENGINE_VERSION,
      reelQueueCount: reelQueue.length,
      reelQueueIndex: 0,
      regularCursorTime: null,
      regularCursorPostId: null,
      randomSeed,
      regularServedRecent: [],
      updatedAtMs: now,
      createdAtMs: now
    };
  }

  private async readQueuedReels(
    state: FeedForYouState,
    limit: number
  ): Promise<{ items: ForYouCandidate[]; nextIndex: number; consumed: number; readCount: number }> {
    const items: ForYouCandidate[] = [];
    let readCount = 0;
    let cursor = clamp(state.reelQueueIndex, 0, state.reelQueue.length);
    const startIndex = cursor;
    const maxConsume = Math.min(state.reelQueue.length, cursor + limit + REEL_SKIP_BUFFER);

    while (items.length < limit && cursor < maxConsume) {
      const batchIds = state.reelQueue.slice(cursor, Math.min(maxConsume, cursor + REEL_FETCH_CHUNK));
      if (batchIds.length === 0) break;
      const fetched = await this.repository.fetchPostsByIds(batchIds);
      const byId = new Map(fetched.map((row) => [row.postId, row]));
      readCount += batchIds.length;
      for (const postId of batchIds) {
        cursor += 1;
        const row = byId.get(postId);
        if (!row || row.reel !== true) continue;
        items.push(row);
        if (items.length >= limit) break;
      }
    }

    return {
      items,
      nextIndex: cursor,
      consumed: cursor - startIndex,
      readCount
    };
  }
}

function normalizeState(state: FeedForYouState | null): FeedForYouState | null {
  if (!state) return null;
  if (state.surface !== "home_for_you") return null;
  if (!Array.isArray(state.reelQueue)) return null;
  if (!Number.isFinite(state.reelQueueIndex) || state.reelQueueIndex < 0) return null;
  const reelQueue = state.reelQueue.filter((id) => typeof id === "string" && id.trim().length > 0).slice(0, REEL_QUEUE_LIMIT);
  return {
    ...state,
    reelQueue,
    reelQueueCount: reelQueue.length,
    reelQueueIndex: clamp(Math.floor(state.reelQueueIndex), 0, reelQueue.length),
    regularServedRecent: Array.isArray(state.regularServedRecent) ? state.regularServedRecent.filter(Boolean).slice(0, REGULAR_RECENT_CAP) : []
  };
}

function selectRegularPosts(input: {
  rows: ForYouCandidate[];
  regularServedRecent: string[];
  excludePostIds: string[];
  limit: number;
}): { fresh: ForYouCandidate[]; recycled: ForYouCandidate[] } {
  if (input.limit <= 0) return { fresh: [], recycled: [] };
  const exclude = new Set(input.excludePostIds);
  const recent = new Set(input.regularServedRecent);
  const eligible = input.rows.filter((row) => row.reel !== true && !exclude.has(row.postId));
  const fresh = eligible.filter((row) => !recent.has(row.postId)).slice(0, input.limit);
  const needed = Math.max(0, input.limit - fresh.length);
  const recycled = needed > 0 ? eligible.filter((row) => recent.has(row.postId)).slice(0, needed) : [];
  return { fresh, recycled };
}

function resolveMode(reelCount: number, regularCount: number): FeedForYouMode {
  if (reelCount > 0 && regularCount === 0) return "reels";
  if (reelCount > 0 && regularCount > 0) return "mixed";
  return "regular";
}

function pushRecentIds(existing: string[], incoming: string[], cap: number): string[] {
  if (incoming.length === 0) return existing.slice(0, cap);
  const seen = new Set<string>();
  const merged = [...incoming, ...existing].filter((id) => {
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return merged.slice(0, cap);
}

function toPostCard(candidate: RankedCandidate, idx: number, requestId: string): ForYouPostCard {
  return {
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
}

function toServedWrite(candidate: RankedCandidate, idx: number, requestId: string): ForYouServedWriteRecord {
  return {
    postId: candidate.postId,
    servedAt: Date.now(),
    feedSurface: "home_for_you",
    feedRequestId: requestId,
    rank: idx + 1,
    sourceBucket: candidate.sourceBucket,
    authorId: candidate.authorId,
    reel: candidate.reel
  };
}

function deterministicShuffle(ids: string[], seed: string): string[] {
  return [...new Set(ids)]
    .map((id, index) => ({
      id,
      index,
      sortKey: createHash("sha256").update(`${seed}:${id}`).digest("hex")
    }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.index - b.index)
    .map((row) => row.id);
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
    if (!Number.isFinite(page) || page < 0 || !Number.isFinite(reelQueueIndex) || reelQueueIndex < 0) return null;
    return {
      page: Math.floor(page),
      mode: parsed.mode === "mixed" || parsed.mode === "regular" ? parsed.mode : "reels",
      reelQueueIndex: Math.floor(reelQueueIndex)
    };
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
