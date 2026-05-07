import { randomBytes } from "node:crypto";
import { toFeedCardDTO, type FeedCardDTO } from "../../dto/compact-surface-dto.js";
import { selectBestVideoPlaybackAsset } from "../../lib/posts/video-playback-selection.js";
import { accumulateSurfaceTiming, getRequestContext } from "../../observability/request-context.js";
import type {
  FeedForYouSimpleRepository,
  SimpleFeedCandidate,
  SimpleFeedSortMode,
  SimpleReadyDeckDoc
} from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import {
  FOR_YOU_SIMPLE_SEEN_READ_CAP,
  FOR_YOU_SIMPLE_SURFACE
} from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import { debugLog } from "../../lib/logging/debug-log.js";
import { LOG_FEED_DEBUG, LOG_VIDEO_DEBUG } from "../../lib/logging/log-config.js";
import { isReadOnlyLatencyAuditEnabled } from "../../safety/read-only-latency-audit-guard.js";

const CURSOR_PREFIX = "fys:v2:";
const LEGACY_CURSOR_PREFIX = "fys:v1:";
const MAX_SEEN_IDS = 50;
const SERVED_RECENT_MAX_IDS = 240;
const SERVED_RECENT_TTL_MS = 24 * 60 * 60 * 1000;
const SERVED_RECENT_CACHE_TTL_MS = 60_000;
const READY_DECK_TARGET_SIZE = 12;
const READY_DECK_MIN_REFILL_THRESHOLD = 6;
const READY_DECK_TTL_MS = 30 * 60 * 1000;
const BLOCKED_AUTHORS_CACHE_TTL_MS = 60_000;

const LIMIT_DEFAULT = 5;
const LIMIT_MIN = 1;
const LIMIT_MAX = 12;

/** Firestore reads budget for main reel+fallback scans (excludes seen ledger + blocked user read). */
const MAX_MAIN_READ_BUDGET = 16;
const BATCH_PAGE_SIZE = 8;
const MAX_SCAN_ATTEMPTS = 6;
const FOR_YOU_SIMPLE_DEBUG_FIXED_IDS_FLAG = "LOCAVA_DEBUG_FOR_YOU_SIMPLE_FIXED_IDS";
const FOR_YOU_SIMPLE_DEBUG_FIXED_ID_LIST = [
  "post_292fd3193917e0e3",
  "post_d46abb1b81bc40ed",
  "post_23809b181c0cb3c4",
  "post_6890aeea764bc3ab",
  "post_f5c376d3dfb551bc",
  "post_22cf1d12ea82e8f1",
  "post_92a8f2a283c9a64a",
  "post_71efc895b5108179",
  "post_580818bf549854cb",
  "post_c6ef5d9de63888e0",
  "post_1d753d0e3a0371ec",
  "post_c51e6b4a78f4c0ce",
  "post_50bc0d01395ffdad",
  "post_a8ae358816081905",
  "post_3a42f16570830ea9",
  "yHBN1O0CkWuyPc37tZlt",
  "eGAS1ltuHiapWnAULk2p",
  "post_ac439fb86d4737d3",
  "post_b937d784b8b13248",
  "post_d1515a06e2012f39",
  "post_6a24153d0aad2ed1",
  "post_bb8d259ba4195290",
  "post_79370ef4fcb481f5",
  "post_dbacbc3770a2673f",
  "post_fd5cf45f4f56ec3d",
  "post_be233a003bdb153b",
  "post_760e7df537939a6e",
  "post_b1904eac1486174c",
  "post_503e60c9f63229d1",
  "post_1be506728c67d93f"
] as const;
const FOR_YOU_SIMPLE_DEBUG_FIXED_IDS = new Set<string>(FOR_YOU_SIMPLE_DEBUG_FIXED_ID_LIST);

type PhaseCursorState = {
  anchor: number | string;
  wrapped: boolean;
  lastValue: number | string | null;
  lastPostId: string | null;
};

type FeedForYouSimpleCursor = {
  v: 2;
  mode: SimpleFeedSortMode;
  reel: PhaseCursorState;
  fallback: PhaseCursorState;
  seen: string[];
};

type SeenPass = "strict" | "relax_durable_seen" | "allow_all_seen";

type ReadyDeckEntry = {
  generation: number;
  updatedAtMs: number;
  refillReason: string | null;
  items: SimpleFeedCandidate[];
  refillInFlight: Promise<void> | null;
  lastSummary: Record<string, unknown> | null;
  /** Legacy in-memory decks without this field are discarded (pre–asset-normalize cover-only rows). */
  deckFormat?: number;
};

type RefillDeckSummary = {
  reelReadCount: number;
  fallbackReadCount: number;
  rawReelCandidates: number;
  rawFallbackCandidates: number;
  boundedAttempts: number;
  reelPhaseExhausted: boolean;
};

const readyDeckMemory = new Map<string, ReadyDeckEntry>();
const blockedAuthorsMemory = new Map<string, { expiresAtMs: number; blocked: Set<string> }>();
const servedRecentMemory = new Map<string, { expiresAtMs: number; entries: Map<string, number> }>();

export type FeedForYouSimplePageDebug = {
  source: "firestore_random_simple";
  requestedLimit: number;
  returnedCount: number;
  rawReelCandidates: number;
  rawFallbackCandidates: number;
  filteredBySeen: number;
  filteredByBlockedAuthor: number;
  filteredByMissingMedia: number;
  filteredByInvalidContract: number;
  filteredByViewerOwnPost: number;
  filteredByCursorWindow: number;
  filteredInvisible: number;
  relaxedSeenUsed: boolean;
  fallbackAllPostsUsed: boolean;
  wrapAroundUsed: boolean;
  emergencyFallbackUsed: boolean;
  degradedFallbackUsed: boolean;
  mediaReadyCount: number;
  degradedMediaCount: number;
  missingMediaFilteredCount: number;
  nextCursorPresent: boolean;
  cursorUsed: boolean;
  randomSeedOrAnchor: string;
  durableSeenReadCount: number;
  cursorSeenCount: number;
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
  recycledSeenPosts: boolean;
  reelFirstEnabled: boolean;
  reelCandidateReadCount: number;
  fallbackCandidateReadCount: number;
  reelReturnedCount: number;
  fallbackReturnedCount: number;
  reelPhaseExhausted: boolean;
  candidateReadCount: number;
  dbReads: number;
  queryCount: number;
  elapsedMs?: number;
  deckHit?: boolean;
  deckSource?: "memory" | "firestore" | "cold_refill" | "fallback";
  deckItemsBefore?: number;
  deckItemsReturned?: number;
  deckItemsAfter?: number;
  deckRefillScheduled?: boolean;
  deckRefillReason?: string | null;
  servedRecentFiltered?: number;
  duplicateSuppressed?: number;
  noCursorRequest?: boolean;
  repeatedFromRecentCount?: number;
  firstPaintCardReadyCount?: number;
  detailBatchRequiredForFirstPaint?: boolean;
  durableServedWriteStatus?: "ok" | "skipped" | "error" | "deferred";
  /** First two items playback-readiness tally (videos use feed-selected URLs). */
  firstPaintPlaybackReadyCount?: number;
  firstVisiblePlaybackUrlPresent?: boolean;
  firstVisiblePosterPresent?: boolean;
  /** Canonical variant bucket when first item is video; null otherwise. */
  firstVisibleVariant?: string | null;
  firstVisibleNeedsDetailBeforePlay?: boolean;
  /** True when a full deck was soft-blocked by served-recent and we refilled without that ring in sessionSeen. */
  deckStarvationRefillUsed?: boolean;
  /** Picks that were only eligible after relaxing the short-term served-recent ring (still excludes durable feedSeen). */
  softServedRecentPicks?: number;
  coldRefillReason?: string | null;
  staleDeckServed?: boolean;
  refillDeferred?: boolean;
  candidateQueryCount?: number;
  payloadTrimMode?: string;
};

