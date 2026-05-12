import { randomBytes } from "node:crypto";
import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import {
  FOR_YOU_V5_REGULAR_RESERVOIR_MAX_DOCS,
  FOR_YOU_V5_REEL_DECK_MAX_DOCS,
} from "../../constants/firestore-read-budgets.js";
import type { FeedForYouSimpleRepository, SimpleFeedCandidate, SimpleFeedSortMode } from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import { debugLog } from "../../lib/logging/debug-log.js";
import { reelTierBucketForCandidate, isForYouSimpleReel } from "./feed-for-you-simple-tier.js";

const SOFT_TTL_MS = 12 * 60 * 1000;
const HARD_TTL_MS = 45 * 60 * 1000;
const REFRESH_FAIL_COOLDOWN_MS = 30 * 1000;

export type ForYouV5ReadyDeckSnapshot = {
  deckVersion: number;
  loadedAtMs: number;
  randomMode: SimpleFeedSortMode;
  regularAnchor: number | string;
  reelTier5: SimpleFeedCandidate[];
  reelTier4: SimpleFeedCandidate[];
  reelOther: SimpleFeedCandidate[];
  regular: SimpleFeedCandidate[];
};

let memory: ForYouV5ReadyDeckSnapshot | null = null;
let lastRefreshFailedAtMs = 0;
let staleRefreshScheduled = false;

function splitReelTiers(reels: SimpleFeedCandidate[]): Pick<ForYouV5ReadyDeckSnapshot, "reelTier5" | "reelTier4" | "reelOther"> {
  const reelTier5: SimpleFeedCandidate[] = [];
  const reelTier4: SimpleFeedCandidate[] = [];
  const reelOther: SimpleFeedCandidate[] = [];
  for (const c of reels) {
    if (!isForYouSimpleReel(c)) continue;
    const b = reelTierBucketForCandidate(c);
    if (b === "tier_5") reelTier5.push(c);
    else if (b === "tier_4") reelTier4.push(c);
    else reelOther.push(c);
  }
  return { reelTier5, reelTier4, reelOther };
}

async function coldFillDeck(input: {
  repository: Pick<
    FeedForYouSimpleRepository,
    "fetchReelCandidatesForYouV5Deck" | "fetchRegularReservoirForYouV5Deck" | "resolveSortMode" | "fetchBatch"
  >;
}): Promise<{ snapshot: ForYouV5ReadyDeckSnapshot; dbReadEstimate: number }> {
  const started = Date.now();
  debugLog("feed", "FOR_YOU_V5_DECK_REFRESH_START", () => ({ reason: "cold_or_stale_fill" }));
  const mode = await input.repository.resolveSortMode();
  const regularAnchor = mode === "randomKey" ? Math.random() : randomBytes(10).toString("hex");
  const reels = await input.repository.fetchReelCandidatesForYouV5Deck(FOR_YOU_V5_REEL_DECK_MAX_DOCS);
  const tiers = splitReelTiers(reels);
  let regular: SimpleFeedCandidate[] = [];
  let regularReads = 0;
  if (mode === "randomKey") {
    const r = await input.repository.fetchRegularReservoirForYouV5Deck({ mode, anchor: regularAnchor });
    regular = r.items;
    regularReads = r.readCount;
  } else {
    const batch = await input.repository.fetchBatch({
      mode,
      anchor: regularAnchor,
      wrapped: false,
      lastValue: null,
      lastPostId: null,
      limit: Math.min(40, FOR_YOU_V5_REGULAR_RESERVOIR_MAX_DOCS),
      reelOnly: false,
    });
    regularReads = batch.readCount;
    regular = batch.items.filter((c) => !isForYouSimpleReel(c));
  }
  const deckVersion = (memory?.deckVersion ?? 0) + 1;
  const snapshot: ForYouV5ReadyDeckSnapshot = {
    deckVersion,
    loadedAtMs: Date.now(),
    randomMode: mode,
    regularAnchor,
    ...tiers,
    regular: regular.slice(0, FOR_YOU_V5_REGULAR_RESERVOIR_MAX_DOCS),
  };
  const dbReadEstimate = reels.length + regularReads;
  debugLog("feed", "FOR_YOU_V5_DECK_REFRESH_DONE", () => ({
    elapsedMs: Date.now() - started,
    deckVersion,
    reelTier5: snapshot.reelTier5.length,
    reelTier4: snapshot.reelTier4.length,
    reelOther: snapshot.reelOther.length,
    regular: snapshot.regular.length,
    dbReadEstimate,
  }));
  return { snapshot, dbReadEstimate };
}

