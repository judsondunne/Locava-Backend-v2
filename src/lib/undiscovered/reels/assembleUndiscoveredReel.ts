import type {
  CollectedReelInput,
  ReelCreator,
  ReelLocation,
  UndiscoveredReel,
} from "../../../contracts/surfaces/undiscovered-reels.contract.js";
import { buildReelAttribution } from "./buildReelAttribution.js";
import type { ReelLocationExtraction } from "./extractReelLocation.js";
import type { SpotMatch } from "./matchReelToSpot.js";
import { scoreReelQuality } from "./reelQuality.js";

/**
 * Assemble the final undiscoveredReels record from the pipeline outputs.
 * Location precedence: matched spot (exact) > AI coordinate guess > none.
 */
export function resolveReelLocation(
  extraction: ReelLocationExtraction,
  match: SpotMatch | null,
): ReelLocation {
  if (match) {
    return {
      extractedName: extraction.placeName,
      lat: match.candidate.lat,
      lng: match.candidate.lng,
      source: "spot_match",
      matchedSpotId: match.candidate.id,
      matchedSpotCollection: match.candidate.collection,
      // Confidence blends AI confidence with match strength.
      confidence: Number(Math.min(1, 0.5 * extraction.confidence + 0.5 * match.score).toFixed(2)),
    };
  }
  if (extraction.latGuess != null && extraction.lngGuess != null && extraction.confidence >= 0.5) {
    return {
      extractedName: extraction.placeName,
      lat: extraction.latGuess,
      lng: extraction.lngGuess,
      source: "ai_estimate",
      matchedSpotId: null,
      matchedSpotCollection: null,
      confidence: Number((extraction.confidence * 0.6).toFixed(2)),
    };
  }
  return {
    extractedName: extraction.placeName,
    lat: null,
    lng: null,
    source: "none",
    matchedSpotId: null,
    matchedSpotCollection: null,
    confidence: 0,
  };
}

export function assembleUndiscoveredReel(input: {
  reel: CollectedReelInput;
  extraction: ReelLocationExtraction;
  match: SpotMatch | null;
  region: string;
  /** Authoritative creator from Instagram's owner object; wins over input fields. */
  authoritativeCreator?: Partial<ReelCreator> | null;
  nowIso?: string;
}): UndiscoveredReel {
  const now = input.nowIso ?? new Date().toISOString();
  const reelUrl =
    input.reel.reelUrl ?? `https://www.instagram.com/reel/${input.reel.shortcode}/`;
  return {
    id: `reel_${input.reel.shortcode}`,
    kind: "undiscovered_reel",
    sourceCollection: "undiscoveredReels",
    region: input.region,
    shortcode: input.reel.shortcode,
    reelUrl,
    caption: input.reel.caption ?? "",
    videoUrl: input.reel.videoUrl ?? null,
    thumbnailUrl: input.reel.thumbnailUrl ?? null,
    creator: buildReelAttribution(input.reel, input.authoritativeCreator),
    location: resolveReelLocation(input.extraction, input.match),
    engagement: {
      playCount: input.reel.playCount ?? null,
      likeCount: input.reel.likeCount ?? null,
      commentCount: input.reel.commentCount ?? null,
    },
    qualityScore: scoreReelQuality(input.reel),
    reviewStatus: "candidate",
    createdAt: now,
    updatedAt: now,
  };
}
