import { randomBytes } from "node:crypto";
import { toFeedCardDTO, type FeedCardDTO } from "../../dto/compact-surface-dto.js";
import type { FeedForYouSimpleRepository, SimpleFeedCandidate, SimpleFeedSortMode } from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import { FOR_YOU_SIMPLE_SURFACE } from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import {
  enqueueFeedSeenServedMarks,
  getFeedSeenAsyncWriterStats
} from "./feed-seen-async-writer.js";

const CURSOR_PREFIX = "fys:v1:";
const MAX_SEEN_IDS = 50;
const DURABLE_SEEN_LIMIT = 500;
const MAX_PHASE_ATTEMPTS = 2;

type PhaseCursorState = {
  anchor: number | string;
  wrapped: boolean;
  lastValue: number | string | null;
  lastPostId: string | null;
};

type FeedForYouSimpleCursor = {
  v: 1;
  mode: SimpleFeedSortMode;
  reel: PhaseCursorState;
  fallback: PhaseCursorState;
  seen: string[];
};

export class FeedForYouSimpleService {
  constructor(
    private readonly repository: Pick<
      FeedForYouSimpleRepository,
      "isEnabled" | "resolveSortMode" | "fetchBatch" | "listRecentSeenPostIdsForViewer" | "markPostsServedForViewer"
    >
  ) {}

  async getPage(input: {
    viewerId: string | null;
    limit: number;
    cursor: string | null;
  }): Promise<{
    routeName: "feed.for_you_simple.get";
    items: FeedCardDTO[];
    nextCursor: string | null;
    debug: {
      source: "firestore_random_simple";
      requestedLimit: number;
      returnedCount: number;
      cursorUsed: boolean;
      randomSeedOrAnchor: string;
      durableSeenReadCount: number;
      cursorSeenCount: number;
      candidateReadCount: number;
      duplicateFilteredCount: number;
      durableSeenFilteredCount: number;
      cursorSeenFilteredCount: number;
      seenWriteAttempted: boolean;
      seenWriteSucceeded: boolean;
      blockingResponseWrites: number;
      deferredWritesQueued: number;
      deferredWriterFlushAttempts: number;
      deferredWriterSucceededFlushes: number;
      deferredWriterFailedFlushes: number;
      boundedAttempts: number;
      exhaustedUnseenCandidates: boolean;
      recycledSeenPosts: false;
      reelFirstEnabled: true;
      reelCandidateReadCount: number;
      fallbackCandidateReadCount: number;
      reelReturnedCount: number;
      fallbackReturnedCount: number;
      reelPhaseExhausted: boolean;
    };
  }> {
    if (!this.repository.isEnabled()) {
      throw new Error("feed_for_you_simple_source_unavailable");
    }

    const limit = Math.max(1, Math.min(10, Math.floor(input.limit || 5)));
    const cursorState = decodeCursor(input.cursor);
    const mode = cursorState?.mode ?? (await this.repository.resolveSortMode());
    const reelState = cursorState?.reel ?? createPhaseState(mode);
    const fallbackState = cursorState?.fallback ?? createPhaseState(mode);
    const cursorSeen = new Set((cursorState?.seen ?? []).filter(Boolean).slice(-MAX_SEEN_IDS));
    const seen = new Set([...cursorSeen]);
    const viewerId = input.viewerId?.trim() ?? "";
    const durableViewerId = isDurableViewerId(viewerId) ? viewerId : "";
    const durableSeen =
      durableViewerId.length > 0
        ? await this.repository.listRecentSeenPostIdsForViewer({
            viewerId: durableViewerId,
            surface: FOR_YOU_SIMPLE_SURFACE,
            limit: DURABLE_SEEN_LIMIT
          })
        : { postIds: new Set<string>(), readCount: 0 };
    let durableSeenFilteredCount = 0;
    let cursorSeenFilteredCount = 0;
    let duplicateFilteredCount = 0;
    let candidateReadCount = 0;
    let reelCandidateReadCount = 0;
    let fallbackCandidateReadCount = 0;
    let boundedAttempts = 0;
    let reelReturnedCount = 0;
    let fallbackReturnedCount = 0;
    let reelPhaseExhausted = false;
    const items: SimpleFeedCandidate[] = [];
    let seenWriteAttempted = false;
    let seenWriteSucceeded = false;
    let deferredWritesQueued = 0;

    const reelPhase = await this.fillFromPhase({
      reelOnly: true,
      limit,
      mode,
      phaseState: reelState,
      seen,
      cursorSeen,
      durableSeen: durableSeen.postIds,
      items
    });
    reelCandidateReadCount = reelPhase.candidateReadCount;
    reelReturnedCount = reelPhase.returnedCount;
    reelPhaseExhausted = reelPhase.exhausted;
    boundedAttempts += reelPhase.attempts;
    durableSeenFilteredCount += reelPhase.durableSeenFilteredCount;
    cursorSeenFilteredCount += reelPhase.cursorSeenFilteredCount;
    duplicateFilteredCount += reelPhase.duplicateFilteredCount;

    const fallbackPhase =
      items.length < limit
        ? await this.fillFromPhase({
            reelOnly: false,
            limit,
            mode,
            phaseState: fallbackState,
            seen,
            cursorSeen,
            durableSeen: durableSeen.postIds,
            items
          })
        : {
            phaseState: fallbackState,
            attempts: 0,
            candidateReadCount: 0,
            returnedCount: 0,
            durableSeenFilteredCount: 0,
            cursorSeenFilteredCount: 0,
            duplicateFilteredCount: 0,
            exhausted: false
          };
    fallbackCandidateReadCount = fallbackPhase.candidateReadCount;
    fallbackReturnedCount = fallbackPhase.returnedCount;
    boundedAttempts += fallbackPhase.attempts;
    durableSeenFilteredCount += fallbackPhase.durableSeenFilteredCount;
    cursorSeenFilteredCount += fallbackPhase.cursorSeenFilteredCount;
    duplicateFilteredCount += fallbackPhase.duplicateFilteredCount;
    candidateReadCount = reelCandidateReadCount + fallbackCandidateReadCount;

    const returnedIds = items.map((candidate) => candidate.postId);
    if (durableViewerId && returnedIds.length > 0) {
      seenWriteAttempted = true;
      const { queued } = enqueueFeedSeenServedMarks({
        viewerId: durableViewerId,
        postIds: returnedIds,
        surface: FOR_YOU_SIMPLE_SURFACE
      });
      deferredWritesQueued = queued;
      seenWriteSucceeded = queued > 0;
    }
    const writerStats = getFeedSeenAsyncWriterStats();

    const nextCursor =
      items.length === 0 && reelPhase.exhausted && fallbackPhase.exhausted
        ? null
        : items.length === 0
          ? null
          : encodeCursor({
              v: 1,
              mode,
              reel: reelPhase.phaseState,
              fallback: fallbackPhase.phaseState,
              seen: [...seen].slice(-MAX_SEEN_IDS)
            });

    return {
      routeName: "feed.for_you_simple.get",
      items: items.map((candidate, index) => toPostCard(candidate, index, viewerId)),
      nextCursor,
      debug: {
        source: "firestore_random_simple",
        requestedLimit: limit,
        returnedCount: items.length,
        cursorUsed: Boolean(input.cursor),
        randomSeedOrAnchor: mode === "randomKey" ? String(reelState.anchor) : `doc:${String(reelState.anchor)}`,
        durableSeenReadCount: durableSeen.readCount,
        cursorSeenCount: cursorSeen.size,
        candidateReadCount,
        duplicateFilteredCount,
        durableSeenFilteredCount,
        cursorSeenFilteredCount,
        seenWriteAttempted,
        seenWriteSucceeded,
        blockingResponseWrites: 0,
        deferredWritesQueued,
        deferredWriterFlushAttempts: writerStats.flushAttempts,
        deferredWriterSucceededFlushes: writerStats.succeeded,
        deferredWriterFailedFlushes: writerStats.failed,
        boundedAttempts,
        exhaustedUnseenCandidates: items.length < limit,
        recycledSeenPosts: false,
        reelFirstEnabled: true,
        reelCandidateReadCount,
        fallbackCandidateReadCount,
        reelReturnedCount,
        fallbackReturnedCount,
        reelPhaseExhausted
      }
    };
  }

