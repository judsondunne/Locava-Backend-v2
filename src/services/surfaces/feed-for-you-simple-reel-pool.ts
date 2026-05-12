import type {
  FeedForYouSimpleRepository,
  SimpleFeedCandidate
} from "../../repositories/surfaces/feed-for-you-simple.repository.js";

// =====================================================================
// TEMP DISABLED: caused extreme Firebase read usage in Query Insights.
// Do not re-enable without bounded reads, rate limiting, and explicit approval.
// Disabled: 2026-05-12 (read containment emergency)
//
// Original behaviour: on backend startup (and again every 15 minutes), this
// module warmed an in-memory "reel pool" by running
//   posts.select(SIMPLE_FEED_SELECT_FIELDS)
//     .where("reel", "==", true)
//     .orderBy("time", "desc")
//     .limit(180).get()
// (with a fallback that could scan up to 600 posts). Query Insights linked
// the WHERE reel=? / LIMIT 180 fingerprint to ~135,408 reads / 868
// executions per day, and on cold starts these fire from every Cloud Run
// instance.
//
// The For You feed route is preserved (the per-request page query is hard
// capped at LIMIT 40 in feed-for-you-simple.repository.ts#fetchBatch) but
// the bulk warmup + pool-pick path is short-circuited until an opt-in env
// flag is set.
//
// Set ENABLE_FOR_YOU_REEL_POOL_WARMUP=true to re-enable; default is OFF.
// =====================================================================

const REEL_POOL_RUNTIME_ENABLED =
  process.env.ENABLE_FOR_YOU_REEL_POOL_WARMUP === "true";

let warnedReelPoolDisabled = false;
function warnReelPoolDisabledOnce(): void {
  if (warnedReelPoolDisabled) return;
  warnedReelPoolDisabled = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[feed-for-you-simple-reel-pool] reel pool warmup disabled " +
      "(TEMP_DISABLED_FIRESTORE_READ_CONTAINMENT). Set " +
      "ENABLE_FOR_YOU_REEL_POOL_WARMUP=true to re-enable.",
  );
}

export function startForYouSimpleReelPoolWarmup(
  _repository: Pick<FeedForYouSimpleRepository, "fetchReelPoolBootstrap">
): void {
  if (!REEL_POOL_RUNTIME_ENABLED) {
    warnReelPoolDisabledOnce();
    return;
  }
  // Disabled-by-default kill switch; original implementation removed.
  // No-op even when "enabled" until a bounded replacement ships.
}

export async function ensureForYouSimpleReelPoolWarm(
  _repository: Pick<FeedForYouSimpleRepository, "fetchReelPoolBootstrap">
): Promise<void> {
  if (!REEL_POOL_RUNTIME_ENABLED) {
    warnReelPoolDisabledOnce();
    return;
  }
  // Disabled-by-default kill switch; original implementation removed.
}

export async function pickForYouSimpleReelPoolPage(_input: {
  repository: Pick<FeedForYouSimpleRepository, "fetchReelPoolBootstrap">;
  viewerKey: string;
  limit: number;
  exclude: Set<string>;
  blockedAuthors: Set<string>;
  viewerId: string;
  radiusGate: (candidate: SimpleFeedCandidate) => boolean;
}): Promise<{ items: SimpleFeedCandidate[]; poolUsed: boolean }> {
  if (!REEL_POOL_RUNTIME_ENABLED) {
    warnReelPoolDisabledOnce();
    return { items: [], poolUsed: false };
  }
  return { items: [], poolUsed: false };
}

export function resetForYouSimpleReelPoolForTests(): void {
  // No-op; pool state is no longer maintained.
}
