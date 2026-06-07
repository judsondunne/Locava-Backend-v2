import type { PlaceImageResult } from "../../types/places.js";
import { classifyPlaceImageQuality } from "../places/placeImageQualityFilter.js";

const PROMO_URL_PATTERNS = [
  /\/events(?:\/|$)/i,
  /\/event[_-]/i,
  /\/news(?:\/|$)/i,
  /\/calendar(?:\/|$)/i,
  /deadlines?[-_]?(?:and[-_])?decaf/i,
  /summer[-_]reading/i,
  /puzzle[-_]exchange/i,
  /raffle[-_]ticket/i,
  /reading[-_]program/i,
  /save[-_]the[-_]date/i,
];

const PROMO_GRAPHIC_PATTERNS = [
  /\bevents from\b/i,
  /\bpage \d+\b/i,
  /\bflyer\b/i,
  /\bposter\b/i,
  /\braffle\b/i,
  /\bticket stub\b/i,
  /\bpuzzle exchange\b/i,
  /\bsummer reading\b/i,
  /\breading program\b/i,
  /\bdeadlines?\b/i,
  /\bdecaf\b/i,
  /\bannouncement\b/i,
  /\bevent poster\b/i,
  /\bregistration\b/i,
  /\bsave the date\b/i,
  /\bcall for\b/i,
  /\bvolunteer needed\b/i,
  /\bnewsletter\b/i,
  /\bbrochure\b/i,
  /\bpromotional\b/i,
  /\bgraphic design\b/i,
  /\bclipart\b/i,
  /\bstock photo\b/i,
  /\bshutterstock\b/i,
  /\bgetty images\b/i,
];

export type PbfPhotoHeuristicRejectReason =
  | "promo_graphic_metadata"
  | "place_image_quality"
  | "suspect_portrait_only";

function metadataHaystack(result: PlaceImageResult): string {
  return `${result.caption} ${result.title ?? ""} ${result.sourceName} ${result.sourceUrl} ${result.imageUrl}`.toLowerCase();
}

/** Fast metadata pass before Gemini — drops obvious flyers/posters/stock. */
export function classifyPbfAssetPhotoHeuristic(result: PlaceImageResult): {
  acceptable: boolean;
  reason?: PbfPhotoHeuristicRejectReason;
} {
  const quality = classifyPlaceImageQuality(result);
  if (!quality.acceptable) {
    return { acceptable: false, reason: "place_image_quality" };
  }

  const haystack = metadataHaystack(result);
  for (const pattern of PROMO_URL_PATTERNS) {
    if (pattern.test(haystack)) {
      return { acceptable: false, reason: "promo_graphic_metadata" };
    }
  }
  for (const pattern of PROMO_GRAPHIC_PATTERNS) {
    if (pattern.test(haystack)) {
      return { acceptable: false, reason: "promo_graphic_metadata" };
    }
  }

  if (
    /wp-content\/uploads/i.test(haystack) &&
    /\.png(?:[?#]|$)/i.test(haystack) &&
    !/(exterior|building|facade|aerial|photo|image of|view of)/i.test(haystack)
  ) {
    return { acceptable: false, reason: "promo_graphic_metadata" };
  }

  return { acceptable: true };
}

export function filterHeuristicAcceptablePhotos(results: PlaceImageResult[]): PlaceImageResult[] {
  return results.filter((r) => classifyPbfAssetPhotoHeuristic(r).acceptable);
}
