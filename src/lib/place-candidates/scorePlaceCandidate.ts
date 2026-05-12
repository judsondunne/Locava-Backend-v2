import { classifyPlaceCandidateTier } from "./classifyPlaceCandidateTier.js";
import type { PlaceCandidate } from "./types.js";

const HEAVY_BOOST = new Set([
  "waterfall",
  "cave",
  "beach",
  "viewpoint",
  "hiking",
  "park",
  "nature",
  "lake",
  "mountain",
  "quarry",
]);

const MODERATE_BOOST = new Set(["museum", "garden", "historic", "landmark", "covered_bridge", "public_art"]);

const DOWNRANK_PRIMARY = new Set(["cemetery", "town_area", "architecture", "other"]);

const GENERIC_NAME_PATTERNS = [
  /^unnamed/i,
  /^unknown/i,
  /^human settlement$/i,
  /^city of /i,
  /^town of /i,
  /^village of /i,
];

function labelBlob(candidate: PlaceCandidate): string {
  return [candidate.name, ...candidate.debug.matchedSourceCategories].join(" ").toLowerCase();
}

export function scorePlaceCandidate(candidate: PlaceCandidate): PlaceCandidate {
  const reasons: string[] = [];
  let score = 0;

  if (!candidate.signals.hasCoordinates) {
    reasons.push("missing_coordinates");
    const tiered = classifyPlaceCandidateTier({ ...candidate, locavaScore: 0, debug: { ...candidate.debug, scoreReasons: reasons } });
    return {
      ...candidate,
      locavaScore: 0,
      candidateTier: tiered.tier,
      debug: { ...candidate.debug, scoreReasons: reasons, tierReasons: tiered.tierReasons },
    };
  }

  score += 18;
  reasons.push("has_coordinates");

  if (candidate.signals.hasWikipedia) {
    score += 10;
    reasons.push("has_wikipedia");
  }
  if (candidate.signals.hasCommonsCategory) {
    score += 8;
    reasons.push("has_commons_category");
  }
  if (candidate.signals.hasImageField) {
    score += 6;
    reasons.push("has_image_field");
  }

  const primary = candidate.primaryCategory;
  if (primary && HEAVY_BOOST.has(primary)) {
    score += 28;
    reasons.push("boosted_outdoor_gem");
    if (["park", "nature", "lake", "mountain", "hiking"].includes(primary)) {
      score += 6;
      reasons.push("boosted_nature");
    }
  } else if (primary && MODERATE_BOOST.has(primary)) {
    score += 14;
    reasons.push("boosted_unique_attraction");
  }

  if (candidate.signals.isOutdoorLikely) {
    score += 10;
    reasons.push("outdoor_likely");
  }
  if (candidate.signals.isLandmarkLikely) {
    score += 4;
    reasons.push("landmark_likely");
  }
  if (candidate.signals.isTourismLikely) {
    score += 4;
    reasons.push("tourism_likely");
  }

  const blob = labelBlob(candidate);
  if (primary === "cemetery" || /\bcemetery\b/i.test(blob)) {
    score -= 24;
    reasons.push("downranked_cemetery");
  }
  if (/\bmonument\b/i.test(blob) || /\bmemorial\b/i.test(blob)) {
    score -= 12;
    reasons.push("downranked_generic_monument");
  }
  if (/\blaw office\b/i.test(blob) || /\bresidence\b/i.test(blob) || /\bhouse\b/i.test(blob)) {
    score -= 18;
    reasons.push("downranked_minor_architecture");
  }
  if (/\bbridge\b/i.test(blob) && !/\bcovered bridge\b/i.test(blob)) {
    score -= 8;
    reasons.push("downranked_generic_bridge");
  }
  if (candidate.signals.isTooGeneric || /\badministrative\b/i.test(blob)) {
    score -= 22;
    reasons.push("downranked_admin_like");
  }
  if (primary && DOWNRANK_PRIMARY.has(primary)) {
    score -= 10;
    reasons.push("downranked_low_value_category");
  }
  if (candidate.signals.isTooGeneric) {
    score -= 12;
    reasons.push("too_generic");
  }
  if (GENERIC_NAME_PATTERNS.some((pattern) => pattern.test(candidate.name.trim()))) {
    score -= 16;
    reasons.push("generic_name");
  } else if (candidate.name.trim().length >= 4) {
    score += 4;
    reasons.push("specific_name");
  }

  const locavaScore = Math.max(0, Math.min(100, Math.round(score)));
  const scored = { ...candidate, locavaScore, debug: { ...candidate.debug, scoreReasons: reasons } };
  const tiered = classifyPlaceCandidateTier(scored);
  if (tiered.tier === "A") reasons.push("tier_a_candidate");
  if (tiered.tier === "C") reasons.push("tier_c_low_priority");

  return {
    ...scored,
    candidateTier: tiered.tier,
    debug: { ...scored.debug, scoreReasons: reasons, tierReasons: tiered.tierReasons },
  };
}
