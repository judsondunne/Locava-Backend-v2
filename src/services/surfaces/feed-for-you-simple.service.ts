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
import { geoPrefixesAroundCenter } from "../../lib/geo-prefixes-around-center.js";
import { getPostCoordinates, type PostRecord } from "../../lib/posts/postFieldSelectors.js";
import { isReadOnlyLatencyAuditEnabled } from "../../safety/read-only-latency-audit-guard.js";
import {
  allReelPhasesExhausted,
  appendCursorChainState,
  createFreshCursorV3,
  decodeForYouSimpleCursor,
  encodeForYouSimpleCursor,
  fallbackAllowed,
  FOR_YOU_SIMPLE_MAX_SEEN_IDS,
  FOR_YOU_SIMPLE_SERVE_PHASES,
  getEarliestAllowedPhase,
  normalizeCursorSeenIds,
  repairCursorServingMode,
  repairForYouSimpleCursor,
  repairRadiusScanState,
  type ForYouSimpleCursorV3,
  type ForYouSimpleRadiusScanState,
  type ForYouSimpleServePhase
} from "./feed-for-you-simple-cursor.js";
import { diversifyByAuthor } from "./feed-for-you-simple-author-diversity.js";
import { canonicalizeFeedCandidate, normalizeFeedPostIdFromCandidate } from "./feed-for-you-simple-ids.js";
import {
  FOR_YOU_SIMPLE_DECK_FORMAT,
  FOR_YOU_SIMPLE_PHASE_DECK_TARGET,
  phaseDeckMemoryKey,
  scanServePhase,
  type PhaseReadyDeckEntry
} from "./feed-for-you-simple-phase-runtime.js";
import { pickForYouSimpleReelPoolPage } from "./feed-for-you-simple-reel-pool.js";
import {
  deckKeyForServingMode,
  resolveForYouSimpleServingMode,
  type ForYouSimpleServingMode
} from "./feed-for-you-simple-serving-mode.js";
import { candidateMatchesServePhase, isForYouSimpleReel } from "./feed-for-you-simple-tier.js";

const MAX_SEEN_IDS = FOR_YOU_SIMPLE_MAX_SEEN_IDS;
const SERVED_RECENT_MAX_IDS = 240;
const SERVED_RECENT_TTL_MS = 24 * 60 * 60 * 1000;
const SERVED_RECENT_CACHE_TTL_MS = 60_000;
const READY_DECK_TARGET_SIZE = 12;
const READY_DECK_MIN_REFILL_THRESHOLD = 6;
const READY_DECK_TTL_MS = 30 * 60 * 1000;
const BLOCKED_AUTHORS_CACHE_TTL_MS = 60_000;

/** Hard caps for scroll pagination — prefer partial pages + background refill over deep Firestore scans. */
const PAGINATION_MAX_DB_READS = 25;
const PAGINATION_MAX_QUERIES = 5;
const PAGINATION_REEL_READ_CAP = 12;
const PAGINATION_FALLBACK_READ_CAP = 10;
const PAGINATION_MAX_SCAN_ATTEMPTS = 4;
const RECYCLE_SEEN_WINDOW = 20;

const LIMIT_DEFAULT = 5;
const LIMIT_MIN = 1;
const LIMIT_MAX = 12;
/** Serialized carousel cap for cold For You slim wire payloads (canonical assetCount still preserved separately). */
const FEED_SIMPLE_FIRST_PAINT_WIRE_ASSET_CAP = 8;

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

/**
 * Radius filter applied to candidates (haversine). When `mode === "global"`, no filter is applied
 * and the deck/cursor behave identically to the legacy non-geo path. When `mode !== "global"`,
 * the deck key, cursor, and refill scans all key off these fields so radius-filtered decks never
 * leak into unfiltered requests and pagination preserves the filter.
 */
import type { ForYouRadiusFilter } from "./feed-for-you-simple-cursor.js";
export type { ForYouRadiusFilter } from "./feed-for-you-simple-cursor.js";

const RADIUS_MILES_TO_KM = 1.609344;

function isActiveRadius(filter: ForYouRadiusFilter): boolean {
  return (
    filter.mode !== "global" &&
    typeof filter.centerLat === "number" &&
    Number.isFinite(filter.centerLat) &&
    typeof filter.centerLng === "number" &&
    Number.isFinite(filter.centerLng) &&
    typeof filter.radiusMiles === "number" &&
    Number.isFinite(filter.radiusMiles) &&
    filter.radiusMiles > 0
  );
}

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function candidateMatchesRadius(candidate: SimpleFeedCandidate, filter: ForYouRadiusFilter): boolean {
  if (!isActiveRadius(filter)) return true;
  let lat: number | null = typeof candidate.geo?.lat === "number" && Number.isFinite(candidate.geo.lat) ? candidate.geo.lat : null;
  let lng: number | null = typeof candidate.geo?.long === "number" && Number.isFinite(candidate.geo.long) ? candidate.geo.long : null;
  if (lat == null || lng == null) {
    const raw = candidate.rawFirestore;
    const recovered = raw ? getPostCoordinates(raw as PostRecord) : { lat: null, lng: null };
    lat = recovered.lat;
    lng = recovered.lng;
  }
  if (lat == null || lng == null) return false;
  const km = haversineDistanceKm(filter.centerLat as number, filter.centerLng as number, lat, lng);
  const limitKm = (filter.radiusMiles as number) * RADIUS_MILES_TO_KM;
  return km <= limitKm;
}

function shortHash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return `f${(h >>> 0).toString(36)}`;
}

type FeedForYouSimpleCursor = {
  v: 2;
  mode: SimpleFeedSortMode;
  reel: PhaseCursorState;
  fallback: PhaseCursorState;
  seen: string[];
  filter?: ForYouRadiusFilter;
};

type SeenPass = "strict" | "relax_durable_seen" | "allow_all_seen";

type ReadyDeckEntry = PhaseReadyDeckEntry;

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
  paginationBudgetCapped?: boolean;
  candidateQueryCount?: number;
  payloadTrimMode?: string;
  activePhase?: ForYouSimpleServePhase;
  earliestAllowedPhase?: ForYouSimpleServePhase;
  phaseExhaustedStates?: Record<ForYouSimpleServePhase, boolean>;
  returnedNonReelCount?: number;
  blockedNonReelBeforeReelExhaustionCount?: number;
  servedRecentRelaxed?: boolean;
  servedRecentCount?: number;
  deckPhase?: ForYouSimpleServePhase | null;
  fallbackAllowed?: boolean;
  fallbackUsed?: boolean;
  recycleMode?: boolean;
  cursorSeenBefore?: number;
  cursorSeenAfter?: number;
  duplicateBlockedCount?: number;
  seenSkippedCount?: number;
  servedRecentSkippedCount?: number;
  authorDiversityApplied?: boolean;
  sameAuthorAdjacentCount?: number;
  maxAuthorPageCount?: number;
  recentAuthorIds?: string[];
  continuationSeq?: number;
  /**
   * Radius filter diagnostics. When mode is "global" this records candidateCount/filteredOutCount=0
   * and hasCenter=false; otherwise records the active radius mode + filter stats so we can audit
   * cross-page consistency without leaking PII or raw URLs.
   */
  radiusFilter?: {
    mode: "global" | "nearMe" | "custom";
    radiusMiles: number | null;
    hasCenter: boolean;
    candidateCount: number;
    filteredOutCount: number;
    cursorCarriesFilter: boolean;
    deckKeyHash: string | null;
  };
};