export class FeedForYouSimpleService {
  constructor(
    private readonly repository: Pick<
      FeedForYouSimpleRepository,
      | "isEnabled"
      | "resolveSortMode"
      | "fetchBatch"
      | "listRecentSeenPostIdsForViewer"
      | "markPostsServedForViewer"
      | "readServedRecentForViewer"
      | "markPostsServedRecentForViewer"
      | "readReadyDeck"
      | "writeReadyDeck"
      | "fetchEmergencyPlayableSlice"
      | "loadBlockedAuthorIdsForViewer"
      | "fetchCandidatesByPostIds"
    >
  ) {}

  async getPage(input: {
    viewerId: string | null;
    limit: number;
    cursor: string | null;
    refresh?: boolean;
  }): Promise<{
    routeName: "feed.for_you_simple.get";
    items: FeedCardDTO[];
    nextCursor: string | null;
    exhausted: boolean;
    emptyReason: null | "no_playable_posts";
    degradedFallbackUsed: boolean;
    relaxedSeenUsed: boolean;
    wrapAroundUsed: boolean;
    fallbackAllPostsUsed: boolean;
    emergencyFallbackUsed: boolean;
    debug: FeedForYouSimplePageDebug;
  }> {
    const requestStartedAt = Date.now();
    if (!this.repository.isEnabled()) {
      throw new Error("feed_for_you_simple_source_unavailable");
    }

    const limit = clampLimit(input.limit);
    const viewerId = input.viewerId?.trim() ?? "";
    const durableViewerId = isDurableViewerId(viewerId) ? viewerId : "";

    const diag = emptyDiagnostics(limit);
    diag.cursorUsed = Boolean(input.cursor) && !input.refresh;
    const noCursorRequest = !input.cursor || input.refresh === true;

    const cursorState = input.refresh ? null : decodeCursor(input.cursor);
    const mode = cursorState?.mode ?? (await this.repository.resolveSortMode());
    const cursorSeen = new Set((cursorState?.seen ?? []).filter(Boolean).slice(-MAX_SEEN_IDS));
    const debugFixedIdsEnabled = process.env[FOR_YOU_SIMPLE_DEBUG_FIXED_IDS_FLAG] === "1";
    if (debugFixedIdsEnabled) {
      const debugCandidates = await this.repository.fetchCandidatesByPostIds([...FOR_YOU_SIMPLE_DEBUG_FIXED_ID_LIST]);
      const debugItems = debugCandidates.filter((candidate) => !cursorSeen.has(candidate.postId)).slice(0, limit);
      const returnedIds = debugItems.map((item) => item.postId);
      const nextCursor =
        debugItems.length === 0
          ? null
          : encodeCursor({
              v: 2,
              mode,
              reel: createPhaseState(mode),
              fallback: createPhaseState(mode),
              seen: [...new Set([...cursorSeen, ...returnedIds])].slice(-MAX_SEEN_IDS)
            });
      const diag = emptyDiagnostics(limit);
      diag.returnedCount = debugItems.length;
      diag.nextCursorPresent = Boolean(nextCursor);
      diag.cursorUsed = Boolean(input.cursor) && !input.refresh;
      diag.noCursorRequest = !input.cursor || input.refresh === true;
      diag.randomSeedOrAnchor = "debug_fixed_ids";
      diag.firstPaintCardReadyCount = debugItems.length;
      applyFirstPaintPlaybackDiagnostics(debugItems, diag);
      const cards = debugItems.map((candidate, index) => toPostCard(candidate, index, viewerId));
      const cardRecords = cards.map((row) => ({ ...row }) as Record<string, unknown>);
      return {
        routeName: "feed.for_you_simple.get",
        items: cardRecords as FeedCardDTO[],
        nextCursor,
        exhausted: debugItems.length === 0,
        emptyReason: debugItems.length === 0 ? "no_playable_posts" : null,
        degradedFallbackUsed: false,
        relaxedSeenUsed: false,
        wrapAroundUsed: false,
        fallbackAllPostsUsed: false,
        emergencyFallbackUsed: false,
        debug: diag
      };
    }

    const blockedAuthorsCached = durableViewerId ? blockedAuthorsMemory.get(durableViewerId) ?? null : null;
    const servedRecentCacheKey = durableViewerId ? `${durableViewerId}_${FOR_YOU_SIMPLE_SURFACE}` : "";
    const servedRecentCached = servedRecentCacheKey ? readServedRecentMemory(servedRecentCacheKey) : null;
    const blockedAuthorsPromise =
      durableViewerId && blockedAuthorsCached && blockedAuthorsCached.expiresAtMs > Date.now()
        ? Promise.resolve({ blocked: new Set(blockedAuthorsCached.blocked), readCount: 0 })
        : durableViewerId
          ? this.repository.loadBlockedAuthorIdsForViewer(durableViewerId)
          : Promise.resolve({ blocked: new Set<string>(), readCount: 0 });
    const initialContextStartedAt = Date.now();
    const [{ blocked: blockedAuthors, readCount: blockedReads }, durableSeen, servedRecent] = await Promise.all([
      blockedAuthorsPromise,
      Promise.resolve({ postIds: new Set<string>(), readCount: 0 }),
      servedRecentCached
        ? Promise.resolve(servedRecentCached)
        : durableViewerId
        ? this.repository.readServedRecentForViewer({
            viewerId: durableViewerId,
            surface: FOR_YOU_SIMPLE_SURFACE,
            limit: SERVED_RECENT_MAX_IDS,
            ttlMs: SERVED_RECENT_TTL_MS
          })
        : Promise.resolve({ postIds: new Set<string>(), readCount: 0 })
    ]);
    accumulateSurfaceTiming("feed_simple_stage_initial_context_ms", Date.now() - initialContextStartedAt);
    if (servedRecentCacheKey) {
      seedServedRecentMemory(servedRecentCacheKey, servedRecent.postIds);
    }
    if (durableViewerId && (!blockedAuthorsCached || blockedAuthorsCached.expiresAtMs <= Date.now())) {
      blockedAuthorsMemory.set(durableViewerId, {
        blocked: new Set(blockedAuthors),
        expiresAtMs: Date.now() + BLOCKED_AUTHORS_CACHE_TTL_MS
      });
    }
    diag.durableSeenReadCount = durableSeen.readCount + blockedReads + servedRecent.readCount;
    diag.cursorSeenCount = cursorSeen.size;
    const effectiveDurableSeen = new Set<string>([...durableSeen.postIds, ...servedRecent.postIds]);

    const deckKey = `${durableViewerId || "anon"}_${FOR_YOU_SIMPLE_SURFACE}`;
    let deck = readyDeckMemory.get(deckKey) ?? null;
    if (deck && deck.deckFormat !== 2) {
      readyDeckMemory.delete(deckKey);
      deck = null;
    }
    let deckSource: "memory" | "firestore" | "cold_refill" | "fallback" = deck ? "memory" : "fallback";
    const allowPersistedReadyDeckRead = process.env.FEED_READY_DECK_PERSISTED_READ !== "0";
    const shouldTryPersistedReadyDeck =
      allowPersistedReadyDeckRead &&
      durableViewerId &&
      input.refresh !== true &&
      (!deck || deck.items.length < Math.max(limit, READY_DECK_MIN_REFILL_THRESHOLD));
    if (shouldTryPersistedReadyDeck) {
      const persisted = await this.repository.readReadyDeck(durableViewerId, FOR_YOU_SIMPLE_SURFACE);
      if (persisted && persisted.items.length > 0) {
        if (!deck || deck.items.length === 0) {
          deck = {
            generation: persisted.generation,
            updatedAtMs: persisted.updatedAtMs,
            refillReason: persisted.refillReason,
            items: persisted.items,
            refillInFlight: null,
            lastSummary: null,
            deckFormat: 2
          };
        } else {
          deck.items = mergeUniqueDeckItems(deck.items, persisted.items);
          deck.updatedAtMs = Math.max(deck.updatedAtMs, persisted.updatedAtMs);
          deck.generation = Math.max(deck.generation, persisted.generation);
          deck.refillReason = deck.refillReason ?? persisted.refillReason;
          deck.deckFormat = 2;
        }
        readyDeckMemory.set(deckKey, deck);
        deckSource = persisted.expiresAtMs > Date.now() ? "firestore" : "fallback";
        diag.staleDeckServed = persisted.expiresAtMs <= Date.now();
      }
    }
    if (!deck) {
      deck = {
        generation: 1,
        updatedAtMs: 0,
        refillReason: "cold_start",
        items: [],
        refillInFlight: null,
        lastSummary: null,
        deckFormat: 2
      };
      readyDeckMemory.set(deckKey, deck);
      deckSource = "cold_refill";
      diag.coldRefillReason = "missing_memory_and_persisted";
    }
    const deckItemsBefore = deck.items.length;

    if (deck.items.length < limit) {
      const refillStartedAt = Date.now();
      const refillSummary = await this.refillDeck({
        deckKey,
        deck,
        viewerId,
        durableViewerId,
        mode,
        blockedAuthors,
        durableSeen: effectiveDurableSeen,
        servedRecent: servedRecent.postIds,
        reason: deck.items.length === 0 ? "cold_refill" : "low_deck"
      });
      accumulateSurfaceTiming("feed_simple_stage_refill_ms", Date.now() - refillStartedAt);
      diag.reelCandidateReadCount += refillSummary.reelReadCount;
      diag.fallbackCandidateReadCount += refillSummary.fallbackReadCount;
      diag.rawReelCandidates += refillSummary.rawReelCandidates;
      diag.rawFallbackCandidates += refillSummary.rawFallbackCandidates;
      diag.boundedAttempts += refillSummary.boundedAttempts;
      diag.candidateReadCount += refillSummary.reelReadCount + refillSummary.fallbackReadCount;
      diag.reelPhaseExhausted = refillSummary.reelPhaseExhausted;
    }

    const pickStartedAt = Date.now();
    const items: SimpleFeedCandidate[] = [];
    const selectedIds = new Set<string>();
    const localServedRecentFiltered = new Set<string>();
    pickFromDeckForPage({
      deck,
      limit,
      items,
      selectedIds,
      servedRecent: servedRecent.postIds,
      durableSeen: effectiveDurableSeen,
      cursorSeen,
      blockedAuthors,
      viewerId,
      pickMode: "strict_ring_and_durable",
      diag,
      localServedRecentFiltered
    });
    accumulateSurfaceTiming("feed_simple_stage_pick_ms", Date.now() - pickStartedAt);

    deck.items = deck.items.filter((candidate) => !selectedIds.has(candidate.postId));

    let emergencyFallbackUsed = false;
    let emergencySliceItems: SimpleFeedCandidate[] = [];
    if (items.length < limit) {
      const emergencyStartedAt = Date.now();
      const emerg = await this.repository.fetchEmergencyPlayableSlice({ limit: Math.min(10, limit + 4) });
      emergencySliceItems = emerg.items;
      accumulateSliceStats(emerg.stats, diag);
      const countBeforeEmerg = items.length;
      for (const candidate of emerg.items) {
        if (items.length >= limit) break;
        if (selectedIds.has(candidate.postId)) continue;
        if (effectiveDurableSeen.has(candidate.postId)) continue;
        if (servedRecent.postIds.has(candidate.postId)) continue;
        if (blockedAuthors.has(candidate.authorId)) continue;
        if (viewerId && candidate.authorId === viewerId) continue;
        selectedIds.add(candidate.postId);
        items.push(candidate);
        updateMediaDiagnostics(candidate, diag);
      }
      emergencyFallbackUsed = items.length > countBeforeEmerg;
      accumulateSurfaceTiming("feed_simple_stage_emergency_slice_ms", Date.now() - emergencyStartedAt);
    }

    let softServedRecentPicks = 0;
    if (items.length < limit && durableViewerId) {
      const starvationStartedAt = Date.now();
      diag.deckStarvationRefillUsed = true;
      deck.items = deck.items.filter((c) => !servedRecent.postIds.has(c.postId));
      const refillSummary = await this.refillDeck({
        deckKey,
        deck,
        viewerId,
        durableViewerId,
        mode,
        blockedAuthors,
        durableSeen: effectiveDurableSeen,
        servedRecent: servedRecent.postIds,
        reason: "starvation_refill",
        omitServedRecentFromSessionSeen: true
      });
      diag.reelCandidateReadCount += refillSummary.reelReadCount;
      diag.fallbackCandidateReadCount += refillSummary.fallbackReadCount;
      diag.rawReelCandidates += refillSummary.rawReelCandidates;
      diag.rawFallbackCandidates += refillSummary.rawFallbackCandidates;
      diag.boundedAttempts += refillSummary.boundedAttempts;
      diag.candidateReadCount += refillSummary.reelReadCount + refillSummary.fallbackReadCount;
      diag.reelPhaseExhausted = diag.reelPhaseExhausted || refillSummary.reelPhaseExhausted;
      pickFromDeckForPage({
        deck,
        limit,
        items,
        selectedIds,
        servedRecent: servedRecent.postIds,
        durableSeen: effectiveDurableSeen,
        cursorSeen,
        blockedAuthors,
        viewerId,
        pickMode: "strict_ring_and_durable",
        diag,
        localServedRecentFiltered
      });
      deck.items = deck.items.filter((candidate) => !selectedIds.has(candidate.postId));
      softServedRecentPicks += pickFromDeckForPage({
        deck,
        limit,
        items,
        selectedIds,
        servedRecent: servedRecent.postIds,
        durableSeen: effectiveDurableSeen,
        cursorSeen,
        blockedAuthors,
        viewerId,
        pickMode: "durable_gate_only",
        diag,
        localServedRecentFiltered: undefined
      });
      deck.items = deck.items.filter((candidate) => !selectedIds.has(candidate.postId));
      const beforeRelaxedEmerg = items.length;
      for (const candidate of emergencySliceItems) {
        if (items.length >= limit) break;
        if (selectedIds.has(candidate.postId)) continue;
        if (effectiveDurableSeen.has(candidate.postId)) continue;
        if (cursorSeen.has(candidate.postId)) {
          diag.cursorSeenFilteredCount += 1;
          continue;
        }
        if (blockedAuthors.has(candidate.authorId)) continue;
        if (viewerId && candidate.authorId === viewerId) continue;
        if (servedRecent.postIds.has(candidate.postId)) softServedRecentPicks += 1;
        selectedIds.add(candidate.postId);
        items.push(candidate);
        updateMediaDiagnostics(candidate, diag);
      }
      if (items.length > beforeRelaxedEmerg) emergencyFallbackUsed = true;
      deck.items = deck.items.filter((candidate) => !selectedIds.has(candidate.postId));
      accumulateSurfaceTiming("feed_simple_stage_starvation_refill_ms", Date.now() - starvationStartedAt);
    }
    diag.softServedRecentPicks = softServedRecentPicks;
    if (!diag.deckStarvationRefillUsed) diag.deckStarvationRefillUsed = false;

    const servedRecentFilteredCount = localServedRecentFiltered.size;
    const finalItems = debugFixedIdsEnabled
      ? items.filter((candidate) => FOR_YOU_SIMPLE_DEBUG_FIXED_IDS.has(candidate.postId))
      : items;

    const returnedIds = finalItems.map((c) => c.postId);
    let seenWriteAttempted = false;
    let seenWriteSucceeded = false;
    let blockingResponseWrites = 0;
    let deferredWritesQueued = 0;
    const readOnlyAuditMode = isReadOnlyLatencyAuditEnabled();
    if (servedRecentCacheKey && returnedIds.length > 0) {
      mergeServedRecentMemory(servedRecentCacheKey, returnedIds);
    }
    if (durableViewerId && returnedIds.length > 0 && !readOnlyAuditMode) {
      seenWriteAttempted = true;
      deferredWritesQueued = 1;
      setTimeout(() => {
        void (async () => {
          try {
            await this.repository.markPostsServedRecentForViewer({
              viewerId: durableViewerId,
              surface: FOR_YOU_SIMPLE_SURFACE,
              postIds: returnedIds,
              maxEntries: SERVED_RECENT_MAX_IDS,
              ttlMs: SERVED_RECENT_TTL_MS
            });
          } catch {
            // Best effort deferred ledger update; request path intentionally stays unblocked.
          }
        })();
      }, 0);
      seenWriteSucceeded = true;
    }
    if (deck.items.length < READY_DECK_MIN_REFILL_THRESHOLD && !deck.refillInFlight) {
      deck.refillInFlight = Promise.resolve();
      diag.refillDeferred = true;
      setTimeout(() => {
        const refillPromise = this.refillDeck({
          deckKey,
          deck,
          viewerId,
          durableViewerId,
          mode,
          blockedAuthors,
          durableSeen: effectiveDurableSeen,
          servedRecent: servedRecent.postIds,
          reason: "post_serve_low_watermark"
        })
          .then(() => undefined)
          .finally(() => {
            if (deck) deck.refillInFlight = null;
          });
        deck.refillInFlight = refillPromise;
      }, 0);
    }

    const emptyReason: null | "no_playable_posts" = finalItems.length === 0 ? "no_playable_posts" : null;
    const exhausted = finalItems.length === 0;

    const nextCursor =
      finalItems.length === 0
        ? null
        : encodeCursor({
            v: 2,
            mode,
            reel: createPhaseState(mode),
            fallback: createPhaseState(mode),
            seen: [...new Set([...cursorSeen, ...returnedIds])].slice(-MAX_SEEN_IDS)
          });

    diag.returnedCount = finalItems.length;
    diag.nextCursorPresent = Boolean(nextCursor);
    diag.randomSeedOrAnchor = `deck:${deck.generation}`;
    diag.seenWriteAttempted = seenWriteAttempted;
    diag.seenWriteSucceeded = seenWriteSucceeded;
    diag.blockingResponseWrites = blockingResponseWrites;
    diag.deferredWritesQueued = deferredWritesQueued;
    diag.deferredWriterFlushAttempts = 0;
    diag.deferredWriterSucceededFlushes = 0;
    diag.deferredWriterFailedFlushes = 0;
    diag.exhaustedUnseenCandidates = finalItems.length < limit && !exhausted;
    diag.reelFirstEnabled = true;
    diag.candidateQueryCount = Math.ceil((diag.candidateReadCount ?? 0) / BATCH_PAGE_SIZE);
    diag.payloadTrimMode = "compact_assets_visible_only";
    diag.degradedFallbackUsed = emergencyFallbackUsed && diag.degradedMediaCount > 0;
    diag.filteredBySeen += servedRecentFilteredCount;
    diag.durableSeenFilteredCount += servedRecentFilteredCount;
    diag.relaxedSeenUsed = softServedRecentPicks > 0;
    diag.wrapAroundUsed = false;
    diag.fallbackAllPostsUsed = emergencyFallbackUsed || String(deck.refillReason ?? "").includes("fallback");
    diag.emergencyFallbackUsed = emergencyFallbackUsed;
    diag.deckHit = deckItemsBefore > 0;
    diag.deckSource = deckSource;
    diag.deckItemsBefore = deckItemsBefore;
    diag.deckItemsReturned = finalItems.length;
    diag.deckItemsAfter = deck.items.length;
    diag.deckRefillScheduled = Boolean(deck.refillInFlight);
    diag.deckRefillReason = deck.refillReason;
    diag.servedRecentFiltered = servedRecentFilteredCount;
    diag.duplicateSuppressed = diag.duplicateFilteredCount;
    diag.noCursorRequest = noCursorRequest;
    diag.repeatedFromRecentCount = servedRecentFilteredCount;
    diag.firstPaintCardReadyCount = finalItems.length;
    diag.detailBatchRequiredForFirstPaint = false;
    applyFirstPaintPlaybackDiagnostics(finalItems, diag);
    diag.durableServedWriteStatus = seenWriteAttempted ? (deferredWritesQueued > 0 ? "deferred" : seenWriteSucceeded ? "ok" : "error") : "skipped";
    const reelCount = finalItems.filter((item) => item.reel).length;
    diag.reelReturnedCount = reelCount;
    diag.fallbackReturnedCount = Math.max(0, finalItems.length - reelCount);
    diag.recycledSeenPosts = softServedRecentPicks > 0;
    const cards = finalItems.map((candidate, index) => toPostCard(candidate, index, viewerId));
    const cardRecords = cards.map((row) => ({ ...row }) as Record<string, unknown>);
    accumulateSurfaceTiming("feed_simple_stage_total_ms", Date.now() - requestStartedAt);

    return {
      routeName: "feed.for_you_simple.get",
      items: cardRecords as FeedCardDTO[],
      nextCursor,
      exhausted,
      emptyReason,
      degradedFallbackUsed: diag.degradedFallbackUsed,
      relaxedSeenUsed: diag.relaxedSeenUsed,
      wrapAroundUsed: false,
      fallbackAllPostsUsed: diag.fallbackAllPostsUsed,
      emergencyFallbackUsed,
      debug: diag
    };
  }

