import { createHash, randomUUID } from "node:crypto";
import type {
  FeedForYouMode,
  FeedForYouRepository,
  FeedForYouState,
  ForYouCandidate,
  ForYouSourceBucket
} from "../../repositories/surfaces/feed-for-you.repository.js";

const ENGINE_VERSION = "queue-reels-regular-v2";
const CURSOR_PREFIX = "fq:v2:";
const REEL_QUEUE_LIMIT = 500;
const REGULAR_QUEUE_LIMIT = 1000;
const QUEUE_SKIP_BUFFER = 5;
const QUEUE_FETCH_CHUNK = 5;

type FeedCursorState = {
  page: number;
  mode: FeedForYouMode;
  reelQueueIndex: number;
  regularQueueIndex: number;
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

type QueueReadResult = {
  items: ForYouCandidate[];
  nextIndex: number;
  consumed: number;
  readCount: number;
};

export class FeedForYouService {
  private readonly stateCache = new Map<string, FeedForYouState>();

  constructor(
    private readonly repository: Pick<
      FeedForYouRepository,
      "getFeedState" | "saveFeedState" | "fetchEligibleReelIds" | "fetchEligibleRegularIds" | "fetchPostsByIds"
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

    let feedStateCreated = false;
    let queueRebuilt = false;
    let state = cursor ? normalizeState(this.stateCache.get(viewerId) ?? null) : null;
    if (!state) {
      state = normalizeState(await this.repository.getFeedState(viewerId));
    }
    if (!state) {
      state = await this.buildInitialState(viewerId);
      feedStateCreated = true;
      queueRebuilt = true;
    } else {
      const ensured = await this.ensureQueues(viewerId, state);
      state = ensured.state;
      queueRebuilt = queueRebuilt || ensured.queueRebuilt;
    }

    const reelQueueIndexBefore = state.reelQueueIndex;
    const regularQueueIndexBefore = state.regularQueueIndex;

    const reelSelection = await this.readQueuedPosts({
      queue: state.reelQueue,
      queueIndex: state.reelQueueIndex,
      limit,
      expectedBucket: "reel"
    });
    const rankedReels = reelSelection.items.map((row) => ({ ...row, sourceBucket: "reel" as const }));

    let regularSelection: QueueReadResult = {
      items: [],
      nextIndex: state.regularQueueIndex,
      consumed: 0,
      readCount: 0
    };
    if (rankedReels.length < limit) {
      regularSelection = await this.readQueuedPosts({
        queue: state.regularQueue,
        queueIndex: state.regularQueueIndex,
        limit: limit - rankedReels.length,
        expectedBucket: "regular"
      });
    }
    let rankedRegular = regularSelection.items.map((row) => ({ ...row, sourceBucket: "regular" as const }));

    let nextState: FeedForYouState = {
      ...state,
      reelQueueSourceVersion: ENGINE_VERSION,
      regularQueueSourceVersion: ENGINE_VERSION,
      reelQueueCount: state.reelQueue.length,
      regularQueueCount: state.regularQueue.length,
      reelQueueIndex: reelSelection.nextIndex,
      regularQueueIndex: regularSelection.nextIndex,
      randomSeed: state.randomSeed || buildRandomSeed(viewerId),
      updatedAtMs: Date.now()
    };

    if (
      rankedReels.length + rankedRegular.length < limit &&
      nextState.reelQueueIndex >= nextState.reelQueue.length &&
      nextState.regularQueueIndex >= nextState.regularQueue.length
    ) {
      const rebuiltRegularState = await this.buildRegularQueueState(viewerId, nextState.createdAtMs ?? Date.now());
      nextState = {
        ...nextState,
        regularQueue: rebuiltRegularState.regularQueue,
        regularQueueGeneratedAtMs: rebuiltRegularState.regularQueueGeneratedAtMs,
        regularQueueSourceVersion: ENGINE_VERSION,
        regularQueueCount: rebuiltRegularState.regularQueueCount,
        regularQueueIndex: rebuiltRegularState.regularQueueIndex,
        updatedAtMs: Date.now()
      };
      queueRebuilt = true;
      if (nextState.regularQueue.length > 0) {
        const rebuiltSelection = await this.readQueuedPosts({
          queue: nextState.regularQueue,
          queueIndex: nextState.regularQueueIndex,
          limit: limit - rankedReels.length - rankedRegular.length,
          expectedBucket: "regular"
        });
        regularSelection = {
          items: [...regularSelection.items, ...rebuiltSelection.items],
          nextIndex: rebuiltSelection.nextIndex,
          consumed: regularSelection.consumed + rebuiltSelection.consumed,
          readCount: regularSelection.readCount + rebuiltSelection.readCount
        };
        rankedRegular = regularSelection.items.map((row) => ({ ...row, sourceBucket: "regular" as const }));
        nextState.regularQueueIndex = rebuiltSelection.nextIndex;
      }
    }

    const ranked = [...rankedReels, ...rankedRegular].slice(0, limit);
    const postCards = ranked.map((row, index) => toPostCard(row, index, requestId));
    const reelCount = rankedReels.length;
    const regularCount = rankedRegular.length;
    const mode = resolveMode(reelCount, regularCount);
    const remainingReels = Math.max(0, nextState.reelQueue.length - nextState.reelQueueIndex);
    const remainingRegular = Math.max(0, nextState.regularQueue.length - nextState.regularQueueIndex);
    const exhausted = postCards.length === 0 && remainingReels === 0 && remainingRegular === 0;

    let feedStateWriteOk = true;
    try {
      await this.repository.saveFeedState(viewerId, nextState);
      this.stateCache.set(viewerId, {
        ...nextState,
        reelQueue: [...nextState.reelQueue],
        regularQueue: [...nextState.regularQueue]
      });
    } catch (error) {
      feedStateWriteOk = false;
      console.error("[feed-for-you][feed-state-write-failed]", {
        requestId,
        viewerId,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error)
      });
    }

    const nextCursor =
      postCards.length === 0 && exhausted
        ? null
        : encodeCursor({
            page: Math.max(1, (cursor?.page ?? 0) + 1),
            mode,
            reelQueueIndex: nextState.reelQueueIndex,
            regularQueueIndex: nextState.regularQueueIndex
          });

    return {
      requestId,
      items: postCards,
      nextCursor,
      exhausted,
      feedState: {
        mode,
        reelQueueIndex: nextState.reelQueueIndex,
        reelQueueCount: nextState.reelQueue.length,
        remainingReels,
        regularQueueIndex: nextState.regularQueueIndex,
        regularQueueCount: nextState.regularQueue.length,
        remainingRegular
      },
      debug: {
        requestId,
        viewerId,
        engineVersion: ENGINE_VERSION,
        returnedCount: postCards.length,
        reelCount,
        regularCount,
        recycledRegularCount: 0,
        feedStateCreated,
        reelQueueReadCount: reelSelection.readCount,
        regularQueueReadCount: regularSelection.readCount,
        feedStateWriteOk,
        servedWriteCount: 0,
        servedWriteOk: true,
        queueRebuilt,
        emptyReason: postCards.length > 0 ? null : exhausted ? "no_eligible_posts" : "pending_more_posts",
        latencyMs: Date.now() - startedAt,
        reelQueueIndexBefore,
        reelQueueIndexAfter: nextState.reelQueueIndex,
        reelQueueCount: nextState.reelQueue.length,
        regularQueueIndexBefore,
        regularQueueIndexAfter: nextState.regularQueueIndex,
        regularQueueCount: nextState.regularQueue.length,
        remainingReels,
        remainingRegular,
        postIdsReturned: postCards.map((item) => item.postId)
      }
    };
  }

  private async buildInitialState(viewerId: string): Promise<FeedForYouState> {
    const now = Date.now();
    const reelState = await this.buildReelQueueState(viewerId, now);
    const regularState = await this.buildRegularQueueState(viewerId, now);
    return {
      viewerId,
      surface: "home_for_you",
      ...reelState,
      ...regularState,
      randomSeed: buildRandomSeed(viewerId),
      updatedAtMs: now,
      createdAtMs: now
    };
  }

  private async ensureQueues(
    viewerId: string,
    state: FeedForYouState
  ): Promise<{ state: FeedForYouState; queueRebuilt: boolean }> {
    let nextState = state;
    let queueRebuilt = false;
    const now = Date.now();

    if (!hasQueueState(nextState.reelQueue, nextState.reelQueueSourceVersion, nextState.reelQueueIndex, REEL_QUEUE_LIMIT)) {
      nextState = {
        ...nextState,
        ...(await this.buildReelQueueState(viewerId, now))
      };
      queueRebuilt = true;
    }

    if (!hasQueueState(nextState.regularQueue, nextState.regularQueueSourceVersion, nextState.regularQueueIndex, REGULAR_QUEUE_LIMIT)) {
      nextState = {
        ...nextState,
        ...(await this.buildRegularQueueState(viewerId, now))
      };
      queueRebuilt = true;
    }

    if (!nextState.randomSeed) {
      nextState = {
        ...nextState,
        randomSeed: buildRandomSeed(viewerId)
      };
    }

    return { state: nextState, queueRebuilt };
  }

  private async buildReelQueueState(
    viewerId: string,
    now: number
  ): Promise<Pick<FeedForYouState, "reelQueue" | "reelQueueGeneratedAtMs" | "reelQueueSourceVersion" | "reelQueueCount" | "reelQueueIndex">> {
    const reelIds = await this.repository.fetchEligibleReelIds(REEL_QUEUE_LIMIT);
    const reelQueue = deterministicShuffle(reelIds.slice(0, REEL_QUEUE_LIMIT), buildQueueSeed(viewerId, "reels"));
    return {
      reelQueue,
      reelQueueGeneratedAtMs: now,
      reelQueueSourceVersion: ENGINE_VERSION,
      reelQueueCount: reelQueue.length,
      reelQueueIndex: 0
    };
  }

  private async buildRegularQueueState(
    viewerId: string,
    now: number
  ): Promise<
    Pick<FeedForYouState, "regularQueue" | "regularQueueGeneratedAtMs" | "regularQueueSourceVersion" | "regularQueueCount" | "regularQueueIndex">
  > {
    const regularIds = await this.repository.fetchEligibleRegularIds(REGULAR_QUEUE_LIMIT);
    const regularQueue = deterministicShuffle(regularIds.slice(0, REGULAR_QUEUE_LIMIT), buildQueueSeed(viewerId, "regular"));
    return {
      regularQueue,
      regularQueueGeneratedAtMs: now,
      regularQueueSourceVersion: ENGINE_VERSION,
      regularQueueCount: regularQueue.length,
      regularQueueIndex: 0
    };
  }

  private async readQueuedPosts(input: {
    queue: string[];
    queueIndex: number;
    limit: number;
    expectedBucket: "reel" | "regular";
  }): Promise<QueueReadResult> {
    if (input.limit <= 0) {
      return { items: [], nextIndex: input.queueIndex, consumed: 0, readCount: 0 };
    }

    const items: ForYouCandidate[] = [];
    let readCount = 0;
    let cursor = clamp(input.queueIndex, 0, input.queue.length);
    const startIndex = cursor;
    const maxConsume = Math.min(input.queue.length, cursor + input.limit + QUEUE_SKIP_BUFFER);

    while (items.length < input.limit && cursor < maxConsume) {
      const batchIds = input.queue.slice(cursor, Math.min(maxConsume, cursor + QUEUE_FETCH_CHUNK));
      if (batchIds.length === 0) break;
      const fetched = await this.repository.fetchPostsByIds(batchIds);
      const byId = new Map(fetched.map((row) => [row.postId, row]));
      readCount += batchIds.length;
      for (const postId of batchIds) {
        cursor += 1;
        const row = byId.get(postId);
        if (!row) continue;
        if (input.expectedBucket === "reel" && row.reel !== true) continue;
        if (input.expectedBucket === "regular" && row.reel === true) continue;
        items.push(row);
        if (items.length >= input.limit) break;
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
  if (!Array.isArray(state.reelQueue) || !Number.isFinite(state.reelQueueIndex) || state.reelQueueIndex < 0) return null;
  const reelQueue = state.reelQueue.filter((id) => typeof id === "string" && id.trim().length > 0).slice(0, REEL_QUEUE_LIMIT);
  const regularQueue = Array.isArray(state.regularQueue)
    ? state.regularQueue.filter((id) => typeof id === "string" && id.trim().length > 0).slice(0, REGULAR_QUEUE_LIMIT)
    : [];
  return {
    ...state,
    reelQueue,
    reelQueueCount: reelQueue.length,
    reelQueueIndex: clamp(Math.floor(state.reelQueueIndex), 0, reelQueue.length),
    regularQueue,
    regularQueueCount: regularQueue.length,
    regularQueueIndex: clamp(Math.floor(state.regularQueueIndex || 0), 0, regularQueue.length)
  };
}

function hasQueueState(queue: string[], sourceVersion: string, index: number, cap: number): boolean {
  return (
    Array.isArray(queue) &&
    queue.length <= cap &&
    typeof sourceVersion === "string" &&
    sourceVersion.trim().length > 0 &&
    Number.isFinite(index) &&
    index >= 0
  );
}

function resolveMode(reelCount: number, regularCount: number): FeedForYouMode {
  if (reelCount > 0 && regularCount === 0) return "reels";
  if (reelCount > 0 && regularCount > 0) return "mixed";
  return "regular";
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

function buildRandomSeed(viewerId: string): string {
  return `${viewerId}:${ENGINE_VERSION}`;
}

function buildQueueSeed(viewerId: string, bucket: "reels" | "regular"): string {
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
      mode: parsed.mode === "mixed" || parsed.mode === "regular" ? parsed.mode : "reels",
      reelQueueIndex: Math.floor(reelQueueIndex),
      regularQueueIndex: Math.floor(regularQueueIndex)
    };
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
