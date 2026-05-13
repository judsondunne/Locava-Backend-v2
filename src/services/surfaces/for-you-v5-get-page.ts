import { randomBytes } from "node:crypto";
import type { FeedCardDTO } from "../../dto/compact-surface-dto.js";
import { getPostCoordinates, type PostRecord } from "../../lib/posts/postFieldSelectors.js";
import { getRequestContext } from "../../observability/request-context.js";
import type { FeedForYouSimpleRepository, SimpleFeedCandidate } from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import { debugLog } from "../../lib/logging/debug-log.js";
import { diversifyByAuthor } from "./feed-for-you-simple-author-diversity.js";
import {
  applyFirstPaintPlaybackDiagnostics,
  buildFeedCardFromSimpleCandidate,
  updateMediaDiagnostics,
} from "./feed-for-you-simple-post-card.js";
import { isForYouSimpleReel } from "./feed-for-you-simple-tier.js";
import type { ForYouRadiusFilter, ForYouSimpleServePhase } from "./feed-for-you-simple-cursor.js";
import type { FeedForYouSimplePageDebug } from "./feed-for-you-simple.service.js";
import {
  FOR_YOU_V5_CURSOR_PREFIX,
  FOR_YOU_V5_SESSION_SEEN_CAP,
  createFreshForYouV5Cursor,
  decodeForYouV5Cursor,
  encodeForYouV5Cursor,
  shortViewerKeyHash,
  type ForYouV5CursorPayload,
  type ForYouV5PhaseKey,
} from "./for-you-v5-cursor.js";
import { isForYouV5EnvVerifyReadOnly, isForYouV5SeenWritesEnabled } from "./for-you-v5-flags.js";
import { ensureForYouV5ReadyDeck, type ForYouV5ReadyDeckSnapshot } from "./for-you-v5-ready-deck.js";

const LIMIT_DEFAULT = 5;
const LIMIT_MIN = 1;
const LIMIT_MAX = 12;
const RADIUS_MILES_TO_KM = 1.609344;

function clampLimit(raw: number): number {
  const n = Number.isFinite(raw) ? Math.floor(raw) : LIMIT_DEFAULT;
  return Math.max(LIMIT_MIN, Math.min(LIMIT_MAX, n || LIMIT_DEFAULT));
}

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

function v5DeckSourceFromCacheStatus(cacheStatus: string): "memory" | "firestore" | "cold_refill" | "fallback" {
  if (cacheStatus === "memory_hit" || cacheStatus === "stale_hit" || cacheStatus === "refresh_failed") return "memory";
  if (cacheStatus === "cold_fill") return "firestore";
  return "fallback";
}

function resolveV5RequestCursorType(input: {
  rawCursor: string;
  refresh: boolean;
  decoded: ForYouV5CursorPayload | null;
}): "none" | "fys_v5" | "invalid" {
  if (input.refresh) return "none";
  const c = input.rawCursor.trim();
  if (!c) return "none";
  if (c.startsWith(FOR_YOU_V5_CURSOR_PREFIX)) return input.decoded ? "fys_v5" : "invalid";
  return "invalid";
}

function finalizeV5PickedCandidates(input: {
  picked: SimpleFeedCandidate[];
  sessionSeenBefore: Set<string>;
}): { picked: SimpleFeedCandidate[]; duplicateReturnedPostIds: string[]; droppedSessionDupes: string[] } {
  const duplicateReturnedPostIds: string[] = [];
  const droppedSessionDupes: string[] = [];
  const used = new Set<string>();
  const out: SimpleFeedCandidate[] = [];
  for (const c of input.picked) {
    if (input.sessionSeenBefore.has(c.postId)) {
      droppedSessionDupes.push(c.postId);
      continue;
    }
    if (used.has(c.postId)) {
      duplicateReturnedPostIds.push(c.postId);
      continue;
    }
    used.add(c.postId);
    out.push(c);
  }
  if (duplicateReturnedPostIds.length > 0 || droppedSessionDupes.length > 0) {
    debugLog("feed", "FOR_YOU_V5_CRITICAL_DUPLICATE_OR_SESSION_REPLAY", () => ({
      duplicateReturnedPostIds,
      droppedSessionDupes,
    }));
  }
  return { picked: out, duplicateReturnedPostIds, droppedSessionDupes };
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

function emptyV5Diagnostics(requestedLimit: number): FeedForYouSimplePageDebug {
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
    paginationBudgetCapped: false,
  };
}