  private async refillDeck(input: {
    deckKey: string;
    deck: ReadyDeckEntry;
    viewerId: string;
    durableViewerId: string;
    mode: SimpleFeedSortMode;
    blockedAuthors: Set<string>;
    durableSeen: Set<string>;
    servedRecent: Set<string>;
    reason: string;
    /**
     * When true, Firestore scan may re-admit post IDs still in the short-term served-recent ring
     * (they remain blocked at serve time until soft pass). Used to break "full deck of soft duplicates".
     */
    omitServedRecentFromSessionSeen?: boolean;
  }): Promise<RefillDeckSummary> {
    const items: SimpleFeedCandidate[] = [];
    const sessionSeen = new Set<string>([
      ...input.deck.items.map((item) => item.postId),
      ...input.durableSeen,
      ...(input.omitServedRecentFromSessionSeen ? [] : input.servedRecent)
    ]);
    const reelPhaseState = createPhaseState(input.mode);
    const fallbackPhaseState = createPhaseState(input.mode);
    const tryGate = (candidate: SimpleFeedCandidate): boolean => {
      if (sessionSeen.has(candidate.postId)) return false;
      if (input.blockedAuthors.has(candidate.authorId)) return false;
      if (input.viewerId && candidate.authorId === input.viewerId) return false;
      sessionSeen.add(candidate.postId);
      return true;
    };
    const reel = await scanPhase({
      repository: this.repository,
      reelOnly: true,
      limit: READY_DECK_TARGET_SIZE,
      mode: input.mode,
      phaseState: reelPhaseState,
      pass: "strict",
      tryGate: (candidate) => tryGate(candidate),
      items,
      sessionSeen,
      onCandidate: () => undefined,
      maxReads: MAX_MAIN_READ_BUDGET
    });
    let usedFallbackScan = false;
    let fallbackSummary:
      | Awaited<ReturnType<typeof scanPhase>>
      | null = null;
    if (items.length < READY_DECK_TARGET_SIZE) {
      usedFallbackScan = true;
      fallbackSummary = await scanPhase({
        repository: this.repository,
        reelOnly: false,
        limit: READY_DECK_TARGET_SIZE,
        mode: input.mode,
        phaseState: fallbackPhaseState,
        pass: "strict",
        tryGate: (candidate) => tryGate(candidate),
        items,
        sessionSeen,
        onCandidate: () => undefined,
        maxReads: Math.max(12, MAX_MAIN_READ_BUDGET - reel.readCount)
      });
    }
    input.deck.items = [...input.deck.items, ...items].slice(0, 60);
    input.deck.updatedAtMs = Date.now();
    input.deck.generation += 1;
    input.deck.refillReason = usedFallbackScan ? `${input.reason}:fallback` : input.reason;
    input.deck.deckFormat = 2;
    readyDeckMemory.set(input.deckKey, input.deck);
    if (input.durableViewerId && !isReadOnlyLatencyAuditEnabled()) {
      const persist: SimpleReadyDeckDoc = {
        viewerId: input.durableViewerId,
        surface: FOR_YOU_SIMPLE_SURFACE,
        generation: input.deck.generation,
        updatedAtMs: input.deck.updatedAtMs,
        expiresAtMs: Date.now() + READY_DECK_TTL_MS,
        refillReason: input.reason,
        items: input.deck.items
      };
      setTimeout(() => {
        void this.repository.writeReadyDeck(persist).catch(() => undefined);
      }, 0);
    }
    return {
      reelReadCount: reel.readCount,
      fallbackReadCount: fallbackSummary?.readCount ?? 0,
      rawReelCandidates: reel.rawTotal,
      rawFallbackCandidates: fallbackSummary?.rawTotal ?? 0,
      boundedAttempts: reel.attempts + (fallbackSummary?.attempts ?? 0),
      reelPhaseExhausted: reel.exhausted,
    };
  }
}

