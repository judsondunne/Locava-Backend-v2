import { getPostModerationTier, type PostRecord } from "../../lib/posts/postFieldSelectors.js";
import type { SimpleFeedCandidate } from "../../repositories/surfaces/feed-for-you-simple.repository.js";
import type { ForYouSimpleServePhase } from "./feed-for-you-simple-cursor.js";

export type ReelTierBucket = "tier_5" | "tier_4" | "other";

export function isForYouSimpleReelFromRaw(raw: Record<string, unknown> | null | undefined): boolean {
  if (!raw || typeof raw !== "object") return false;
  if (raw.reel === true) return true;
  const classification = raw.classification;
  if (classification && typeof classification === "object") {
    return (classification as { reel?: unknown }).reel === true;
  }
  return false;
}

export function isForYouSimpleReel(candidate: SimpleFeedCandidate): boolean {
  if (candidate.reel === true) return true;
  return isForYouSimpleReelFromRaw(candidate.rawFirestore ?? null);
}

export function resolveModeratorTierFromRaw(raw: Record<string, unknown> | null | undefined): number | null {
  if (!raw || typeof raw !== "object") return null;
  return getPostModerationTier(raw as PostRecord);
}

export function resolveModeratorTierFromCandidate(candidate: SimpleFeedCandidate): number | null {
  if (typeof candidate.moderatorTier === "number" && Number.isFinite(candidate.moderatorTier)) {
    return Math.trunc(candidate.moderatorTier);
  }
  return resolveModeratorTierFromRaw(candidate.rawFirestore ?? null);
}

export function reelTierBucketForCandidate(candidate: SimpleFeedCandidate): ReelTierBucket {
  if (!isForYouSimpleReel(candidate)) return "other";
  const tier = resolveModeratorTierFromCandidate(candidate);
  if (tier === 5) return "tier_5";
  if (tier === 4) return "tier_4";
  return "other";
}

export function candidateMatchesServePhase(
  candidate: SimpleFeedCandidate,
  phase: ForYouSimpleServePhase
): boolean {
  switch (phase) {
    case "reel_tier_5":
      return isForYouSimpleReel(candidate) && reelTierBucketForCandidate(candidate) === "tier_5";
    case "reel_tier_4":
      return isForYouSimpleReel(candidate) && reelTierBucketForCandidate(candidate) === "tier_4";
    case "reel_other":
      return isForYouSimpleReel(candidate) && reelTierBucketForCandidate(candidate) === "other";
    case "fallback_normal":
      return !isForYouSimpleReel(candidate);
    default:
      return false;
  }
}