function sortKey(viewerKey: string, deckVersion: number, postId: string): number {
  const s = `${viewerKey}|${deckVersion}|${postId}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function sortPhase(list: SimpleFeedCandidate[], viewerKey: string, deckVersion: number): SimpleFeedCandidate[] {
  return [...list].sort((a, b) => {
    const ka = sortKey(viewerKey, deckVersion, a.postId);
    const kb = sortKey(viewerKey, deckVersion, b.postId);
    if (ka !== kb) return ka - kb;
    return a.postId.localeCompare(b.postId);
  });
}

function resolveViewerKeyForV5(viewerIdRaw: string, deviceIdHeader: string | null | undefined): {
  viewerKey: string;
  viewerKeyType: "auth" | "device" | "anonymous_unstable";
} {
  const trimmed = viewerIdRaw.trim();
  const reserved = new Set(["anonymous", "anon", "guest"]);
  const lower = trimmed.toLowerCase();
  const device = (deviceIdHeader ?? "").trim();
  if (trimmed && !reserved.has(lower)) {
    return { viewerKey: trimmed, viewerKeyType: "auth" };
  }
  if (device.length >= 8) return { viewerKey: `device:${device}`, viewerKeyType: "device" };
  if (trimmed.length >= 8 && !reserved.has(lower)) return { viewerKey: `device:${trimmed}`, viewerKeyType: "device" };
  return { viewerKey: `anon_unstable:${randomBytes(10).toString("hex")}`, viewerKeyType: "anonymous_unstable" };
}

function isPlayableCandidate(c: SimpleFeedCandidate): boolean {
  if (!c.posterUrl?.trim() && !c.assets[0]?.posterUrl?.trim() && !c.assets[0]?.previewUrl?.trim()) return false;
  return true;
}

function pickPageFromDeck(input: {
  snapshot: ForYouV5ReadyDeckSnapshot;
  cursor: ForYouV5CursorPayload;
  limit: number;
  durableReelSeen: Set<string>;
  durableRegularSeen: Set<string>;
  blockedAuthors: Set<string>;
  viewerId: string;
  radiusGate: (c: SimpleFeedCandidate) => boolean;
  /** When true, ignore durable seen capsules for eligibility (repeat lane; ledger still updated on serve). */
  relaxDurableSeen?: boolean;
}): {
  picked: SimpleFeedCandidate[];
  nextCursor: ForYouV5CursorPayload;
  phaseCounts: Record<ForYouV5PhaseKey, number>;
  activePhase: ForYouV5PhaseKey;
  regularFallbackUsed: boolean;
  reelsRemainingEstimate: number;
  filteredByDurableSeen: number;
  filteredByCursorSeen: number;
  filteredByInvalidMedia: number;
  authorSpacingSkips: number;
} {
  const sessionSeen = new Set(input.cursor.sessionSeenPostIds.map((x) => String(x).trim()).filter(Boolean));
  const poolIds = new Set<string>();
  const sorted: Record<ForYouV5PhaseKey, SimpleFeedCandidate[]> = {
    reel_tier_5: sortPhase(input.snapshot.reelTier5, input.cursor.viewerKey, input.snapshot.deckVersion),
    reel_tier_4: sortPhase(input.snapshot.reelTier4, input.cursor.viewerKey, input.snapshot.deckVersion),
    reel_other: sortPhase(input.snapshot.reelOther, input.cursor.viewerKey, input.snapshot.deckVersion),
    regular: sortPhase(input.snapshot.regular, input.cursor.viewerKey, input.snapshot.deckVersion),
  };
  const offsets = { ...input.cursor.phaseOffsets };
  let filteredByDurableSeen = 0;
  let filteredByCursorSeen = 0;
  let filteredByInvalidMedia = 0;
  const pool: SimpleFeedCandidate[] = [];
  let activePhase: ForYouV5PhaseKey = "reel_tier_5";
  let regularFallbackUsed = false;

  const tryPush = (c: SimpleFeedCandidate, phase: ForYouV5PhaseKey, isReelPhase: boolean): boolean => {
    if (!isPlayableCandidate(c)) {
      filteredByInvalidMedia += 1;
      return false;
    }
    if (!input.radiusGate(c)) return false;
    if (input.blockedAuthors.has(c.authorId)) return false;
    if (input.viewerId && c.authorId === input.viewerId) return false;
    if (sessionSeen.has(c.postId)) {
      filteredByCursorSeen += 1;
      return false;
    }
    const d = isReelPhase ? input.durableReelSeen : input.durableRegularSeen;
    if (!input.relaxDurableSeen && d.has(c.postId)) {
      filteredByDurableSeen += 1;
      return false;
    }
    if (poolIds.has(c.postId)) return false;
    poolIds.add(c.postId);
    pool.push(c);
    return true;
  };

  for (const phase of ["reel_tier_5", "reel_tier_4", "reel_other"] as const) {
    activePhase = phase;
    const arr = sorted[phase];
    /** Cap scans per phase per page so offsets advance ~O(limit), not O(limit*24), across pagination. */
    const poolCap = input.limit * 3;
    while (offsets[phase] < arr.length && pool.length < poolCap) {
      const c = arr[offsets[phase]];
      offsets[phase] += 1;
      if (!c) break;
      tryPush(c, phase, true);
    }
    if (pool.length >= input.limit) break;
  }

  const reelsRemainingEstimate = (["reel_tier_5", "reel_tier_4", "reel_other"] as const).reduce((sum, ph) => {
    const arr = sorted[ph];
    let n = 0;
    for (let i = offsets[ph]; i < arr.length; i += 1) {
      const c = arr[i];
      if (!c) continue;
      if (!isPlayableCandidate(c)) continue;
      if (!input.radiusGate(c)) continue;
      if (input.blockedAuthors.has(c.authorId)) continue;
      if (input.viewerId && c.authorId === input.viewerId) continue;
      if (sessionSeen.has(c.postId)) continue;
      if (!input.relaxDurableSeen && input.durableReelSeen.has(c.postId)) continue;
      n += 1;
    }
    return sum + n;
  }, 0);

  if (pool.length < input.limit && reelsRemainingEstimate === 0) {
    regularFallbackUsed = true;
    activePhase = "regular";
    const arr = sorted.regular;
    const poolCapRegular = input.limit * 3;
    while (offsets.regular < arr.length && pool.length < poolCapRegular) {
      const c = arr[offsets.regular];
      offsets.regular += 1;
      if (!c) break;
      if (isForYouSimpleReel(c)) continue;
      tryPush(c, "regular", false);
    }
  }

  const diversified = diversifyByAuthor(pool, {
    limit: input.limit,
    lastAuthorId: input.cursor.lastAuthorId ?? null,
    recentAuthorIds: new Set(input.cursor.recentAuthorIds ?? []),
    maxPerAuthorPerPage: 2,
    avoidBackToBack: true,
  });
  const picked = diversified.items.slice(0, input.limit);
  const authorSpacingSkips = diversified.sameAuthorAdjacentCount;
  const returnedIds = picked.map((c) => c.postId);
  const nextCursor: ForYouV5CursorPayload = {
    ...input.cursor,
    phaseOffsets: offsets,
    sessionSeenPostIds: [...sessionSeen, ...returnedIds],
    recentAuthorIds: [...(input.cursor.recentAuthorIds ?? []), ...picked.map((c) => c.authorId)].filter(Boolean),
    lastAuthorId: picked.length > 0 ? picked[picked.length - 1]?.authorId ?? null : input.cursor.lastAuthorId,
    issuedAtMs: Date.now(),
  };
  const phaseCounts = {
    reel_tier_5: sorted.reel_tier_5.length,
    reel_tier_4: sorted.reel_tier_4.length,
    reel_other: sorted.reel_other.length,
    regular: sorted.regular.length,
  };
  return {
    picked,
    nextCursor,
    phaseCounts,
    activePhase,
    regularFallbackUsed,
    reelsRemainingEstimate,
    filteredByDurableSeen,
    filteredByCursorSeen,
    filteredByInvalidMedia,
    authorSpacingSkips,
  };
}

export type GetForYouV5PageInput = {
  repository: Pick<
    FeedForYouSimpleRepository,
    | "isEnabled"
    | "resolveSortMode"
    | "fetchReelCandidatesForYouV5Deck"
    | "fetchRegularReservoirForYouV5Deck"
    | "fetchBatch"
    | "readForYouV5CompactFeedState"
    | "writeForYouV5CompactFeedState"
    | "loadBlockedAuthorIdsForViewer"
  >;
  viewerId: string | null;
  limit: number;
  cursor: string | null;
  refresh: boolean;
  radiusFilter: ForYouRadiusFilter;
  dryRunSeen?: boolean;
  verifyReadOnly?: boolean;
  deviceIdHeader?: string | null;
};

export async function getForYouV5Page(input: GetForYouV5PageInput): Promise<{
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
  lane: "reels" | "normal" | "recycled";
  exhaustedReels: boolean;
  exhaustedNormal: boolean;
  hasMore: boolean;
  terminalExhaustionConfirmed: boolean;
  debug: FeedForYouSimplePageDebug;
}> {
  const startedAt = Date.now();
  if (!input.repository.isEnabled()) {
    throw new Error("feed_for_you_simple_source_unavailable");
  }
  const limit = clampLimit(input.limit);
  const viewerIdRaw = input.viewerId?.trim() ?? "";
  const { viewerKey, viewerKeyType } = resolveViewerKeyForV5(viewerIdRaw, input.deviceIdHeader);
  const diag = emptyV5Diagnostics(limit);
  const rawCursor = (input.cursor ?? "").trim();
  const verifyReadonly = isForYouV5EnvVerifyReadOnly(process.env) || input.verifyReadOnly === true;
  const dryRunSeen = input.dryRunSeen === true;
  const readOnly = verifyReadonly || dryRunSeen;
  const seenWritesEnabled = isForYouV5SeenWritesEnabled(process.env) && !readOnly;
  let seenWriteSkippedReason: string | null = null;
  if (verifyReadonly) seenWriteSkippedReason = "readonly";
  else if (dryRunSeen) seenWriteSkippedReason = "dry_run_seen";
  else if (!isForYouV5SeenWritesEnabled(process.env)) seenWriteSkippedReason = "env_disabled";

  const decoded = !input.refresh && rawCursor ? decodeForYouV5Cursor(input.cursor) : null;
  if (!input.refresh && rawCursor.startsWith(FOR_YOU_V5_CURSOR_PREFIX) && !decoded) {
    throw new Error("invalid_simple_feed_cursor");
  }
  const effectiveViewerKey = decoded?.viewerKey ?? viewerKey;
  if (decoded && decoded.viewerKeyHash !== shortViewerKeyHash(decoded.viewerKey)) {
    throw new Error("invalid_simple_feed_cursor");
  }

  const cursorType = resolveV5RequestCursorType({ rawCursor, refresh: input.refresh === true, decoded });
  const authUid = viewerKeyType === "auth" ? effectiveViewerKey : "";
  const repeatRisk =
    !rawCursor && input.refresh !== true && Boolean(authUid) && !seenWritesEnabled
      ? "fresh_no_cursor_requests_can_repeat_when_readonly"
      : null;

  let { snapshot, cacheStatus, dbReadEstimate } = await ensureForYouV5ReadyDeck({
    repository: input.repository,
    forceRefresh: input.refresh === true,
  });

  let durableReelSeen = new Set<string>();
  let durableRegularSeen = new Set<string>();
  let durableReads = 0;
  const needsDurableFetch =
    Boolean(authUid) &&
    (input.refresh ||
      !decoded ||
      decoded.deckVersion !== snapshot.deckVersion ||
      !Array.isArray(decoded.durableReelCapsule) ||
      !Array.isArray(decoded.durableRegularCapsule));
  const durableSeenRead = Boolean(needsDurableFetch && authUid);
  if (needsDurableFetch && authUid) {
    const st = await input.repository.readForYouV5CompactFeedState(authUid);
    durableReelSeen = st.reelSeenPostIds;
    durableRegularSeen = st.regularSeenPostIds;
    durableReads = st.readCount;
  } else if (authUid && decoded) {
    durableReelSeen = new Set((decoded.durableReelCapsule ?? []).map((x) => String(x).trim()).filter(Boolean));
    durableRegularSeen = new Set((decoded.durableRegularCapsule ?? []).map((x) => String(x).trim()).filter(Boolean));
  }

  const cursor: ForYouV5CursorPayload =
    decoded &&
    decoded.deckVersion === snapshot.deckVersion &&
    !input.refresh &&
    decoded.viewerKeyHash === shortViewerKeyHash(decoded.viewerKey)
      ? { ...decoded, viewerKey: effectiveViewerKey }
      : createFreshForYouV5Cursor({
          viewerKey: effectiveViewerKey,
          deckVersion: snapshot.deckVersion,
          randomMode: snapshot.randomMode,
          regularAnchor: snapshot.regularAnchor,
          durableReelCapsule: [...durableReelSeen].slice(-500),
          durableRegularCapsule: [...durableRegularSeen].slice(-500),
        });

  const blocked = authUid
    ? await input.repository.loadBlockedAuthorIdsForViewer(authUid)
    : { blocked: new Set<string>(), readCount: 0 };
  const radiusGate = (c: SimpleFeedCandidate) => candidateMatchesRadius(c, input.radiusFilter);

  let emptyPageRecoveryAttempted = false;
  let emptyPageRecoveryReason: string | null = null;
  let memoryDeckExhausted = false;
  let repeatModeActivated = false;
  let fallbackRefillSource: string | null = null;
  let terminalExhaustionConfirmed = false;
  let eligibleCandidateCount = 0;
  let seenFilteredCount = 0;

  const serveAttempt = (args: {
    snap: ForYouV5ReadyDeckSnapshot;
    cur: ForYouV5CursorPayload;
    relaxDurableSeen?: boolean;
  }) => {
    const p = pickPageFromDeck({
      snapshot: args.snap,
      cursor: args.cur,
      limit,
      durableReelSeen,
      durableRegularSeen,
      blockedAuthors: blocked.blocked,
      viewerId: viewerIdRaw,
      radiusGate,
      relaxDurableSeen: args.relaxDurableSeen === true,
    });
    const sess = new Set(args.cur.sessionSeenPostIds.map((x) => String(x).trim()).filter(Boolean));
    const fin = finalizeV5PickedCandidates({
      picked: p.picked,
      sessionSeenBefore: sess,
    });
    return { pick: p, pickedFin: fin.picked, duplicateReturnedPostIds: fin.duplicateReturnedPostIds, inputCur: args.cur };
  };

  let attempt = serveAttempt({ snap: snapshot, cur: cursor });

  if (attempt.pickedFin.length === 0) {
    emptyPageRecoveryAttempted = true;
    const sortedRegularProbe = sortPhase(snapshot.regular, effectiveViewerKey, snapshot.deckVersion);
    memoryDeckExhausted =
      attempt.pick.reelsRemainingEstimate === 0 &&
      (!attempt.pick.regularFallbackUsed ||
        attempt.pick.nextCursor.phaseOffsets.regular >= sortedRegularProbe.length);
    eligibleCandidateCount =
      snapshot.reelTier5.length +
      snapshot.reelTier4.length +
      snapshot.reelOther.length +
      snapshot.regular.length;
    seenFilteredCount = attempt.pick.filteredByCursorSeen + attempt.pick.filteredByDurableSeen;

    const curRelax = createFreshForYouV5Cursor({
      viewerKey: effectiveViewerKey,
      deckVersion: snapshot.deckVersion,
      randomMode: snapshot.randomMode,
      regularAnchor: snapshot.regularAnchor,
      durableReelCapsule: [...durableReelSeen].slice(-500),
      durableRegularCapsule: [...durableRegularSeen].slice(-500),
    });
    curRelax.sessionSeenPostIds = cursor.sessionSeenPostIds.slice(-FOR_YOU_V5_SESSION_SEEN_CAP);
    attempt = serveAttempt({ snap: snapshot, cur: curRelax, relaxDurableSeen: true });
    if (attempt.pickedFin.length > 0) {
      emptyPageRecoveryReason = "relax_durable_same_deck";
      repeatModeActivated = true;
    } else {
      emptyPageRecoveryReason = "relax_durable_still_empty";
    }
  }

  if (attempt.pickedFin.length === 0 && memoryDeckExhausted) {
    const refill = await ensureForYouV5ReadyDeck({
      repository: input.repository,
      forceRefresh: true,
    });
    snapshot = refill.snapshot;
    cacheStatus = refill.cacheStatus;
    dbReadEstimate += refill.dbReadEstimate;
    fallbackRefillSource = refill.cacheStatus === "cold_fill" ? "firestore_cold_fill" : "deck_refresh";
    const cur2 = createFreshForYouV5Cursor({
      viewerKey: effectiveViewerKey,
      deckVersion: snapshot.deckVersion,
      randomMode: snapshot.randomMode,
      regularAnchor: snapshot.regularAnchor,
      durableReelCapsule: [...durableReelSeen].slice(-500),
      durableRegularCapsule: [...durableRegularSeen].slice(-500),
    });
    cur2.sessionSeenPostIds = cursor.sessionSeenPostIds.slice(-48);
    attempt = serveAttempt({ snap: snapshot, cur: cur2 });
    if (attempt.pickedFin.length > 0) {
      emptyPageRecoveryReason = "deck_force_refill";
    } else {
      attempt = serveAttempt({ snap: snapshot, cur: cur2, relaxDurableSeen: true });
      if (attempt.pickedFin.length > 0) {
        repeatModeActivated = true;
        emptyPageRecoveryReason = "deck_refill_repeat_mode";
      }
    }
  }

  const deckPopulation =
    snapshot.reelTier5.length + snapshot.reelTier4.length + snapshot.reelOther.length + snapshot.regular.length;

  if (attempt.pickedFin.length === 0 && deckPopulation > 0) {
    emptyPageRecoveryAttempted = true;
    const curClear = createFreshForYouV5Cursor({
      viewerKey: effectiveViewerKey,
      deckVersion: snapshot.deckVersion,
      randomMode: snapshot.randomMode,
      regularAnchor: snapshot.regularAnchor,
      durableReelCapsule: [...durableReelSeen].slice(-500),
      durableRegularCapsule: [...durableRegularSeen].slice(-500),
    });
    curClear.sessionSeenPostIds = [];
    attempt = serveAttempt({ snap: snapshot, cur: curClear, relaxDurableSeen: true });
    if (attempt.pickedFin.length > 0) {
      repeatModeActivated = true;
      emptyPageRecoveryReason = "session_cleared_relax_durable";
    }
  }

  terminalExhaustionConfirmed = attempt.pickedFin.length === 0 && deckPopulation === 0;
  if (terminalExhaustionConfirmed) {
    emptyPageRecoveryReason = emptyPageRecoveryReason ?? "terminal_empty_deck";
  }

  const pick = attempt.pick;
  const pickedFin = attempt.pickedFin;
  const duplicateReturnedPostIds = attempt.duplicateReturnedPostIds;
  const sessionSeenBeforePick = new Set(attempt.inputCur.sessionSeenPostIds.map((x) => String(x).trim()).filter(Boolean));

  const mergedSessionSeen = new Set(sessionSeenBeforePick);
  for (const c of pickedFin) mergedSessionSeen.add(c.postId);
  const adjustedNextCursor: ForYouV5CursorPayload = {
    ...pick.nextCursor,
    sessionSeenPostIds: [...mergedSessionSeen].slice(-FOR_YOU_V5_SESSION_SEEN_CAP),
  };

  for (const c of pickedFin) {
    updateMediaDiagnostics(c, diag);
  }
  applyFirstPaintPlaybackDiagnostics(pickedFin, diag);

  const cards = pickedFin.map((c, i) => buildFeedCardFromSimpleCandidate(c, i, viewerIdRaw)) as FeedCardDTO[];

  const sortedRegularFull = sortPhase(snapshot.regular, effectiveViewerKey, snapshot.deckVersion);
  const moreRegularRemain =
    pick.regularFallbackUsed && adjustedNextCursor.phaseOffsets.regular < sortedRegularFull.length;
  const hasMoreInDeck = pick.reelsRemainingEstimate > 0 || moreRegularRemain;

  const reelReturnedIds = pickedFin.filter((c) => isForYouSimpleReel(c)).map((c) => c.postId);
  const regReturnedIds = pickedFin.filter((c) => !isForYouSimpleReel(c)).map((c) => c.postId);
  const finalNext: ForYouV5CursorPayload = {
    ...adjustedNextCursor,
    durableReelCapsule: [...new Set([...(adjustedNextCursor.durableReelCapsule ?? []), ...reelReturnedIds])].slice(-500),
    durableRegularCapsule: [...new Set([...(adjustedNextCursor.durableRegularCapsule ?? []), ...regReturnedIds])].slice(
      -500
    ),
  };

  const exhaustedReels = pick.reelsRemainingEstimate === 0;
  const exhaustedNormal =
    pick.regularFallbackUsed &&
    adjustedNextCursor.phaseOffsets.regular >= sortedRegularFull.length &&
    pick.reelsRemainingEstimate === 0;
  const nextEnc =
    terminalExhaustionConfirmed ? null : encodeForYouV5Cursor(finalNext);

  let seenWriteAttempted = false;
  if (authUid && pickedFin.length > 0 && seenWritesEnabled) {
    seenWriteAttempted = true;
    const reelIds = pickedFin.filter((c) => isForYouSimpleReel(c)).map((c) => c.postId);
    const regIds = pickedFin.filter((c) => !isForYouSimpleReel(c)).map((c) => c.postId);
    const mergedReel = [...durableReelSeen, ...reelIds];
    const mergedReg = [...durableRegularSeen, ...regIds];
    setTimeout(() => {
      void input.repository
        .writeForYouV5CompactFeedState({
          viewerId: authUid,
          reelSeenPostIds: mergedReel.slice(-2500),
          regularSeenPostIds: mergedReg.slice(-2500),
        })
        .catch((err: unknown) => {
          debugLog("feed", "FOR_YOU_V5_SEEN_WRITE_FAILED", () => ({
            message: err instanceof Error ? err.message : String(err),
          }));
        });
    }, 0);
    diag.seenWriteAttempted = true;
    diag.seenWriteSucceeded = true;
    seenWriteSkippedReason = null;
  } else {
    if (readOnly && pickedFin.length > 0) {
      debugLog("feed", "FOR_YOU_V5_SEEN_WRITE_SKIPPED_READONLY", () => ({
        viewerKeyType,
        verifyReadonly,
        dryRunSeen,
      }));
    }
    diag.seenWriteAttempted = false;
    diag.seenWriteSucceeded = false;
  }

  const ctx = getRequestContext();
  const dbReadTotal = ctx?.dbOps.reads ?? durableReads + blocked.readCount;
  const dbReadEstTotal = dbReadEstimate + durableReads + blocked.readCount;
  diag.dbReads = dbReadTotal;
  diag.queryCount = ctx?.dbOps.queries ?? 0;
  diag.cursorUsed = Boolean(input.cursor) && !input.refresh;
  diag.returnedCount = pickedFin.length;
  diag.nextCursorPresent = Boolean(nextEnc);
  diag.emptyPageRecoveryAttempted = emptyPageRecoveryAttempted;
  diag.emptyPageRecoveryReason = emptyPageRecoveryReason;
  diag.memoryDeckExhausted = memoryDeckExhausted;
  diag.cursorPhaseExhausted = exhaustedReels && exhaustedNormal;
  diag.eligibleCandidateCount = eligibleCandidateCount || deckPopulation;
  diag.seenFilteredCount = seenFilteredCount;
  diag.sessionSeenCount = sessionSeenBeforePick.size;
  diag.durableSeenCount = durableReelSeen.size + durableRegularSeen.size;
  diag.repeatModeActivated = repeatModeActivated;
  diag.fallbackRefillSource = fallbackRefillSource;
  diag.terminalExhaustionConfirmed = terminalExhaustionConfirmed;
  diag.deckSource = v5DeckSourceFromCacheStatus(cacheStatus);
  diag.deckHit = cacheStatus === "memory_hit" || cacheStatus === "stale_hit";
  diag.randomSeedOrAnchor = `v5:${snapshot.deckVersion}:${pick.activePhase}`;
  diag.durableSeenReadCount = durableReads + blocked.readCount;
  diag.reelReturnedCount = pickedFin.filter((c) => isForYouSimpleReel(c)).length;
  diag.activePhase =
    pick.activePhase === "regular"
      ? "fallback_normal"
      : (pick.activePhase as ForYouSimpleServePhase);
  diag.fallbackReturnedCount = pickedFin.filter((c) => !isForYouSimpleReel(c)).length;
  diag.fallbackAllPostsUsed = pick.regularFallbackUsed;
  diag.reelPhaseExhausted = exhaustedReels;

  const lane: "reels" | "normal" | "recycled" = pick.regularFallbackUsed ? "normal" : "reels";

  const elapsedMs = Date.now() - startedAt;
  if (!seenWriteAttempted && pickedFin.length > 0 && seenWriteSkippedReason == null && !authUid) {
    seenWriteSkippedReason = "anonymous_viewer";
  }
  const returnedPostIds = pickedFin.map((c) => c.postId);
  const logPayload = {
    event: "FOR_YOU_V5_RESPONSE",
    routeEnteredV5: true,
    cursorType,
    dryRunSeen,
    seenWritesEnabled,
    returnedPostIds,
    duplicateReturnedPostIds,
    elapsedMs,
    dbReadEstimate: dbReadEstTotal,
    cacheStatus,
    deckSource: diag.deckSource,
    activePhase: pick.activePhase,
    regularFallbackUsed: pick.regularFallbackUsed,
    reelsRemainingEstimate: pick.reelsRemainingEstimate,
    nextCursorPresent: Boolean(nextEnc),
    durableSeenRead,
    seenWriteAttempted,
    seenWriteSkippedReason,
    repeatRisk,
    returnedCount: pickedFin.length,
    limit,
    viewerKeyType,
    cursorUsed: diag.cursorUsed,
    deckVersion: snapshot.deckVersion,
    phaseCounts: pick.phaseCounts,
    filteredByDurableSeen: pick.filteredByDurableSeen,
    filteredByCursorSeen: pick.filteredByCursorSeen,
    terminalExhaustionConfirmed,
    repeatModeActivated,
    emptyPageRecoveryAttempted,
    emptyPageRecoveryReason,
    memoryDeckExhausted,
    eligibleCandidateCount: eligibleCandidateCount || deckPopulation,
    seenFilteredCount,
    sessionSeenCount: sessionSeenBeforePick.size,
    durableSeenCount: durableReelSeen.size + durableRegularSeen.size,
    fallbackRefillSource,
  };
  debugLog("feed", "FOR_YOU_V5_RESPONSE", () => logPayload);

  if (pickedFin.length === 0) {
    debugLog("feed", "FOR_YOU_V5_EMPTY_EXHAUSTED", () => ({
      viewerKeyType,
      cacheStatus,
      reelsRemainingEstimate: pick.reelsRemainingEstimate,
    }));
  }

  return {
    routeName: "feed.for_you_simple.get",
    items: cards,
    nextCursor: nextEnc,
    exhausted: terminalExhaustionConfirmed,
    emptyReason: terminalExhaustionConfirmed ? "no_playable_posts" : null,
    degradedFallbackUsed: false,
    relaxedSeenUsed: false,
    wrapAroundUsed: false,
    fallbackAllPostsUsed: pick.regularFallbackUsed,
    emergencyFallbackUsed: false,
    lane,
    exhaustedReels,
    exhaustedNormal,
    hasMore: Boolean(nextEnc),
    terminalExhaustionConfirmed,
    debug: {
      ...diag,
      elapsedMs,
      forYouRouteVariant: "v5",
      routeEnteredV5: true,
      cursorType,
      dryRunSeen,
      seenWritesEnabled,
      returnedPostIds,
      duplicateReturnedPostIds,
      repeatRisk,
      cacheStatus,
      dbReadEstimate: dbReadEstTotal,
      regularFallbackUsed: pick.regularFallbackUsed,
      reelsRemainingEstimate: pick.reelsRemainingEstimate,
      durableSeenRead,
      seenWriteSkippedReason,
    } as FeedForYouSimplePageDebug,
  };
}