async function scanPhase(input: {
  repository: Pick<FeedForYouSimpleRepository, "fetchBatch">;
  reelOnly: boolean;
  limit: number;
  mode: SimpleFeedSortMode;
  phaseState: PhaseCursorState;
  pass: SeenPass;
  tryGate: (candidate: SimpleFeedCandidate, pass: SeenPass) => boolean;
  items: SimpleFeedCandidate[];
  sessionSeen: Set<string>;
  onCandidate: (candidate: SimpleFeedCandidate) => void;
  maxReads: number;
}): Promise<{
  phaseState: PhaseCursorState;
  readCount: number;
  rawTotal: number;
  acceptedDelta: number;
  exhausted: boolean;
  attempts: number;
  wrapUsed: boolean;
  sliceStats: import("../../repositories/surfaces/feed-for-you-simple.repository.js").SimpleFeedBatchSliceStats[];
}> {
  let state = { ...input.phaseState };
  let readCount = 0;
  let rawTotal = 0;
  let acceptedDelta = 0;
  let exhausted = false;
  let attempts = 0;
  let wrapUsed = false;
  const sliceStats: import("../../repositories/surfaces/feed-for-you-simple.repository.js").SimpleFeedBatchSliceStats[] = [];

  while (input.items.length < input.limit && readCount < input.maxReads && attempts < MAX_SCAN_ATTEMPTS) {
    const beforeLen = input.items.length;
    const batch = await input.repository.fetchBatch({
      mode: input.mode,
      anchor: state.anchor,
      wrapped: state.wrapped,
      lastValue: state.lastValue,
      lastPostId: state.lastPostId,
      limit: BATCH_PAGE_SIZE,
      reelOnly: input.reelOnly
    });
    attempts += 1;
    readCount += batch.readCount;
    rawTotal += batch.stats.rawDocCount;
    sliceStats.push(batch.stats);

    for (const candidate of batch.items) {
      if (input.items.length >= input.limit) break;
      if (!input.tryGate(candidate, input.pass)) continue;
      input.sessionSeen.add(candidate.postId);
      input.items.push(candidate);
      input.onCandidate(candidate);
      acceptedDelta += 1;
      state.lastValue = candidate.sortValue;
      state.lastPostId = candidate.postId;
    }

    if (input.items.length >= input.limit) break;

    const acceptedThisRound = input.items.length - beforeLen;
    if (acceptedThisRound === 0 && batch.rawCount > 0 && batch.tailDocId) {
      if (input.mode === "randomKey" && batch.tailRandomKey != null && Number.isFinite(batch.tailRandomKey)) {
        state.lastValue = batch.tailRandomKey;
        state.lastPostId = batch.tailDocId;
      } else {
        state.lastValue = batch.tailDocId;
        state.lastPostId = batch.tailDocId;
      }
      continue;
    }

    if (batch.segmentExhausted || batch.rawCount === 0) {
      if (!state.wrapped) {
        state.wrapped = true;
        state.lastValue = null;
        state.lastPostId = null;
        wrapUsed = true;
        continue;
      }
      exhausted = true;
      break;
    }
  }

  return { phaseState: state, readCount, rawTotal, acceptedDelta, exhausted, attempts, wrapUsed, sliceStats };
}

