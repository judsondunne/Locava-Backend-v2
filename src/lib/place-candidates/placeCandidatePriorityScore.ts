import { dedupeReasonStrings } from "./dedupeReasonStrings.js";
import { hasActualCemeterySignal, hasActualLowValueSignal } from "./placeCandidateActualSignals.js";
import type { PlaceCandidate } from "./types.js";

const STRONG_DESTINATION_NAME =
  /\b(falls?|gorge|notch|gap|pass|castle|quarry|beach|overlook|view|scenic|rock|cave|lighthouse|arboretum|botanic|state park|national park)\b/i;
const GENERIC_HILL = /\bhill\b/i;
const GENERIC_POND = /\bpond\b/i;
const GENERIC_RIVER = /\b(river|brook|creek|stream)\b/i;

function labelBlob(candidate: PlaceCandidate): string {
  return [candidate.name, ...(candidate.debug.matchedSourceCategories ?? []), ...(candidate.categories ?? [])]
    .join(" ")
    .toLowerCase();
}

export function computeLocavaPriorityScore(candidate: PlaceCandidate): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;
  const primary = candidate.primaryCategory;
  const blob = labelBlob(candidate);

  if (hasActualCemeterySignal(candidate)) {
    reasons.push("priority_block_cemetery");
    return { score: 0, reasons };
  }

  if (primary === "waterfall" || /\bwaterfall\b/i.test(blob)) {
    score += 28;
    reasons.push("priority_boost_waterfall");
  }
  if (primary === "cave" || /\bcave\b/i.test(blob)) {
    score += 26;
    reasons.push("priority_boost_cave");
  }
  if (primary === "beach" || /\bbeach\b/i.test(blob)) {
    score += 24;
    reasons.push("priority_boost_beach");
  }
  if (/\bgorge\b/i.test(blob)) {
    score += 24;
    reasons.push("priority_boost_gorge");
  }
  if (/\b(notch|gap|pass)\b/i.test(blob)) {
    score += 22;
    reasons.push("priority_boost_notch_gap_pass");
  }
  if (primary === "viewpoint" || /\b(overlook|viewpoint|scenic view)\b/i.test(blob)) {
    score += 20;
    reasons.push("priority_boost_viewpoint");
  }
  if (primary === "quarry" && !hasActualCemeterySignal(candidate)) {
    score += 18;
    reasons.push("priority_boost_quarry");
  }
  if (/\b(castle|ruins|lighthouse)\b/i.test(blob)) {
    score += 18;
    reasons.push("priority_boost_destination_name");
  }
  if (primary === "park" || primary === "nature") {
    score += 14;
    reasons.push("priority_boost_park");
  }
  if (primary === "hiking" || /\btrail\b/i.test(blob)) {
    score += 14;
    reasons.push("priority_boost_trail");
  }
  if (primary === "museum" || primary === "garden" || primary === "historic" || primary === "public_art") {
    score += 12;
    reasons.push("priority_boost_unique_attraction");
  }
  if (primary === "lake" || primary === "mountain") {
    score += 8;
    reasons.push("priority_boost_nature_feature");
  }

  if (STRONG_DESTINATION_NAME.test(candidate.name)) {
    score += 12;
    reasons.push("priority_boost_destination_name");
  }
  if (candidate.signals.isTourismLikely || /\btourist attraction\b/i.test(blob)) {
    score += 8;
    reasons.push("priority_boost_known_attraction");
  }
  if (candidate.signals.hasWikipedia) {
    score += 6;
    reasons.push("priority_boost_wikipedia");
  }

  const genericHill = GENERIC_HILL.test(candidate.name) && !STRONG_DESTINATION_NAME.test(candidate.name);
  const genericPond = GENERIC_POND.test(candidate.name) && !STRONG_DESTINATION_NAME.test(candidate.name);
  const genericRiver = GENERIC_RIVER.test(candidate.name) && !STRONG_DESTINATION_NAME.test(candidate.name);
  if (genericHill) {
    score -= 8;
    reasons.push("priority_downrank_generic_hill");
  }
  if (genericPond) {
    score -= 6;
    reasons.push("priority_downrank_generic_pond");
  }
  if (genericRiver) {
    score -= 6;
    reasons.push("priority_downrank_generic_river");
  }
  if (hasActualLowValueSignal(candidate)) {
    score -= 20;
    reasons.push("priority_downrank_low_value_actual_type");
  }
  if (
    !candidate.signals.hasWikipedia &&
    !candidate.signals.hasCommonsCategory &&
    !candidate.signals.hasImageField &&
    (candidate.mediaSignalScore ?? 0) === 0
  ) {
    score -= 2;
    reasons.push("priority_needs_media_signal");
  }

  const mediaBoost = candidate.mediaSignalScore ?? 0;
  if (mediaBoost > 0) {
    score += mediaBoost;
    reasons.push("priority_boost_commons_media");
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons: dedupeReasonStrings(reasons) };
}