  private async fillFromPhase(input: {
    reelOnly: boolean;
    limit: number;
    mode: SimpleFeedSortMode;
    phaseState: PhaseCursorState;
    seen: Set<string>;
    cursorSeen: Set<string>;
    durableSeen: Set<string>;
    items: SimpleFeedCandidate[];
  }): Promise<{
    phaseState: PhaseCursorState;
    attempts: number;
    candidateReadCount: number;
    returnedCount: number;
    durableSeenFilteredCount: number;
    cursorSeenFilteredCount: number;
    duplicateFilteredCount: number;
    exhausted: boolean;
  }> {
    let attempts = 0;
    let candidateReadCount = 0;
    let returnedCount = 0;
    let durableSeenFilteredCount = 0;
    let cursorSeenFilteredCount = 0;
    let duplicateFilteredCount = 0;
    let exhausted = false;
    let state: PhaseCursorState = { ...input.phaseState };

    while (input.items.length < input.limit && attempts < MAX_PHASE_ATTEMPTS) {
      const scanLimit = Math.max(20, Math.min(30, (input.limit - input.items.length) * 4));
      const batch = await this.repository.fetchBatch({
        mode: input.mode,
        anchor: state.anchor,
        wrapped: state.wrapped,
        lastValue: state.lastValue,
        lastPostId: state.lastPostId,
        limit: scanLimit,
        reelOnly: input.reelOnly
      });
      attempts += 1;
      candidateReadCount += batch.readCount;

      for (const candidate of batch.items) {
        if (input.durableSeen.has(candidate.postId)) {
          durableSeenFilteredCount += 1;
          continue;
        }
        if (input.cursorSeen.has(candidate.postId)) {
          cursorSeenFilteredCount += 1;
          continue;
        }
        if (input.seen.has(candidate.postId)) {
          duplicateFilteredCount += 1;
          continue;
        }
        input.seen.add(candidate.postId);
        input.items.push(candidate);
        state.lastValue = candidate.sortValue;
        state.lastPostId = candidate.postId;
        returnedCount += 1;
        if (input.items.length >= input.limit) break;
      }

      if (input.items.length >= input.limit) break;

      if (batch.segmentExhausted || batch.rawCount === 0) {
        if (!state.wrapped) {
          state.wrapped = true;
          state.lastValue = null;
          state.lastPostId = null;
          continue;
        }
        exhausted = true;
        if (attempts < MAX_PHASE_ATTEMPTS) {
          state = createPhaseState(input.mode);
          continue;
        }
        break;
      }
    }

    return {
      phaseState: state,
      attempts,
      candidateReadCount,
      returnedCount,
      durableSeenFilteredCount,
      cursorSeenFilteredCount,
      duplicateFilteredCount,
      exhausted
    };
  }
}