export class FeedForYouSimpleService {
  constructor(
    private readonly repository: Pick<
      FeedForYouSimpleRepository,
      | "isEnabled"
      | "resolveSortMode"
      | "fetchBatch"
      | "fetchServePhaseBatch"
      | "listRecentSeenPostIdsForViewer"
      | "markPostsServedForViewer"
      | "readServedRecentForViewer"
      | "markPostsServedRecentForViewer"
      | "readReadyDeck"
      | "writeReadyDeck"
      | "fetchEmergencyPlayableSlice"
      | "probeGeohashPlayablePostsWithinRadius"
      | "probeRecentPlayablePostsWithinRadius"
      | "loadBlockedAuthorIdsForViewer"
      | "fetchCandidatesByPostIds"
      | "fetchReelPoolBootstrap"
    >
  ) {}

  async getPage(input: {
    viewerId: string | null;
    limit: number;
    cursor: string | null;
    refresh?: boolean;
    /** Radius filter; default "global" preserves legacy behavior. */
    radiusFilter?: ForYouRadiusFilter;
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
    const isPaginationRequest = Boolean(input.cursor) && input.refresh !== true;

    const diag = emptyDiagnostics(limit);
    diag.cursorUsed = Boolean(input.cursor) && !input.refresh;
    const noCursorRequest = !input.cursor || input.refresh === true;

    let cursorState: ForYouSimpleCursorV3 = input.refresh
      ? createFreshCursorV3(await this.repository.resolveSortMode(), input.radiusFilter ?? undefined)
      : input.cursor
        ? (decodeForYouSimpleCursor(input.cursor, (repair) => {
            debugLog("feed", "FOR_YOU_SIMPLE_CURSOR_PHASE_REPAIRED", () => ({
              previousActivePhase: repair.previousActivePhase,
              repairedActivePhase: repair.repairedActivePhase
            }));
          }) ??
            (() => {
              throw new Error("invalid_simple_feed_cursor");
            })())
        : createFreshCursorV3(await this.repository.resolveSortMode(), input.radiusFilter ?? undefined);
    const mode = cursorState.mode;
    const cursorSeenBefore = normalizeCursorSeenIds(cursorState.seen ?? []).length;
    const cursorSeen = new Set(normalizeCursorSeenIds(cursorState.seen ?? []));
    const recentAuthorIds = new Set((cursorState.recentAuthorIds ?? []).filter(Boolean));
    const recycleMode = cursorState.recycleMode === true;
    /**
     * Radius filter resolution priority:
     * 1. Caller input wins (request-fresh state).
     * 2. Cursor-carried filter ensures pagination keeps the same lens after first page.
     * 3. Global default.
     *
     * IMPORTANT: when caller switches filters mid-stream (e.g. 10mi -> global), we honor the
     * caller and silently drop the prior cursor's filter so unfiltered requests do NOT inherit
     * a radius lens from a stale cursor.
     */
    const radiusFilter: ForYouRadiusFilter = (() => {
      const fromInput = input.radiusFilter;
      if (fromInput) return fromInput;
      const fromCursor = cursorState.filter;
      if (fromCursor && fromCursor.mode !== "global") return fromCursor;
      return { mode: "global", centerLat: null, centerLng: null, radiusMiles: null };
    })();
    const filterIsActive = isActiveRadius(radiusFilter);
    const servingMode = resolveForYouSimpleServingMode({ radiusFilter, followingMode: false });
    let repairedCursorMode = false;
    cursorState = repairCursorServingMode(
      cursorState,
      { servingMode, radiusFilter },
      (repair) => {
        repairedCursorMode = true;
        debugLog("feed", "FOR_YOU_SIMPLE_CURSOR_MODE_REPAIRED", () => ({
          previousServingMode: repair.previousServingMode ?? null,
          repairedServingMode: repair.repairedServingMode
        }));
      }
    );
    const reelPhaseMachineEnabled = servingMode === "home_reel_first";
    debugLog("feed", "FOR_YOU_SIMPLE_SERVING_MODE_RESOLVED", () => ({
      servingMode,
      radiusMode: radiusFilter.mode,
      centerLat: radiusFilter.centerLat,
      centerLng: radiusFilter.centerLng,
      radiusMiles: radiusFilter.radiusMiles,
      hasFollowingMode: false,
      deckKey: deckKeyForServingMode(durableViewerId, servingMode, radiusFilter),
      cursorMode: cursorState.servingMode ?? null,
      repairedCursorMode,
      reelPhaseMachineEnabled
    }));
    const debugFixedIdsEnabled = process.env[FOR_YOU_SIMPLE_DEBUG_FIXED_IDS_FLAG] === "1";
    if (debugFixedIdsEnabled) {
      const debugCandidates = await this.repository.fetchCandidatesByPostIds([...FOR_YOU_SIMPLE_DEBUG_FIXED_ID_LIST]);
      const debugItems = debugCandidates.filter((candidate) => !cursorSeen.has(candidate.postId)).slice(0, limit);
      const returnedIds = debugItems.map((item) => item.postId);
      const nextCursor =
        debugItems.length === 0
          ? null
          : encodeForYouSimpleCursor({
              ...createFreshCursorV3(mode),
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
    const shouldReadDurableServedRecent = Boolean(durableViewerId) && isPaginationRequest;
    const [{ blocked: blockedAuthors, readCount: blockedReads }, durableSeen, servedRecent] = await Promise.all([
      blockedAuthorsPromise,
      Promise.resolve({ postIds: new Set<string>(), readCount: 0 }),
      servedRecentCached
        ? Promise.resolve(servedRecentCached)
        : shouldReadDurableServedRecent
          ? this.repository.readServedRecentForViewer({
              viewerId: durableViewerId,
              surface: FOR_YOU_SIMPLE_SURFACE,
              limit: SERVED_RECENT_MAX_IDS,
              ttlMs: SERVED_RECENT_TTL_MS
            })
          : Promise.resolve({ postIds: new Set<string>(), readCount: 0 })
    ]);
    accumulateSurfaceTiming("feed_simple_stage_initial_context_ms", Date.now() - initialContextStartedAt);
    if (servedRecentCacheKey && shouldReadDurableServedRecent && servedRecent.postIds.size > 0) {
      mergeServedRecentMemory(servedRecentCacheKey, [...servedRecent.postIds]);
    }
    const servedRecentResolved = servedRecentCacheKey ? readServedRecentMemory(servedRecentCacheKey) : null;
    const sessionServedRecentIds = servedRecentResolved?.postIds ?? new Set<string>();
    const servedRecentIds = sessionServedRecentIds;
    if (durableViewerId && (!blockedAuthorsCached || blockedAuthorsCached.expiresAtMs <= Date.now())) {
      blockedAuthorsMemory.set(durableViewerId, {
        blocked: new Set(blockedAuthors),
        expiresAtMs: Date.now() + BLOCKED_AUTHORS_CACHE_TTL_MS
      });
    }
    diag.durableSeenReadCount =
      durableSeen.readCount + blockedReads + servedRecent.readCount + (servedRecentResolved?.readCount ?? 0);
    diag.cursorSeenCount = cursorSeen.size;
    const effectiveDurableSeen = new Set<string>([...durableSeen.postIds, ...servedRecentIds]);
    const pickCursorSeen =
      servingMode === "radius_all_posts"
        ? cursorSeen
        : noCursorRequest && !recycleMode
          ? new Set(normalizeCursorSeenIds([...cursorSeen, ...servedRecentIds]))
          : cursorSeen;

    const deckKey = deckKeyForServingMode(durableViewerId, servingMode, radiusFilter);
    if (reelPhaseMachineEnabled && noCursorRequest && effectiveDurableSeen.size > 0) {
      prunePhaseDecksForExclusion(deckKey, effectiveDurableSeen);
    }
    let deckSource: "memory" | "firestore" | "cold_refill" | "fallback" = "cold_refill";
    const deckItemsBefore = FOR_YOU_SIMPLE_SERVE_PHASES.reduce((sum, phase) => {
      const deck = readyDeckMemory.get(phaseDeckMemoryKey(deckKey, phase));
      return sum + (deck?.items.length ?? 0);
    }, 0);
    const pickStartedAt = Date.now();
    const items: SimpleFeedCandidate[] = [];
    const selectedIds = new Set<string>();
    const localServedRecentFiltered = new Set<string>();
    let radiusFilteredOutCount = 0;
    const radiusGate = (candidate: SimpleFeedCandidate): boolean => {
      if (!filterIsActive) return true;
      const ok = candidateMatchesRadius(candidate, radiusFilter);
      if (!ok) radiusFilteredOutCount += 1;
      return ok;
    };
    let workingCursor = repairForYouSimpleCursor(cursorState);
    if (servingMode === "radius_all_posts") {
      const radiusFill = await this.fillRadiusAllPostsPage({
        limit,
        radiusFilter,
        cursor: cursorState,
        viewerId,
        blockedAuthors,
        pickCursorSeen,
        effectiveDurableSeen,
        servedRecentIds,
        radiusGate,
        diag,
        noCursorRequest
      });
      items.push(...radiusFill.items);
      for (const id of radiusFill.selectedIds) selectedIds.add(id);
      workingCursor = radiusFill.cursor;
      deckSource = radiusFill.deckSource;
      accumulateSurfaceTiming("feed_simple_stage_pick_ms", Date.now() - pickStartedAt);
    } else {
      const phaseServe = await this.fillPageFromPhases({
        deckKey,
        deckSourceRef: { value: deckSource },
        cursor: cursorState,
        limit,
        mode,
        viewerId,
        durableViewerId,
        blockedAuthors,
        durableSeen: effectiveDurableSeen,
        servedRecent: servedRecentIds,
        cursorSeen: pickCursorSeen,
        radiusFilter,
        firstPaintTight: noCursorRequest,
        paginationMode: isPaginationRequest,
        radiusGate,
        diag,
        localServedRecentFiltered
      });
      items.push(...phaseServe.items);
      for (const id of phaseServe.selectedIds) selectedIds.add(id);
      deckSource = phaseServe.deckSource;
      accumulateSurfaceTiming("feed_simple_stage_pick_ms", Date.now() - pickStartedAt);

      if (items.length < limit && noCursorRequest && !filterIsActive) {
        const poolStartedAt = Date.now();
        const poolPick = await pickForYouSimpleReelPoolPage({
          repository: this.repository,
          viewerKey: deckKey || durableViewerId || viewerId || "anonymous",
          limit,
          exclude: new Set([...pickCursorSeen, ...selectedIds]),
          blockedAuthors,
          viewerId,
          radiusGate
        });
        for (const candidate of poolPick.items) {
          if (items.length >= limit) break;
          const postId = normalizeFeedPostIdFromCandidate(candidate) ?? candidate.postId;
          if (selectedIds.has(postId)) continue;
          selectedIds.add(postId);
          items.push(candidate);
          updateMediaDiagnostics(candidate, diag);
        }
        if (poolPick.poolUsed) {
          deckSource = deckSource === "cold_refill" ? "memory" : deckSource;
        }
        accumulateSurfaceTiming("feed_simple_stage_reel_pool_ms", Date.now() - poolStartedAt);
      }

      workingCursor = repairForYouSimpleCursor(phaseServe.cursor);
    }
    let emergencyFallbackUsed = false;
    let emergencySliceItems: SimpleFeedCandidate[] = [];
    const ctxBeforeEmergency = getRequestContext();
    const readsBeforeEmergency = ctxBeforeEmergency?.dbOps.reads ?? 0;
    const allowEmergencySlice =
      reelPhaseMachineEnabled &&
      fallbackAllowed(workingCursor) &&
      (!isPaginationRequest || items.length === 0 || readsBeforeEmergency < 12);
    if (reelPhaseMachineEnabled && items.length < limit && allowEmergencySlice) {
      const emergencyStartedAt = Date.now();
      const emerg = await this.repository.fetchEmergencyPlayableSlice({ limit: Math.min(10, limit + 4) });
      emergencySliceItems = emerg.items;
      accumulateSliceStats(emerg.stats, diag);
      const countBeforeEmerg = items.length;
      for (const candidate of emerg.items) {
        if (items.length >= limit) break;
        if (!fallbackAllowed(workingCursor)) break;
        if (selectedIds.has(candidate.postId)) continue;
        if (!recycleMode && pickCursorSeen.has(candidate.postId)) continue;
        if (effectiveDurableSeen.has(candidate.postId)) continue;
        if (servedRecentIds.has(candidate.postId)) continue;
        if (blockedAuthors.has(candidate.authorId)) continue;
        if (viewerId && candidate.authorId === viewerId) continue;
        if (!radiusGate(candidate)) continue;
        selectedIds.add(candidate.postId);
        items.push(candidate);
        updateMediaDiagnostics(candidate, diag);
      }
      emergencyFallbackUsed = items.length > countBeforeEmerg;
      accumulateSurfaceTiming("feed_simple_stage_emergency_slice_ms", Date.now() - emergencyStartedAt);
    }

    let softServedRecentPicks = 0;
    if (reelPhaseMachineEnabled && items.length < limit) {
      const ctxReadsAtStarve = getRequestContext()?.dbOps.reads ?? 0;
      const skipStarvationForFirstPaintReads =
        noCursorRequest && ctxReadsAtStarve > 15 && items.length > 0;
      const skipRelaxedColdStarvation = noCursorRequest;
      if (!skipStarvationForFirstPaintReads && !skipRelaxedColdStarvation) {
        const starvationStartedAt = Date.now();
        diag.deckStarvationRefillUsed = true;
        const relaxed = await this.fillPageFromPhases({
          deckKey,
          deckSourceRef: { value: deckSource },
          cursor: workingCursor,
          limit,
          mode,
          viewerId,
          durableViewerId,
          blockedAuthors,
          durableSeen: durableSeen.postIds,
          servedRecent: servedRecentIds,
          cursorSeen: pickCursorSeen,
          radiusFilter,
          firstPaintTight: false,
          paginationMode: isPaginationRequest,
          radiusGate,
          diag,
          localServedRecentFiltered,
          pickMode: "durable_gate_only",
          omitServedRecentFromSessionSeen: true
        });
        const beforeRelaxed = items.length;
        for (const candidate of relaxed.items) {
          if (items.length >= limit) break;
          if (selectedIds.has(candidate.postId)) continue;
          if (servedRecentIds.has(candidate.postId)) softServedRecentPicks += 1;
          selectedIds.add(candidate.postId);
          items.push(candidate);
        }
        workingCursor = relaxed.cursor;
        deckSource = relaxed.deckSource;
        const beforeRelaxedEmerg = items.length;
        for (const candidate of emergencySliceItems) {
          if (items.length >= limit) break;
          if (!fallbackAllowed(workingCursor)) break;
          if (selectedIds.has(candidate.postId)) continue;
          if (effectiveDurableSeen.has(candidate.postId)) continue;
          if (pickCursorSeen.has(candidate.postId)) {
            diag.cursorSeenFilteredCount += 1;
            continue;
          }
          if (blockedAuthors.has(candidate.authorId)) continue;
          if (viewerId && candidate.authorId === viewerId) continue;
          if (!radiusGate(candidate)) continue;
          if (servedRecentIds.has(candidate.postId)) softServedRecentPicks += 1;
          selectedIds.add(candidate.postId);
          items.push(candidate);
          updateMediaDiagnostics(candidate, diag);
        }
        if (items.length > beforeRelaxedEmerg) emergencyFallbackUsed = true;
        if (items.length > beforeRelaxed) diag.relaxedSeenUsed = true;
        accumulateSurfaceTiming("feed_simple_stage_starvation_refill_ms", Date.now() - starvationStartedAt);
      }
    }
    diag.softServedRecentPicks = softServedRecentPicks;
    if (!diag.deckStarvationRefillUsed) diag.deckStarvationRefillUsed = false;

    workingCursor = repairForYouSimpleCursor(workingCursor);
    const fallbackPermitted = fallbackAllowed(workingCursor);

    const servedRecentFilteredCount = localServedRecentFiltered.size;
    let blockedNonReelBeforeReelExhaustionCount = 0;
    const reelGatedItems: SimpleFeedCandidate[] = [];
    for (const candidate of items.map(canonicalizeFeedCandidate)) {
      if (reelPhaseMachineEnabled && !fallbackPermitted && !isForYouSimpleReel(candidate)) {
        blockedNonReelBeforeReelExhaustionCount += 1;
        debugLog("feed", "FOR_YOU_SIMPLE_NON_REEL_BLOCKED_BEFORE_REEL_EXHAUSTION", () => ({
          postId: candidate.postId,
          activePhase: workingCursor.activePhase
        }));
        continue;
      }
      reelGatedItems.push(candidate);
    }
    const diversified = reelPhaseMachineEnabled
      ? diversifyByAuthor(reelGatedItems, {
          limit,
          lastAuthorId: cursorState.lastAuthorId ?? null,
          recentAuthorIds,
          maxPerAuthorPerPage: 2,
          avoidBackToBack: true
        })
      : {
          items: reelGatedItems,
          authorDiversityApplied: false,
          sameAuthorAdjacentCount: 0,
          maxAuthorPageCount: 0
        };
    const deduped = finalizeUniqueCandidates({
      candidates: diversified.items,
      cursorSeen: pickCursorSeen,
      recycleMode
    });
    diag.authorDiversityApplied = diversified.authorDiversityApplied;
    diag.sameAuthorAdjacentCount = diversified.sameAuthorAdjacentCount;
    diag.maxAuthorPageCount = diversified.maxAuthorPageCount;
    diag.duplicateBlockedCount = deduped.duplicateBlockedCount;
    diag.seenSkippedCount = deduped.seenSkippedCount;
    diag.servedRecentSkippedCount = servedRecentFilteredCount;
    const finalItems = debugFixedIdsEnabled
      ? deduped.items.filter((candidate) => FOR_YOU_SIMPLE_DEBUG_FIXED_IDS.has(candidate.postId))
      : deduped.items;

    const returnedIds = finalItems.map((c) => normalizeFeedPostIdFromCandidate(c) ?? c.postId);
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
      debugLog("feed", "FEED_SEEN_LEDGER_WRITE_INTENTIONAL", () => ({
        reason: "feedServedRecentRing",
        count: returnedIds.length,
        asyncOrBlocking: "async_deferred_setTimeout0",
        surface: FOR_YOU_SIMPLE_SURFACE,
      }));
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
    for (const phase of reelPhaseMachineEnabled ? FOR_YOU_SIMPLE_SERVE_PHASES : []) {
      if (phase === "fallback_normal" && !fallbackPermitted) continue;
      const phaseDeck = this.getOrCreatePhaseDeck(deckKey, phase);
      if (phaseDeck.items.length < READY_DECK_MIN_REFILL_THRESHOLD && !phaseDeck.refillInFlight) {
        phaseDeck.refillInFlight = Promise.resolve();
        diag.refillDeferred = true;
        setTimeout(() => {
          const refillPromise = this.refillPhaseDeck({
            deckKey,
            phase,
            deck: phaseDeck,
            viewerId,
            mode,
            blockedAuthors,
            durableSeen: effectiveDurableSeen,
            servedRecent: servedRecentIds,
            phaseState: workingCursor.phases[phase],
            allPhaseStates: workingCursor.phases,
            reason: "post_serve_low_watermark",
            radiusFilter,
            cursorSeen: pickCursorSeen,
            selectedSet: selectedIds
          })
            .then(() => undefined)
            .finally(() => {
              phaseDeck.refillInFlight = null;
            });
          phaseDeck.refillInFlight = refillPromise;
        }, 0);
      }
    }

    const emptyReason: null | "no_playable_posts" = finalItems.length === 0 ? "no_playable_posts" : null;
    const fullyExhausted =
      servingMode === "radius_all_posts"
        ? workingCursor.radiusScan?.exhausted === true
        : allReelPhasesExhausted(workingCursor.phases) && workingCursor.phases.fallback_normal.exhausted;
    const exhausted = finalItems.length === 0 && fullyExhausted;
    const nextRecycleMode =
      servingMode === "radius_all_posts" ? false : fullyExhausted || workingCursor.recycleMode === true;

    const cursorCarriesFilter = filterIsActive;
    workingCursor = repairForYouSimpleCursor(
      appendCursorChainState(
        {
          ...workingCursor,
          servingMode,
          ...(cursorCarriesFilter ? { filter: radiusFilter } : {})
        },
        {
          returnedIds,
          authorIds: finalItems.map((item) => item.authorId).filter(Boolean),
          recycleMode: nextRecycleMode
        }
      )
    );
    diag.cursorSeenBefore = cursorSeenBefore;
    diag.cursorSeenAfter = workingCursor.seen.length;
    diag.recentAuthorIds = workingCursor.recentAuthorIds ?? [];
    diag.continuationSeq = workingCursor.continuationSeq;
    diag.recycleMode = nextRecycleMode;
    const nextCursor =
      exhausted && finalItems.length === 0
        ? null
        : encodeForYouSimpleCursor(workingCursor);

    diag.returnedCount = finalItems.length;
    diag.nextCursorPresent = Boolean(nextCursor);
    diag.randomSeedOrAnchor = `phase:${workingCursor.activePhase}`;
    diag.seenWriteAttempted = seenWriteAttempted;
    diag.seenWriteSucceeded = seenWriteSucceeded;
    diag.blockingResponseWrites = blockingResponseWrites;
    diag.deferredWritesQueued = deferredWritesQueued;
    diag.deferredWriterFlushAttempts = 0;
    diag.deferredWriterSucceededFlushes = 0;
    diag.deferredWriterFailedFlushes = 0;
    diag.exhaustedUnseenCandidates = finalItems.length < limit && !fullyExhausted;
    if (isPaginationRequest) {
      if (finalItems.length < limit && finalItems.length > 0) {
        diag.refillDeferred = true;
      }
      const ctxEnd = getRequestContext();
      if (ctxEnd) {
        diag.dbReads = ctxEnd.dbOps.reads;
        diag.queryCount = ctxEnd.dbOps.queries;
        if (ctxEnd.dbOps.reads > PAGINATION_MAX_DB_READS || ctxEnd.dbOps.queries > PAGINATION_MAX_QUERIES) {
          diag.paginationBudgetCapped = true;
          diag.refillDeferred = true;
          debugLog("feed", "FEED_PAGINATION_BUDGET_CAPPED", () => ({
            returnedCount: finalItems.length,
            dbReads: ctxEnd.dbOps.reads,
            queryCount: ctxEnd.dbOps.queries,
            requestedLimit: limit,
            cursorPresent: Boolean(input.cursor)
          }));
        }
      }
    } else {
      const ctxEnd = getRequestContext();
      if (ctxEnd) {
        diag.dbReads = ctxEnd.dbOps.reads;
        diag.queryCount = ctxEnd.dbOps.queries;
      }
    }
    diag.reelFirstEnabled = true;
    diag.candidateQueryCount = Math.ceil((diag.candidateReadCount ?? 0) / BATCH_PAGE_SIZE);
    diag.payloadTrimMode = "compact_assets_visible_only";
    diag.degradedFallbackUsed = emergencyFallbackUsed && diag.degradedMediaCount > 0;
    diag.filteredBySeen += servedRecentFilteredCount;
    diag.durableSeenFilteredCount += servedRecentFilteredCount;
    diag.relaxedSeenUsed = softServedRecentPicks > 0;
    diag.wrapAroundUsed = false;
    const returnedReelCount = finalItems.filter((item) => isForYouSimpleReel(item)).length;
    const returnedNonReelCount = Math.max(0, finalItems.length - returnedReelCount);
    const fallbackUsed =
      fallbackPermitted &&
      (emergencyFallbackUsed ||
        workingCursor.activePhase === "fallback_normal" ||
        returnedNonReelCount > 0);
    diag.fallbackAllPostsUsed = fallbackUsed;
    diag.emergencyFallbackUsed = emergencyFallbackUsed;
    diag.activePhase = workingCursor.activePhase;
    diag.earliestAllowedPhase = getEarliestAllowedPhase(workingCursor);
    diag.phaseExhaustedStates = {
      reel_tier_5: workingCursor.phases.reel_tier_5.exhausted,
      reel_tier_4: workingCursor.phases.reel_tier_4.exhausted,
      reel_other: workingCursor.phases.reel_other.exhausted,
      fallback_normal: workingCursor.phases.fallback_normal.exhausted
    };
    diag.returnedNonReelCount = returnedNonReelCount;
    diag.blockedNonReelBeforeReelExhaustionCount = blockedNonReelBeforeReelExhaustionCount;
    diag.servedRecentRelaxed = softServedRecentPicks > 0;
    diag.servedRecentCount = servedRecentIds.size;
    diag.deckPhase = workingCursor.activePhase;
    diag.fallbackAllowed = fallbackPermitted;
    diag.fallbackUsed = fallbackUsed;
    diag.deckHit = deckItemsBefore > 0;
    diag.deckSource = deckSource;
    diag.deckItemsBefore = deckItemsBefore;
    diag.deckItemsReturned = finalItems.length;
    diag.deckItemsAfter = FOR_YOU_SIMPLE_SERVE_PHASES.reduce((sum, phase) => {
      return sum + (this.getOrCreatePhaseDeck(deckKey, phase).items.length ?? 0);
    }, 0);
    diag.deckRefillScheduled = FOR_YOU_SIMPLE_SERVE_PHASES.some(
      (phase) => Boolean(this.getOrCreatePhaseDeck(deckKey, phase).refillInFlight)
    );
    diag.deckRefillReason = workingCursor.activePhase;
    diag.servedRecentFiltered = servedRecentFilteredCount;
    diag.duplicateSuppressed = diag.duplicateFilteredCount;
    diag.noCursorRequest = noCursorRequest;
    diag.repeatedFromRecentCount = servedRecentFilteredCount;
    diag.firstPaintCardReadyCount = finalItems.length;
    diag.detailBatchRequiredForFirstPaint = false;
    applyFirstPaintPlaybackDiagnostics(finalItems, diag);
    diag.durableServedWriteStatus = seenWriteAttempted ? (deferredWritesQueued > 0 ? "deferred" : seenWriteSucceeded ? "ok" : "error") : "skipped";
    diag.reelReturnedCount = returnedReelCount;
    diag.fallbackReturnedCount = returnedNonReelCount;
    diag.recycledSeenPosts = softServedRecentPicks > 0;
    diag.radiusFilter = {
      mode: radiusFilter.mode,
      radiusMiles: filterIsActive ? (radiusFilter.radiusMiles as number) : null,
      hasCenter: filterIsActive,
      candidateCount: finalItems.length + radiusFilteredOutCount,
      filteredOutCount: radiusFilteredOutCount,
      cursorCarriesFilter,
      deckKeyHash: filterIsActive ? shortHash(deckKey) : null
    };
    const cards = finalItems.map((candidate, index) => toPostCard(candidate, index, viewerId));
    const cardRecords = cards.map((row) => ({ ...row }) as Record<string, unknown>);
    accumulateSurfaceTiming("feed_simple_stage_total_ms", Date.now() - requestStartedAt);

    /**
     * FOR_YOU_RADIUS_FILTER_APPLIED is emitted whenever a radius filter was active for this
     * request. Hash-only viewer + deck key (no PII / raw URLs). When mode is "global" no log
     * is emitted (legacy unfiltered path).
     */
    if (filterIsActive) {
      debugLog("feed", "FOR_YOU_RADIUS_FILTER_APPLIED", () => ({
        viewerIdHash: viewerId ? shortHash(viewerId) : null,
        radiusMode: radiusFilter.mode,
        radiusMiles: radiusFilter.radiusMiles,
        hasCenter: true,
        candidateCount: finalItems.length + radiusFilteredOutCount,
        returnedCount: finalItems.length,
        filteredOutCount: radiusFilteredOutCount,
        deckKeyHash: shortHash(deckKey),
        cursorCarriesFilter
      }));
      debugLog("feed", "RADIUS_FEED_FILTER_BREAKDOWN", () => ({
        radiusFilteredOutCount,
        returnedCount: finalItems.length,
        deckItemsAfter: diag.deckItemsAfter
      }));
      debugLog("feed", "RADIUS_FEED_ELIGIBLE_READY", () => ({
        returnedCount: finalItems.length,
        exhausted,
        nextCursorPresent: Boolean(nextCursor)
      }));
    }

    if (readOnlyAuditMode || process.env.NODE_ENV !== "production") {
      debugLog("feed", "FOR_YOU_SIMPLE_PAGE_SELECTION", () => ({
        viewerId: viewerId ? shortHash(viewerId) : null,
        activePhase: workingCursor.activePhase,
        returnedCount: finalItems.length,
        cursorSeenBefore,
        cursorSeenAfter: workingCursor.seen.length,
        duplicateBlockedCount: diag.duplicateBlockedCount ?? 0,
        seenSkippedCount: diag.seenSkippedCount ?? 0,
        servedRecentSkippedCount: diag.servedRecentSkippedCount ?? 0,
        servedRecentRelaxed: diag.servedRecentRelaxed === true,
        authorDiversityApplied: diag.authorDiversityApplied === true,
        sameAuthorAdjacentCount: diag.sameAuthorAdjacentCount ?? 0,
        maxAuthorPageCount: diag.maxAuthorPageCount ?? 0,
        phaseExhaustedStates: diag.phaseExhaustedStates,
        nextCursorPresent: Boolean(nextCursor),
        recycleMode: nextRecycleMode,
        latencyMs: Date.now() - requestStartedAt,
        dbReads: diag.dbReads,
        queryCount: diag.queryCount
      }));
    }

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

  private getOrCreatePhaseDeck(deckKey: string, phase: ForYouSimpleServePhase): ReadyDeckEntry {
    const memoryKey = phaseDeckMemoryKey(deckKey, phase);
    const existing = readyDeckMemory.get(memoryKey);
    if (existing && existing.deckFormat === FOR_YOU_SIMPLE_DECK_FORMAT && existing.phase === phase) {
      return existing;
    }
    const created: ReadyDeckEntry = {
      generation: 1,
      updatedAtMs: 0,
      refillReason: "cold_start",
      items: [],
      refillInFlight: null,
      lastSummary: null,
      deckFormat: FOR_YOU_SIMPLE_DECK_FORMAT,
      phase
    };
    readyDeckMemory.set(memoryKey, created);
    return created;
  }

  private async fillRadiusAllPostsPage(input: {
    limit: number;
    radiusFilter: ForYouRadiusFilter;
    cursor: ForYouSimpleCursorV3;
    viewerId: string;
    blockedAuthors: Set<string>;
    pickCursorSeen: Set<string>;
    effectiveDurableSeen: Set<string>;
    servedRecentIds: Set<string>;
    radiusGate: (candidate: SimpleFeedCandidate) => boolean;
    diag: FeedForYouSimplePageDebug;
    noCursorRequest: boolean;
  }): Promise<{
    items: SimpleFeedCandidate[];
    selectedIds: string[];
    cursor: ForYouSimpleCursorV3;
    deckSource: "cold_refill" | "memory";
  }> {
    const items: SimpleFeedCandidate[] = [];
    const selectedIds: string[] = [];
    let radiusScan = repairRadiusScanState(input.cursor.radiusScan);
    let inventoryProbeCount = 0;
    let rawCandidates = 0;
    let hardFiltered = 0;
    let seenFiltered = 0;
    let blockedAuthorFiltered = 0;
    let scans = 0;
    const centerLat = input.radiusFilter.centerLat as number;
    const centerLng = input.radiusFilter.centerLng as number;
    const radiusMiles = input.radiusFilter.radiusMiles as number;
    const geoPrefixes = await geoPrefixesAroundCenter({ lat: centerLat, lng: centerLng, precision: 5 });
    const maxScans = Math.max(
      input.noCursorRequest ? 12 : 16,
      geoPrefixes.length + (input.noCursorRequest ? 4 : 6)
    );

    const admitCandidate = (candidate: SimpleFeedCandidate): boolean => {
      if (items.length >= input.limit) return false;
      const postId = normalizeFeedPostIdFromCandidate(candidate) ?? candidate.postId;
      if (input.pickCursorSeen.has(postId)) {
        seenFiltered += 1;
        return false;
      }
      if (input.blockedAuthors.has(candidate.authorId)) {
        blockedAuthorFiltered += 1;
        return false;
      }
      if (input.viewerId && candidate.authorId === input.viewerId) {
        hardFiltered += 1;
        return false;
      }
      if (!input.radiusGate(candidate)) {
        hardFiltered += 1;
        return false;
      }
      selectedIds.push(postId);
      items.push(canonicalizeFeedCandidate({ ...candidate, postId }));
      updateMediaDiagnostics(candidate, input.diag);
      return true;
    };

    while (items.length < input.limit && !radiusScan.exhausted && scans < maxScans) {
      if (!radiusScan.recentFinished && radiusScan.phase === "recent") {
        const probe = await this.repository.probeRecentPlayablePostsWithinRadius({
          centerLat,
          centerLng,
          radiusMiles,
          maxDocs: input.noCursorRequest ? 160 : 200,
          afterTimeMs: radiusScan.lastTimeMs,
          afterPostId: radiusScan.lastPostId
        });
        scans += 1;
        inventoryProbeCount += probe.readCount;
        rawCandidates += probe.shapeCounts.totalDocs;
        const recentFinished = probe.readCount === 0 || probe.segmentExhausted;
        radiusScan = {
          ...radiusScan,
          phase: recentFinished ? "geo" : "recent",
          lastTimeMs: probe.tailTimeMs,
          lastPostId: probe.tailPostId,
          recentFinished,
          exhausted: recentFinished && radiusScan.geoFinished
        };
        let admittedThisRound = 0;
        for (const candidate of probe.items) {
          if (admitCandidate(candidate)) admittedThisRound += 1;
          if (items.length >= input.limit) break;
        }
        if (probe.readCount === 0 && recentFinished && radiusScan.geoFinished) break;
        if (items.length >= input.limit) break;
        continue;
      }

      if (!radiusScan.geoFinished) {
        const prefix = geoPrefixes[radiusScan.prefixIdx];
        if (!prefix) {
          radiusScan = {
            ...radiusScan,
            geoFinished: true,
            geoCursor: null,
            exhausted: radiusScan.recentFinished
          };
          continue;
        }
        const probe = await this.repository.probeGeohashPlayablePostsWithinRadius({
          centerLat,
          centerLng,
          radiusMiles,
          prefix,
          limit: Math.max(24, input.limit * 6),
          geoCursor: radiusScan.geoCursor
        });
        scans += 1;
        inventoryProbeCount += probe.readCount;
        rawCandidates += probe.readCount;
        let admittedThisRound = 0;
        for (const candidate of probe.items) {
          if (admitCandidate(candidate)) admittedThisRound += 1;
          if (items.length >= input.limit) break;
        }
        if (probe.prefixHasMore && probe.geoNextCursor) {
          radiusScan = {
            ...radiusScan,
            phase: "geo",
            geoCursor: probe.geoNextCursor,
            exhausted: false
          };
          if (items.length >= input.limit) break;
          continue;
        }
        const nextPrefixIdx = radiusScan.prefixIdx + 1;
        const geoFinished = nextPrefixIdx >= geoPrefixes.length;
        radiusScan = {
          ...radiusScan,
          phase: "geo",
          prefixIdx: nextPrefixIdx,
          geoCursor: null,
          geoFinished,
          exhausted: geoFinished && radiusScan.recentFinished
        };
        if (admittedThisRound === 0 && probe.readCount === 0) continue;
        if (items.length >= input.limit) break;
        continue;
      }

      break;
    }

    radiusScan = repairRadiusScanState(radiusScan);

    if (items.length === 0) {
      debugLog("feed", "RADIUS_FEED_EMPTY_DIAGNOSTIC", () => ({
        centerLat: input.radiusFilter.centerLat,
        centerLng: input.radiusFilter.centerLng,
        radiusMiles: input.radiusFilter.radiusMiles,
        rawCandidates,
        hardFiltered,
        playableFiltered: 0,
        blockedAuthorFiltered,
        seenFiltered,
        returnedCount: 0,
        inventoryProbeCount,
        usedHomeDeck: false,
        usedReelPhaseMachine: false
      }));
    }

    return {
      items,
      selectedIds,
      cursor: {
        ...input.cursor,
        servingMode: "radius_all_posts",
        filter: input.radiusFilter,
        radiusScan
      },
      deckSource: "cold_refill"
    };
  }

  private async fillPageFromPhases(input: {
    deckKey: string;
    deckSourceRef: { value: "memory" | "firestore" | "cold_refill" | "fallback" };
    cursor: ForYouSimpleCursorV3;
    limit: number;
    mode: SimpleFeedSortMode;
    viewerId: string;
    durableViewerId: string;
    blockedAuthors: Set<string>;
    durableSeen: Set<string>;
    servedRecent: Set<string>;
    cursorSeen: Set<string>;
    radiusFilter: ForYouRadiusFilter;
    firstPaintTight: boolean;
    paginationMode: boolean;
    radiusGate: (candidate: SimpleFeedCandidate) => boolean;
    diag: FeedForYouSimplePageDebug;
    localServedRecentFiltered: Set<string>;
    pickMode?: "strict_ring_and_durable" | "durable_gate_only";
    omitServedRecentFromSessionSeen?: boolean;
  }): Promise<{
    items: SimpleFeedCandidate[];
    selectedIds: string[];
    cursor: ForYouSimpleCursorV3;
    deckSource: "memory" | "firestore" | "cold_refill" | "fallback";
  }> {
    const items: SimpleFeedCandidate[] = [];
    const selectedIds: string[] = [];
    const selectedSet = new Set<string>();
    const cursor = repairForYouSimpleCursor({
      ...input.cursor,
      phases: { ...input.cursor.phases }
    });
    let activePhase = getEarliestAllowedPhase(cursor);
    cursor.activePhase = activePhase;
    const paginationMode = input.paginationMode;
    const scanAttemptsCap = paginationMode ? PAGINATION_MAX_SCAN_ATTEMPTS : MAX_SCAN_ATTEMPTS;
    const reelReadCap = paginationMode
      ? PAGINATION_REEL_READ_CAP
      : input.firstPaintTight
        ? 8
        : MAX_MAIN_READ_BUDGET;
    const fallbackReadCap = paginationMode
      ? PAGINATION_FALLBACK_READ_CAP
      : input.firstPaintTight
        ? Math.max(4, 15 - reelReadCap)
        : Math.max(12, MAX_MAIN_READ_BUDGET - reelReadCap);

    const admitCandidate = (
      candidate: SimpleFeedCandidate,
      pickMode: "strict_ring_and_durable" | "durable_gate_only"
    ): boolean => {
      const postId = normalizeFeedPostIdFromCandidate(candidate) ?? candidate.postId;
      if (items.length >= input.limit) return false;
      if (input.durableSeen.has(postId)) return false;
      const inServedRecent = input.servedRecent.has(postId);
      if (pickMode === "strict_ring_and_durable" && inServedRecent) {
        input.localServedRecentFiltered.add(postId);
        return false;
      }
      if (input.cursorSeen.has(postId)) {
        input.diag.cursorSeenFilteredCount += 1;
        return false;
      }
      if (selectedSet.has(postId)) return false;
      if (input.blockedAuthors.has(candidate.authorId)) return false;
      if (input.viewerId && candidate.authorId === input.viewerId) return false;
      if (!input.radiusGate(candidate)) return false;
      selectedSet.add(postId);
      selectedIds.push(postId);
      items.push(canonicalizeFeedCandidate({ ...candidate, postId }));
      updateMediaDiagnostics(candidate, input.diag);
      return true;
    };

    const pickFromPhaseDeck = (phase: ForYouSimpleServePhase, pickMode: "strict_ring_and_durable" | "durable_gate_only") => {
      const deck = this.getOrCreatePhaseDeck(input.deckKey, phase);
      const remaining: SimpleFeedCandidate[] = [];
      for (const candidate of deck.items) {
        const postId = normalizeFeedPostIdFromCandidate(candidate) ?? candidate.postId;
        if (items.length >= input.limit) {
          remaining.push(candidate);
          continue;
        }
        if (!candidateMatchesServePhase(candidate, phase)) {
          continue;
        }
        if (input.cursorSeen.has(postId) || selectedSet.has(postId)) {
          continue;
        }
        if (!admitCandidate(candidate, pickMode)) {
          if (pickMode === "durable_gate_only" || !input.servedRecent.has(postId)) {
            remaining.push(candidate);
          }
          continue;
        }
      }
      deck.items = remaining;
      return deck;
    };

    let phaseIndex = FOR_YOU_SIMPLE_SERVE_PHASES.indexOf(activePhase);
    if (phaseIndex < 0) phaseIndex = 0;
    for (; phaseIndex < FOR_YOU_SIMPLE_SERVE_PHASES.length && items.length < input.limit; ) {
      const phase = FOR_YOU_SIMPLE_SERVE_PHASES[phaseIndex] as ForYouSimpleServePhase;
      if (phase === "fallback_normal" && !fallbackAllowed(cursor)) {
        break;
      }
      activePhase = phase;
      let deck = this.getOrCreatePhaseDeck(input.deckKey, phase);
      if (deck.items.length > 0) {
        input.deckSourceRef.value = "memory";
      }
      const target = Math.min(FOR_YOU_SIMPLE_PHASE_DECK_TARGET, input.limit + 4);
      if (deck.items.length < target && !cursor.phases[phase].exhausted) {
        const refillStartedAt = Date.now();
        const refillSummary = await this.refillPhaseDeck({
          deckKey: input.deckKey,
          phase,
          deck,
          viewerId: input.viewerId,
          mode: input.mode,
          blockedAuthors: input.blockedAuthors,
          durableSeen: input.durableSeen,
          servedRecent: input.servedRecent,
          phaseState: cursor.phases[phase],
          allPhaseStates: cursor.phases,
          reason: deck.items.length === 0 ? "cold_refill" : "low_deck",
          firstPaintTight: input.firstPaintTight,
          paginationMode,
          radiusFilter: input.radiusFilter,
          omitServedRecentFromSessionSeen: input.omitServedRecentFromSessionSeen,
          cursorSeen: input.cursorSeen,
          selectedSet
        });
        accumulateSurfaceTiming("feed_simple_stage_refill_ms", Date.now() - refillStartedAt);
        cursor.phases[phase] = refillSummary.phaseState;
        input.diag.reelCandidateReadCount += refillSummary.reelReadCount;
        input.diag.fallbackCandidateReadCount += refillSummary.fallbackReadCount;
        input.diag.rawReelCandidates += refillSummary.rawReelCandidates;
        input.diag.rawFallbackCandidates += refillSummary.rawFallbackCandidates;
        input.diag.boundedAttempts += refillSummary.boundedAttempts;
        input.diag.candidateReadCount += refillSummary.reelReadCount + refillSummary.fallbackReadCount;
        input.diag.reelPhaseExhausted = input.diag.reelPhaseExhausted || refillSummary.reelPhaseExhausted;
        deck = this.getOrCreatePhaseDeck(input.deckKey, phase);
        if (deck.items.length > 0) input.deckSourceRef.value = "cold_refill";
      }
      pickFromPhaseDeck(phase, input.pickMode ?? "strict_ring_and_durable");
      if (items.length >= input.limit) break;
      if (!cursor.phases[phase].exhausted) break;
      phaseIndex += 1;
    }

    cursor.activePhase = getEarliestAllowedPhase(cursor);
    return {
      items,
      selectedIds,
      cursor,
      deckSource: input.deckSourceRef.value
    };
  }

  private async refillPhaseDeck(input: {
    deckKey: string;
    phase: ForYouSimpleServePhase;
    deck: ReadyDeckEntry;
    viewerId: string;
    mode: SimpleFeedSortMode;
    blockedAuthors: Set<string>;
    durableSeen: Set<string>;
    servedRecent: Set<string>;
    phaseState: import("./feed-for-you-simple-cursor.js").ForYouSimplePhaseCursorState;
    allPhaseStates: Record<ForYouSimpleServePhase, import("./feed-for-you-simple-cursor.js").ForYouSimplePhaseCursorState>;
    reason: string;
    firstPaintTight?: boolean;
    paginationMode?: boolean;
    radiusFilter?: ForYouRadiusFilter;
    omitServedRecentFromSessionSeen?: boolean;
    cursorSeen: Set<string>;
    selectedSet: Set<string>;
  }): Promise<RefillDeckSummary & { phaseState: import("./feed-for-you-simple-cursor.js").ForYouSimplePhaseCursorState }> {
    const items: SimpleFeedCandidate[] = [];
    const relaxServedRecentForReelScan =
      input.firstPaintTight !== true &&
      (input.phase !== "fallback_normal" || input.omitServedRecentFromSessionSeen === true);
    const sessionSeen = new Set<string>([
      ...input.deck.items.map((item) => item.postId),
      ...input.durableSeen,
      ...input.cursorSeen,
      ...input.selectedSet,
      ...(relaxServedRecentForReelScan ? [] : input.servedRecent)
    ]);
    const filter = input.radiusFilter ?? { mode: "global" as const, centerLat: null, centerLng: null, radiusMiles: null };
    const filterIsActive = isActiveRadius(filter);
    const tryGate = (candidate: SimpleFeedCandidate): boolean => {
      if (sessionSeen.has(candidate.postId)) return false;
      if (input.blockedAuthors.has(candidate.authorId)) return false;
      if (input.viewerId && candidate.authorId === input.viewerId) return false;
      if (filterIsActive && !candidateMatchesRadius(candidate, filter)) return false;
      if (!candidateMatchesServePhase(candidate, input.phase)) return false;
      sessionSeen.add(candidate.postId);
      return true;
    };
    const paginationMode = input.paginationMode === true;
    const scanAttemptsCap = paginationMode ? PAGINATION_MAX_SCAN_ATTEMPTS : MAX_SCAN_ATTEMPTS;
    if (input.phase === "fallback_normal" && !fallbackAllowed({ phases: input.allPhaseStates })) {
      return {
        reelReadCount: 0,
        fallbackReadCount: 0,
        rawReelCandidates: 0,
        rawFallbackCandidates: 0,
        boundedAttempts: 0,
        reelPhaseExhausted: false,
        phaseState: input.phaseState
      };
    }
    const readCap =
      input.phase === "fallback_normal"
        ? paginationMode
          ? PAGINATION_FALLBACK_READ_CAP
          : input.firstPaintTight
            ? Math.max(4, 15 - 8)
            : Math.max(12, MAX_MAIN_READ_BUDGET - 8)
        : paginationMode
          ? PAGINATION_REEL_READ_CAP
          : input.firstPaintTight
            ? 8
            : MAX_MAIN_READ_BUDGET;
    const scanned = await scanServePhase({
      repository: this.repository,
      phase: input.phase,
      mode: input.mode,
      phaseState: input.phaseState,
      limit: FOR_YOU_SIMPLE_PHASE_DECK_TARGET,
      tryGate,
      items,
      sessionSeen,
      maxReads: readCap,
      maxAttempts: scanAttemptsCap
    });
    input.deck.items = mergeUniqueDeckItems(input.deck.items, items).slice(0, 60);
    input.deck.updatedAtMs = Date.now();
    input.deck.generation += 1;
    input.deck.refillReason = input.reason;
    input.deck.deckFormat = FOR_YOU_SIMPLE_DECK_FORMAT;
    input.deck.phase = input.phase;
    readyDeckMemory.set(phaseDeckMemoryKey(input.deckKey, input.phase), input.deck);
    return {
      reelReadCount: input.phase === "fallback_normal" ? 0 : scanned.readCount,
      fallbackReadCount: input.phase === "fallback_normal" ? scanned.readCount : 0,
      rawReelCandidates: scanned.rawTotal,
      rawFallbackCandidates: input.phase === "fallback_normal" ? scanned.rawTotal : 0,
      boundedAttempts: scanned.attempts,
      reelPhaseExhausted: scanned.exhausted,
      phaseState: scanned.phaseState
    };
  }

}

function mergeUniqueDeckItems(existing: SimpleFeedCandidate[], incoming: SimpleFeedCandidate[]): SimpleFeedCandidate[] {
  const out = [...existing];
  const seen = new Set(existing.map((item) => normalizeFeedPostIdFromCandidate(item) ?? item.postId));
  for (const item of incoming) {
    const postId = normalizeFeedPostIdFromCandidate(item) ?? item.postId;
    if (seen.has(postId)) continue;
    seen.add(postId);
    out.push(canonicalizeFeedCandidate({ ...item, postId }));
    if (out.length >= 60) break;
  }
  return out;
}

function finalizeUniqueCandidates(input: {
  candidates: SimpleFeedCandidate[];
  cursorSeen: Set<string>;
  recycleMode: boolean;
}): { items: SimpleFeedCandidate[]; duplicateBlockedCount: number; seenSkippedCount: number } {
  const out: SimpleFeedCandidate[] = [];
  const pageSeen = new Set<string>();
  const recentWindow = [...input.cursorSeen].slice(-RECYCLE_SEEN_WINDOW);
  const recentWindowSet = new Set(recentWindow);
  let duplicateBlockedCount = 0;
  let seenSkippedCount = 0;
  for (const candidate of input.candidates) {
    const postId = normalizeFeedPostIdFromCandidate(candidate) ?? candidate.postId;
    if (pageSeen.has(postId)) {
      duplicateBlockedCount += 1;
      debugLog("feed", "FOR_YOU_SIMPLE_DUPLICATE_BLOCKED", () => ({ postId, reason: "within_page" }));
      continue;
    }
    if (!input.recycleMode && input.cursorSeen.has(postId)) {
      seenSkippedCount += 1;
      debugLog("feed", "FOR_YOU_SIMPLE_DUPLICATE_BLOCKED", () => ({ postId, reason: "cursor_seen" }));
      continue;
    }
    if (input.recycleMode && recentWindowSet.has(postId)) {
      seenSkippedCount += 1;
      continue;
    }
    pageSeen.add(postId);
    out.push(canonicalizeFeedCandidate({ ...candidate, postId }));
  }
  return { items: out, duplicateBlockedCount, seenSkippedCount };
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

function prunePhaseDecksForExclusion(deckKey: string, exclusion: Set<string>): void {
  for (const phase of FOR_YOU_SIMPLE_SERVE_PHASES) {
    const memoryKey = phaseDeckMemoryKey(deckKey, phase);
    const deck = readyDeckMemory.get(memoryKey);
    if (!deck?.items.length) continue;
    const remaining = deck.items.filter((candidate) => {
      const postId = normalizeFeedPostIdFromCandidate(candidate) ?? candidate.postId;
      return !exclusion.has(postId);
    });
    if (remaining.length === deck.items.length) continue;
    deck.items = remaining;
    deck.updatedAtMs = Date.now();
    deck.generation += 1;
    if (remaining.length === 0) {
      readyDeckMemory.delete(memoryKey);
    } else {
      readyDeckMemory.set(memoryKey, deck);
    }
  }
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
    queryCount: 0,
    paginationBudgetCapped: false
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
  /** Optional radius gate (returns true if candidate satisfies the filter). Increments diag.filteredOutCount when it rejects. */
  radiusGate?: (candidate: SimpleFeedCandidate) => boolean;
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
    if (input.radiusGate && !input.radiusGate(candidate)) continue;

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
  const compactCap = Math.min(carouselCompactAssetCap(visibleAssets.length), FEED_SIMPLE_FIRST_PAINT_WIRE_ASSET_CAP);
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
    compactAssetLimit: compactCap,
    compactSurfaceWireMode: "feed_first_paint",
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
  const baseKey = `${id}_${FOR_YOU_SIMPLE_SURFACE}`;
  const phaseDeck = readyDeckMemory.get(phaseDeckMemoryKey(baseKey, "reel_tier_5"));
  if (!phaseDeck) return null;
  return {
    key: phaseDeckMemoryKey(baseKey, phaseDeck.phase),
    generation: phaseDeck.generation,
    size: phaseDeck.items.length,
    nextItemIds: phaseDeck.items.slice(0, 10).map((item) => item.postId),
    updatedAtMs: phaseDeck.updatedAtMs,
    refillReason: phaseDeck.refillReason,
    hasRefillInFlight: Boolean(phaseDeck.refillInFlight)
  };
}