function mergeUniqueDeckItems(existing: SimpleFeedCandidate[], incoming: SimpleFeedCandidate[]): SimpleFeedCandidate[] {
  const out = [...existing];
  const seen = new Set(existing.map((item) => item.postId));
  for (const item of incoming) {
    if (seen.has(item.postId)) continue;
    seen.add(item.postId);
    out.push(item);
    if (out.length >= 60) break;
  }
  return out;
}

function readServedRecentMemory(cacheKey: string): { postIds: Set<string>; readCount: number } | null {
  const cached = servedRecentMemory.get(cacheKey);
  if (!cached) return null;
  const now = Date.now();
  if (cached.expiresAtMs <= now) {
    servedRecentMemory.delete(cacheKey);
    return null;
  }
  const filtered = [...cached.entries.entries()]
    .filter(([, servedAtMs]) => now - servedAtMs <= SERVED_RECENT_TTL_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SERVED_RECENT_MAX_IDS);
  cached.entries = new Map(filtered);
  cached.expiresAtMs = now + SERVED_RECENT_CACHE_TTL_MS;
  return { postIds: new Set(filtered.map(([postId]) => postId)), readCount: 0 };
}

function seedServedRecentMemory(cacheKey: string, postIds: Set<string>): void {
  if (postIds.size === 0) return;
  const now = Date.now();
  const entries = new Map<string, number>();
  for (const postId of postIds) {
    entries.set(postId, now);
  }
  servedRecentMemory.set(cacheKey, {
    expiresAtMs: now + SERVED_RECENT_CACHE_TTL_MS,
    entries,
  });
}

