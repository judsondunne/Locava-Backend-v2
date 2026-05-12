import type { PlaceCandidate } from "../place-candidates/types.js";

/**
 * Max distance (miles) from the place candidate pin for a located asset to anchor a staged post.
 * Mirrors product rules: tight for beaches/castles, wider for trails/parks.
 */
export function resolvePlaceDistanceCapMiles(candidate: PlaceCandidate): number {
  const blob = [
    candidate.primaryCategory ?? "",
    ...candidate.categories,
    candidate.name,
    ...(candidate.debug?.matchedSourceCategories ?? []),
  ]
    .join(" ")
    .toLowerCase();
  if (/\bwaterfall\b|\bfalls\b|\bwaterfalls\b/.test(blob)) return 3;
  if (/\bgorge\b|\bflume\b/.test(blob)) return 3;
  if (/\bbeach\b|\bcove\b|\bshore\b/.test(blob)) return 3;
  if (/\bcastle\b/.test(blob)) return 2;
  if (/\bquarry\b/.test(blob)) return 5;
  if (/\bviewpoint\b|\boverlook\b|\bscenic\b/.test(blob)) return 5;
  if (/\bmountain\b|\bpeak\b|\bsummit\b/.test(blob)) return 10;
  if (/\blake\b|\bpond\b/.test(blob)) return 10;
  if (/\btrail\b|\bpath\b/.test(blob)) return 25;
  if (/\bpark\b|\bpreserve\b|\bforest\b|\brecreation\b/.test(blob)) return 25;
  return 10;
}