function toPostCard(candidate: SimpleFeedCandidate, index: number, viewerId: string): FeedCardDTO {
  return toFeedCardDTO({
    postId: candidate.postId,
    rankToken: `fys:${viewerId.slice(0, 8) || "anon"}:${index + 1}`,
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
    title: candidate.title,
    captionPreview: candidate.captionPreview,
    firstAssetUrl: candidate.firstAssetUrl,
    media: {
      type: candidate.mediaType,
      posterUrl: candidate.posterUrl,
      aspectRatio: candidate.assets[0]?.aspectRatio ?? 9 / 16,
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
  });
}

function encodeCursor(cursor: FeedForYouSimpleCursor): string {
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
}

function decodeCursor(cursor: string | null): FeedForYouSimpleCursor | null {
  if (!cursor) return null;
  if (!cursor.startsWith(CURSOR_PREFIX)) throw new Error("invalid_simple_feed_cursor");
  try {
    const raw = JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8")) as Record<string, unknown>;
    const mode = raw.mode;
    if (raw.v !== 1) throw new Error("version");
    if (mode !== "randomKey" && mode !== "docId") throw new Error("mode");
    const seen = Array.isArray(raw.seen) ? raw.seen.map((value) => String(value)).filter(Boolean).slice(-MAX_SEEN_IDS) : null;
    if (!seen) throw new Error("seen");
    const reelRaw = (raw.reel as Record<string, unknown> | undefined) ?? null;
    const fallbackRaw = (raw.fallback as Record<string, unknown> | undefined) ?? null;
    if (reelRaw && fallbackRaw) {
      return {
        v: 1,
        mode,
        reel: normalizePhaseState(mode, reelRaw),
        fallback: normalizePhaseState(mode, fallbackRaw),
        seen
      };
    }
    const legacyState = normalizeLegacyPhaseState(mode, raw);
    return {
      v: 1,
      mode,
      reel: createPhaseState(mode),
      fallback: legacyState,
      seen
    };
  } catch {
    throw new Error("invalid_simple_feed_cursor");
  }
}

function createDocIdAnchor(): string {
  return randomBytes(10).toString("hex");
}

function createPhaseState(mode: SimpleFeedSortMode): PhaseCursorState {
  return {
    anchor: mode === "randomKey" ? Math.random() : createDocIdAnchor(),
    wrapped: false,
    lastValue: null,
    lastPostId: null
  };
}

function normalizePhaseState(mode: SimpleFeedSortMode, raw: Record<string, unknown>): PhaseCursorState {
  const normalized = normalizeLegacyPhaseState(mode, raw);
  const lastPostId = typeof raw.lastPostId === "string" && raw.lastPostId.trim() ? raw.lastPostId.trim() : null;
  return { ...normalized, lastPostId };
}

function normalizeLegacyPhaseState(mode: SimpleFeedSortMode, raw: Record<string, unknown>): PhaseCursorState {
  if (mode === "randomKey") {
    const anchor = typeof raw.anchor === "number" ? raw.anchor : Number(raw.anchor);
    if (!Number.isFinite(anchor)) throw new Error("anchor");
    const lastValue = raw.lastValue == null ? null : Number(raw.lastValue);
    if (lastValue != null && !Number.isFinite(lastValue)) throw new Error("lastValue");
    return {
      anchor,
      wrapped: raw.wrapped === true,
      lastValue,
      lastPostId: null
    };
  }
  const anchor = typeof raw.anchor === "string" ? raw.anchor.trim() : "";
  if (!anchor) throw new Error("anchor");
  return {
    anchor,
    wrapped: raw.wrapped === true,
    lastValue: typeof raw.lastValue === "string" && raw.lastValue.trim() ? raw.lastValue.trim() : null,
    lastPostId: null
  };
}

function isDurableViewerId(viewerId: string): boolean {
  const normalized = viewerId.trim().toLowerCase();
  if (!normalized) return false;
  return normalized !== "anonymous" && normalized !== "anon" && normalized !== "guest";
}