function mergeServedRecentMemory(cacheKey: string, postIds: string[]): void {
  const now = Date.now();
  const entries = new Map(servedRecentMemory.get(cacheKey)?.entries ?? []);
  for (const postId of postIds) {
    const trimmed = postId.trim();
    if (!trimmed) continue;
    entries.set(trimmed, now);
  }
  const compact = [...entries.entries()]
    .filter(([, servedAtMs]) => now - servedAtMs <= SERVED_RECENT_TTL_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SERVED_RECENT_MAX_IDS);
  servedRecentMemory.set(cacheKey, {
    expiresAtMs: now + SERVED_RECENT_CACHE_TTL_MS,
    entries: new Map(compact),
  });
}

function emptyDiagnostics(requestedLimit: number): FeedForYouSimplePageDebug {
  return {
    source: "firestore_random_simple",
    requestedLimit,
    returnedCount: 0,
    rawReelCandidates: 0,
    rawFallbackCandidates: 0,
    filteredBySeen: 0,
    filteredByBlockedAuthor: 0,
    filteredByMissingMedia: 0,
    filteredByInvalidContract: 0,
    filteredByViewerOwnPost: 0,
    filteredByCursorWindow: 0,
    filteredInvisible: 0,
    relaxedSeenUsed: false,
    fallbackAllPostsUsed: false,
    wrapAroundUsed: false,
    emergencyFallbackUsed: false,
    degradedFallbackUsed: false,
    mediaReadyCount: 0,
    degradedMediaCount: 0,
    missingMediaFilteredCount: 0,
    nextCursorPresent: false,
    cursorUsed: false,
    randomSeedOrAnchor: "",
    durableSeenReadCount: 0,
    cursorSeenCount: 0,
    duplicateFilteredCount: 0,
    durableSeenFilteredCount: 0,
    cursorSeenFilteredCount: 0,
    seenWriteAttempted: false,
    seenWriteSucceeded: false,
    blockingResponseWrites: 0,
    deferredWritesQueued: 0,
    deferredWriterFlushAttempts: 0,
    deferredWriterSucceededFlushes: 0,
    deferredWriterFailedFlushes: 0,
    boundedAttempts: 0,
    exhaustedUnseenCandidates: false,
    recycledSeenPosts: false,
    reelFirstEnabled: true,
    reelCandidateReadCount: 0,
    fallbackCandidateReadCount: 0,
    reelReturnedCount: 0,
    fallbackReturnedCount: 0,
    reelPhaseExhausted: false,
    candidateReadCount: 0,
    dbReads: 0,
    queryCount: 0
  };
}

function accumulateSliceStats(
  s: import("../../repositories/surfaces/feed-for-you-simple.repository.js").SimpleFeedBatchSliceStats,
  diag: FeedForYouSimplePageDebug
): void {
  diag.filteredByMissingMedia += s.filteredMissingMedia;
  diag.filteredByInvalidContract += s.filteredInvalidContract + s.filteredInvalidSort;
  diag.missingMediaFilteredCount += s.filteredMissingMedia;
  diag.filteredInvisible += s.filteredInvisible;
}