function scheduleStaleRefresh(input: {
  repository: Pick<
    FeedForYouSimpleRepository,
    "fetchReelCandidatesForYouV5Deck" | "fetchRegularReservoirForYouV5Deck" | "resolveSortMode" | "fetchBatch"
  >;
}): void {
  if (staleRefreshScheduled) return;
  staleRefreshScheduled = true;
  setTimeout(() => {
    staleRefreshScheduled = false;
    void dedupeInFlight("for_you_v5:deck_refresh:bg", async () => {
      try {
        const { snapshot } = await coldFillDeck({ repository: input.repository });
        memory = snapshot;
      } catch (err) {
        lastRefreshFailedAtMs = Date.now();
        debugLog("feed", "FOR_YOU_V5_DECK_REFRESH_FAILED", () => ({
          message: err instanceof Error ? err.message : String(err),
        }));
      }
    });
  }, 0);
}

export function resetForYouV5ReadyDeckForTests(): void {
  memory = null;
  lastRefreshFailedAtMs = 0;
  staleRefreshScheduled = false;
}

/**
 * Bounded, singleflight in-memory deck for For You V5.
 *
 * **NOT** `ENABLE_FOR_YOU_REEL_POOL_WARMUP` / `pickForYouSimpleReelPoolPage` — that path caused extreme
 * Firestore reads when combined with per-request scans. This deck is TTL + singleflight bounded only.
 */
export async function ensureForYouV5ReadyDeck(input: {
  repository: Pick<
    FeedForYouSimpleRepository,
    "fetchReelCandidatesForYouV5Deck" | "fetchRegularReservoirForYouV5Deck" | "resolveSortMode" | "fetchBatch"
  >;
  forceRefresh?: boolean;
}): Promise<{
  snapshot: ForYouV5ReadyDeckSnapshot;
  cacheStatus: "memory_hit" | "stale_hit" | "cold_fill" | "refresh_failed";
  dbReadEstimate: number;
}> {
  const now = Date.now();
  const failCooldown = now - lastRefreshFailedAtMs < REFRESH_FAIL_COOLDOWN_MS;
  if (memory && !input.forceRefresh) {
    const age = now - memory.loadedAtMs;
    if (age < HARD_TTL_MS) {
      if (age < SOFT_TTL_MS) {
        return { snapshot: memory, cacheStatus: "memory_hit", dbReadEstimate: 0 };
      }
      if (!failCooldown) scheduleStaleRefresh({ repository: input.repository });
      return { snapshot: memory, cacheStatus: "stale_hit", dbReadEstimate: 0 };
    }
  }
  if (failCooldown && memory) {
    return { snapshot: memory, cacheStatus: "refresh_failed", dbReadEstimate: 0 };
  }
  try {
    const filled = await dedupeInFlight("for_you_v5:deck_refresh", () => coldFillDeck({ repository: input.repository }));
    memory = filled.snapshot;
    return { snapshot: filled.snapshot, cacheStatus: "cold_fill", dbReadEstimate: filled.dbReadEstimate };
  } catch (err) {
    lastRefreshFailedAtMs = Date.now();
    debugLog("feed", "FOR_YOU_V5_DECK_REFRESH_FAILED", () => ({
      message: err instanceof Error ? err.message : String(err),
    }));
    if (memory) {
      return { snapshot: memory, cacheStatus: "refresh_failed", dbReadEstimate: 0 };
    }
    throw err;
  }
}