function isRasterImageUrl(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  return /\.(webp|jpg|jpeg|png)(\?|#|$)/i.test(value.trim());
}

/**
 * "Degraded" = video still depends on raw MP4 for grid/playback surfaces (no real image poster/preview, no HLS).
 * Note: `normalizeAssets` may set `previewUrl` to the same URL as `original`/`mp4`; that is still degraded.
 */
function inferLabeledMp4FromUrl(url: string | null | undefined): Record<string, string> {
  if (!url || typeof url !== "string") return {};
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return {};
  if (/1080.*avc|_1080_avc|1080_avc/i.test(u)) return { main1080Avc: u };
  if (/\/[^/]*1080[^/]*hevc|_1080_hevc|main1080_hevc/i.test(u)) return { main1080: u };
  if (/720.*avc|_720_avc|720_avc/i.test(u)) return { main720Avc: u };
  if (/\/[^/]*720[^/]*hevc|_720_hevc/i.test(u)) return { main720: u };
  return { main720Avc: u };
}

function hasMainishVariant(variants: Record<string, string>): boolean {
  return Boolean(
    variants.main1080Avc ||
      variants.main1080 ||
      variants.main720Avc ||
      variants.main720 ||
      variants.hls ||
      variants.startup1080FaststartAvc ||
      variants.startup720FaststartAvc
  );
}

function simpleCandidateVideoVariants(a0: SimpleFeedCandidate["assets"][number]): Record<string, string> {
  const v: Record<string, string> = { ...(a0.playbackVariantUrls ?? {}) };
  if (a0.streamUrl?.trim()) v.hls = a0.streamUrl.trim();
  const inferred = inferLabeledMp4FromUrl(a0.mp4Url);
  if (!hasMainishVariant(v)) {
    Object.assign(v, inferred);
  } else {
    for (const [k, val] of Object.entries(inferred)) {
      if (v[k] == null) v[k] = val;
    }
  }
  return v;
}

function carouselCompactAssetCap(assetCount: number): number {
  const n = Math.max(1, Math.floor(assetCount || 1));
  return Math.min(12, n);
}

function augmentSimpleFeedVideoPlayback(candidate: SimpleFeedCandidate): {
  playbackUrl?: string;
  playbackUrlPresent?: boolean;
  fallbackVideoUrl?: string;
  mediaStatus?: "processing" | "ready" | "failed";
  assetsReady?: boolean;
  playbackReady?: boolean;
  posterReady?: boolean;
  hasVideo?: boolean;
} {
  if (candidate.mediaType !== "video") return {};
  const a0 = candidate.assets[0];
  if (!a0) return { hasVideo: true };
  const variants = simpleCandidateVideoVariants(a0);
  const postLike: Record<string, unknown> = {
    mediaType: "video",
    assetsReady: candidate.assetsReady === true,
    instantPlaybackReady: candidate.instantPlaybackReady === true,
    ...(candidate.videoProcessingStatus ? { videoProcessingStatus: candidate.videoProcessingStatus } : {}),
    assets: [
      {
        type: "video",
        id: a0.id,
        original: a0.originalUrl,
        ...(Object.keys(variants).length > 0 ? { variants } : {}),
      },
    ],
  };
  const sel = selectBestVideoPlaybackAsset(postLike, { hydrationMode: "playback", allowPreviewOnly: true });
  const posterOk = Boolean(candidate.posterUrl?.trim() || a0.posterUrl?.trim());
  const mediaStatus: "processing" | "ready" | "failed" =
    sel.mediaStatusHint === "failed" ? "failed" : sel.mediaStatusHint === "ready" ? "ready" : "processing";
  return {
    ...(sel.playbackUrl ? { playbackUrl: sel.playbackUrl } : {}),
    playbackUrlPresent: Boolean(sel.playbackUrl),
    ...(sel.fallbackVideoUrl ? { fallbackVideoUrl: sel.fallbackVideoUrl } : {}),
    mediaStatus,
    ...(candidate.assetsReady === true ? { assetsReady: true } : {}),
    playbackReady: Boolean(sel.playbackUrl) || candidate.instantPlaybackReady === true,
    posterReady: posterOk,
    hasVideo: true,
  };
}

function firstVisiblePlaybackSignals(candidate: SimpleFeedCandidate | undefined): {
  ready: boolean;
  playbackUrlPresent: boolean;
  posterPresent: boolean;
  variant: string | null;
  needsDetailBeforePlay: boolean;
} | null {
  if (!candidate) return null;
  const posterOk = Boolean(candidate.posterUrl?.trim() || candidate.assets[0]?.posterUrl?.trim());
  if (candidate.mediaType !== "video") {
    return {
      ready: true,
      playbackUrlPresent: false,
      posterPresent: posterOk,
      variant: null,
      needsDetailBeforePlay: false,
    };
  }
  const aug = augmentSimpleFeedVideoPlayback(candidate);
  const a0 = candidate.assets[0];
  if (!a0) {
    return {
      ready: Boolean(aug.playbackReady),
      playbackUrlPresent: Boolean(aug.playbackUrlPresent),
      posterPresent: posterOk,
      variant: null,
      needsDetailBeforePlay: aug.playbackReady !== true && !aug.playbackUrlPresent,
    };
  }
  const variants = simpleCandidateVideoVariants(a0);
  const postLike: Record<string, unknown> = {
    mediaType: "video",
    assetsReady: candidate.assetsReady === true,
    instantPlaybackReady: candidate.instantPlaybackReady === true,
    ...(candidate.videoProcessingStatus ? { videoProcessingStatus: candidate.videoProcessingStatus } : {}),
    assets: [
      {
        type: "video",
        id: a0.id,
        original: a0.originalUrl,
        ...(Object.keys(variants).length > 0 ? { variants } : {}),
      },
    ],
  };
  const sel = selectBestVideoPlaybackAsset(postLike, { hydrationMode: "playback", allowPreviewOnly: true });
  return {
    ready: Boolean(aug.playbackReady ?? sel.playbackUrl),
    playbackUrlPresent: Boolean(aug.playbackUrlPresent ?? sel.playbackUrl),
    posterPresent: posterOk,
    variant: sel.selectedVideoVariant ?? null,
    needsDetailBeforePlay:
      Boolean(candidate.instantPlaybackReady !== true && sel.isPreviewOnly && !candidate.assetsReady),
  };
}

function applyFirstPaintPlaybackDiagnostics(candidates: SimpleFeedCandidate[], diag: FeedForYouSimplePageDebug): void {
  const slice = candidates.slice(0, 2);
  let readyCount = 0;
  for (const row of slice) {
    const sig = firstVisiblePlaybackSignals(row);
    if (sig?.ready) readyCount += 1;
  }
  diag.firstPaintPlaybackReadyCount = readyCount;
  const head = firstVisiblePlaybackSignals(candidates[0]);
  if (head) {
    diag.firstVisiblePlaybackUrlPresent = head.playbackUrlPresent;
    diag.firstVisiblePosterPresent = head.posterPresent;
    diag.firstVisibleVariant = head.variant;
    diag.firstVisibleNeedsDetailBeforePlay = head.needsDetailBeforePlay;
  }
}

function updateMediaDiagnostics(candidate: SimpleFeedCandidate, diag: FeedForYouSimplePageDebug): void {
  const a = candidate.assets[0];
  if (candidate.mediaType !== "video" || !a) {
    diag.mediaReadyCount += 1;
    return;
  }
  const orig = (a.originalUrl ?? "").trim();
  const mp4 = (a.mp4Url ?? "").trim();
  const prev = (a.previewUrl ?? "").trim();
  const poster = (a.posterUrl ?? "").trim();
  const stream = (a.streamUrl ?? "").trim();
  const hasRasterPreview = isRasterImageUrl(prev) || isRasterImageUrl(poster);
  const degraded =
    Boolean(orig || mp4) &&
    !stream &&
    !hasRasterPreview;
  if (degraded) diag.degradedMediaCount += 1;
  else diag.mediaReadyCount += 1;
}

type DeckPickMode = "strict_ring_and_durable" | "durable_gate_only";

/** Walk the ready deck and append up to `limit` total `items`, mutating `selectedIds`. */
function pickFromDeckForPage(input: {
  deck: ReadyDeckEntry;
  limit: number;
  items: SimpleFeedCandidate[];
  selectedIds: Set<string>;
  servedRecent: Set<string>;
  durableSeen: Set<string>;
  cursorSeen: Set<string>;
  blockedAuthors: Set<string>;
  viewerId: string;
  pickMode: DeckPickMode;
  diag: FeedForYouSimplePageDebug;
  localServedRecentFiltered?: Set<string>;
}): number {
  let softServedRecentPicks = 0;
  for (const candidate of input.deck.items) {
    if (input.items.length >= input.limit) break;
    if (input.durableSeen.has(candidate.postId)) continue;

    const inServedRecent = input.servedRecent.has(candidate.postId);
    if (input.pickMode === "strict_ring_and_durable" && inServedRecent) {
      input.localServedRecentFiltered?.add(candidate.postId);
      continue;
    }

    if (input.cursorSeen.has(candidate.postId)) {
      input.diag.cursorSeenFilteredCount += 1;
      continue;
    }
    if (input.selectedIds.has(candidate.postId)) continue;
    if (input.blockedAuthors.has(candidate.authorId)) continue;
    if (input.viewerId && candidate.authorId === input.viewerId) continue;

    input.selectedIds.add(candidate.postId);
    input.items.push(candidate);
    if (input.pickMode === "durable_gate_only" && inServedRecent) softServedRecentPicks += 1;
    updateMediaDiagnostics(candidate, input.diag);
  }
  return softServedRecentPicks;
}

function clampLimit(raw: number): number {
  const n = Number.isFinite(raw) ? Math.floor(raw) : LIMIT_DEFAULT;
  return Math.max(LIMIT_MIN, Math.min(LIMIT_MAX, n || LIMIT_DEFAULT));
}

function toPostCard(candidate: SimpleFeedCandidate, index: number, viewerId: string): FeedCardDTO {
  const firstCanonicalVideoPlayback = (() => {
    const raw = candidate.rawFirestore;
    if (!raw || typeof raw !== "object") return null;
    const media = (raw.media as { assets?: unknown[] } | undefined)?.assets;
    if (!Array.isArray(media)) return null;
    const videoAsset = media.find((asset) => {
      if (!asset || typeof asset !== "object") return false;
      return (asset as { type?: unknown }).type === "video";
    }) as { id?: unknown; video?: { playback?: Record<string, unknown> } } | undefined;
    if (!videoAsset?.video?.playback) return null;
    const playback = videoAsset.video.playback;
    return {
      assetId: typeof videoAsset.id === "string" ? videoAsset.id : null,
      startupUrl: typeof playback.startupUrl === "string" ? playback.startupUrl : null,
      defaultUrl: typeof playback.defaultUrl === "string" ? playback.defaultUrl : null,
      primaryUrl: typeof playback.primaryUrl === "string" ? playback.primaryUrl : null,
      selectedReason: typeof playback.selectedReason === "string" ? playback.selectedReason : null
    };
  })();
  const sourceLen = candidate.sourceFirestoreAssetArrayLen ?? candidate.assets.length;
  const candidateRecord = candidate as unknown as Record<string, unknown>;
  const shouldPreserveCanonicalAssets =
    sourceLen > 1 ||
    candidateRecord.hasMultipleAssets === true ||
    candidateRecord.mediaCompleteness === "full" ||
    candidateRecord.mediaCompleteness === "complete";
  const visibleAssets = shouldPreserveCanonicalAssets ? candidate.assets : candidate.assets.slice(0, 1);
  const fullCard = toFeedCardDTO({
    postId: candidate.postId,
    sourceRawPost: candidate.rawFirestore ?? null,
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
    assets: visibleAssets,
    compactAssetLimit: carouselCompactAssetCap(visibleAssets.length),
    title: candidate.title,
    captionPreview: candidate.captionPreview,
    firstAssetUrl: candidate.firstAssetUrl,
    canonicalAliasMode: "app_post_v2_only",
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
    updatedAtMs: candidate.updatedAtMs,
    rawFirestoreAssetCount: sourceLen,
    assetCount: sourceLen,
    hasMultipleAssets: sourceLen > 1,
    ...augmentSimpleFeedVideoPlayback(candidate)
  });
  const {
    postContractVersion: _postContractVersion,
    normalizedCard: _normalizedCard,
    normalizedMedia: _normalizedMedia,
    normalizedAuthor: _normalizedAuthor,
    normalizedLocation: _normalizedLocation,
    normalizedCounts: _normalizedCounts,
    mediaResolutionSource: _mediaResolutionSource,
    hasPlayableVideo: _hasPlayableVideo,
    hasAssetsArray: _hasAssetsArray,
    hasRawPost: _hasRawPost,
    hasEmbeddedComments: _hasEmbeddedComments,
    rawPost: _rawPost,
    sourcePost: _sourcePost,
    debugPostEnvelope: _debugPostEnvelope,
    appPostAttached: _appPostAttached,
    appPostWireAssetCount: _appPostWireAssetCount,
    wireDeclaredMediaAssetCount: _wireDeclaredMediaAssetCount,
    ...leanCard
  } = fullCard as FeedCardDTO & Record<string, unknown>;
  const outgoingAppPost = (fullCard.appPost ?? null) as
    | { media?: { assets?: Array<{ id?: unknown; type?: unknown; video?: { playback?: Record<string, unknown> } }> } }
    | null;
  const outgoingPlayback = (() => {
    const assets = Array.isArray(outgoingAppPost?.media?.assets) ? outgoingAppPost?.media?.assets : [];
    const videoAsset = assets.find((asset) => asset?.type === "video");
    const playback = videoAsset?.video?.playback;
    return {
      assetId: typeof videoAsset?.id === "string" ? videoAsset.id : null,
      startupUrl: typeof playback?.startupUrl === "string" ? playback.startupUrl : null,
      defaultUrl: typeof playback?.defaultUrl === "string" ? playback.defaultUrl : null,
      primaryUrl: typeof playback?.primaryUrl === "string" ? playback.primaryUrl : null,
      selectedReason: typeof playback?.selectedReason === "string" ? playback.selectedReason : null
    };
  })();
  const canonicalFaststartPresent = Boolean(
    firstCanonicalVideoPlayback?.startupUrl &&
      /startup(?:540|720|1080)_faststart_avc\.mp4/i.test(firstCanonicalVideoPlayback.startupUrl)
  );
  const outgoingDroppedFaststart = Boolean(
    canonicalFaststartPresent &&
      (!outgoingPlayback.startupUrl ||
        !/startup(?:540|720|1080)_faststart_avc\.mp4/i.test(outgoingPlayback.startupUrl))
  );
  if (LOG_FEED_DEBUG || LOG_VIDEO_DEBUG) {
    const cacheWasStale = Boolean(canonicalFaststartPresent && outgoingDroppedFaststart);
    const refreshedFromCanonical = Boolean(canonicalFaststartPresent && !outgoingDroppedFaststart);
    try {
      debugLog("video", "FEED_WIRE_APPPOST_PLAYBACK_DEBUG", () => ({
          postId: candidate.postId,
          source: candidate.rawFirestore ? "fresh_post_doc" : "post_card_cache",
          canonicalDocStartupUrl: firstCanonicalVideoPlayback?.startupUrl ?? null,
          canonicalDocDefaultUrl: firstCanonicalVideoPlayback?.defaultUrl ?? null,
          canonicalDocPrimaryUrl: firstCanonicalVideoPlayback?.primaryUrl ?? null,
          canonicalDocSelectedReason: firstCanonicalVideoPlayback?.selectedReason ?? null,
          outgoingAppPostStartupUrl: outgoingPlayback.startupUrl,
          outgoingAppPostDefaultUrl: outgoingPlayback.defaultUrl,
          outgoingAppPostPrimaryUrl: outgoingPlayback.primaryUrl,
          outgoingAppPostSelectedReason: outgoingPlayback.selectedReason,
          cacheWasStale,
          refreshedFromCanonical
        }));
      if (outgoingDroppedFaststart) {
        debugLog("video", "FEED_CANONICAL_PLAYBACK_DROPPED_ERROR", () => ({
            postId: candidate.postId,
            canonicalDocStartupUrl: firstCanonicalVideoPlayback?.startupUrl ?? null,
            outgoingAppPostStartupUrl: outgoingPlayback.startupUrl ?? null
          }));
      }
    } catch {
      // no-op
    }
  }
  if (fullCard.appPostV2 && typeof fullCard.appPostV2 === "object") {
    (leanCard as Record<string, unknown>).appPostV2 = fullCard.appPostV2;
    (leanCard as Record<string, unknown>).postContractVersion = 3 as const;
  }
  return leanCard as FeedCardDTO;
}

function encodeCursor(cursor: FeedForYouSimpleCursor): string {
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
}

function decodeCursor(cursor: string | null): FeedForYouSimpleCursor | null {
  if (!cursor) return null;
  const rawPayload = cursor.startsWith(CURSOR_PREFIX)
    ? cursor.slice(CURSOR_PREFIX.length)
    : cursor.startsWith(LEGACY_CURSOR_PREFIX)
      ? cursor.slice(LEGACY_CURSOR_PREFIX.length)
      : null;
  if (rawPayload === null) throw new Error("invalid_simple_feed_cursor");
  try {
    const raw = JSON.parse(Buffer.from(rawPayload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (raw.v === 2) {
      const mode = raw.mode;
      if (mode !== "randomKey" && mode !== "docId") throw new Error("mode");
      const seen = Array.isArray(raw.seen) ? raw.seen.map((value) => String(value)).filter(Boolean).slice(-MAX_SEEN_IDS) : [];
      const reelRaw = (raw.reel as Record<string, unknown> | undefined) ?? null;
      const fallbackRaw = (raw.fallback as Record<string, unknown> | undefined) ?? null;
      if (!reelRaw || !fallbackRaw) throw new Error("phase");
      return {
        v: 2,
        mode,
        reel: normalizePhaseState(mode, reelRaw),
        fallback: normalizePhaseState(mode, fallbackRaw),
        seen
      };
    }
    if (raw.v === 1) {
      const mode = raw.mode;
      if (mode !== "randomKey" && mode !== "docId") throw new Error("mode");
      const seen = Array.isArray(raw.seen) ? raw.seen.map((value) => String(value)).filter(Boolean).slice(-MAX_SEEN_IDS) : [];
      const reelRaw = (raw.reel as Record<string, unknown> | undefined) ?? null;
      const fallbackRaw = (raw.fallback as Record<string, unknown> | undefined) ?? null;
      if (reelRaw && fallbackRaw) {
        return {
          v: 2,
          mode,
          reel: normalizePhaseState(mode, reelRaw),
          fallback: normalizePhaseState(mode, fallbackRaw),
          seen
        };
      }
      const legacyState = normalizeLegacyPhaseState(mode, raw);
      return {
        v: 2,
        mode,
        reel: createPhaseState(mode),
        fallback: legacyState,
        seen
      };
    }
    throw new Error("version");
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

export function getForYouReadyDeckDebug(viewerId: string): {
  key: string;
  generation: number;
  size: number;
  nextItemIds: string[];
  updatedAtMs: number;
  refillReason: string | null;
  hasRefillInFlight: boolean;
} | null {
  const id = viewerId.trim();
  if (!id) return null;
  const key = `${id}_${FOR_YOU_SIMPLE_SURFACE}`;
  const deck = readyDeckMemory.get(key);
  if (!deck) return null;
  return {
    key,
    generation: deck.generation,
    size: deck.items.length,
    nextItemIds: deck.items.slice(0, 10).map((item) => item.postId),
    updatedAtMs: deck.updatedAtMs,
    refillReason: deck.refillReason,
    hasRefillInFlight: Boolean(deck.refillInFlight)
  };
}
