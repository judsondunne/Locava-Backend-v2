import { hasActualCemeterySignal } from "./placeCandidateActualSignals.js";
import type { PlaceCandidate, PlaceCandidateTier } from "./types.js";

const B_PRIMARY = new Set(["museum", "garden", "historic", "landmark", "covered_bridge"]);

const C_PRIMARY = new Set(["cemetery", "town_area", "architecture", "campus", "food_drink", "other", "river"]);

const ADMIN_LABEL_PATTERNS = [
  /\bhuman settlement\b/i,
  /\badministrative\b/i,
  /\bcensus-designated place\b/i,
  /\bunincorporated\b/i,
  /\bcounty\b/i,
  /\btownship\b/i,
  /\bborough\b/i,
  /\bneighborhood\b/i,
  /\bcity hall\b/i,
  /\btown hall\b/i,
  /\bcourthouse\b/i,
];

const GENERIC_NAME_PATTERNS = [
  /^unnamed/i,
  /^unknown/i,
  /^human settlement$/i,
  /^city of /i,
  /^town of /i,
  /^village of /i,
];

function labelBlob(candidate: PlaceCandidate): string {
  return [candidate.name, ...candidate.debug.matchedSourceCategories, ...(candidate.categories || [])]
    .join(" ")
    .toLowerCase();
}

function hasStrongSourceSignals(candidate: PlaceCandidate): boolean {
  return (
    candidate.signals.hasWikipedia ||
    candidate.signals.hasCommonsCategory ||
    Boolean(candidate.signals.hasImageField)
  );
}

function isCoveredBridge(candidate: PlaceCandidate): boolean {
  return /\bcovered bridge\b/i.test(labelBlob(candidate));
}

function isGenericMonument(candidate: PlaceCandidate): boolean {
  const blob = labelBlob(candidate);
  if (!/\bmonument\b/i.test(blob) && !/\bmemorial\b/i.test(blob)) return false;
  if (/\bwar\b/i.test(blob) || /\bcivil rights\b/i.test(blob)) return false;
  return !candidate.signals.isOutdoorLikely && !hasStrongSourceSignals(candidate);
}

function isHistoricMarker(candidate: PlaceCandidate): boolean {
  return /\bhistoric marker\b/i.test(labelBlob(candidate)) || /\bmarker\b/i.test(candidate.name);
}

function isMinorArchitecture(candidate: PlaceCandidate): boolean {
  const blob = labelBlob(candidate);
  return (
    /\blaw office\b/i.test(blob) ||
    /\bresidence\b/i.test(blob) ||
    /\bhouse\b/i.test(blob) ||
    /\bhome\b/i.test(blob) ||
    /\bbuilding\b/i.test(blob)
  );
}

function isGenericBridge(candidate: PlaceCandidate): boolean {
  const blob = labelBlob(candidate);
  return /\bbridge\b/i.test(blob) && !isCoveredBridge(candidate);
}

function isDestinationName(candidate: PlaceCandidate): boolean {
  return /\b(falls?|gorge|notch|gap|pass|castle|quarry|beach|overlook|view|scenic|rock|cave|lighthouse|state park|national park)\b/i.test(
    candidate.name,
  );
}

function isGenericNatureFeature(candidate: PlaceCandidate): boolean {
  const blob = labelBlob(candidate);
  return (
    (/\bhill\b/i.test(candidate.name) || /\bpond\b/i.test(candidate.name) || /\b(river|brook|creek|stream)\b/i.test(candidate.name)) &&
    !isDestinationName(candidate) &&
    !hasStrongSourceSignals(candidate)
  );
}

export function classifyPlaceCandidateTier(candidate: PlaceCandidate): {
  tier: PlaceCandidateTier;
  tierReasons: string[];
} {
  const tierReasons: string[] = [];

  if (!candidate.signals.hasCoordinates) {
    tierReasons.push("missing_coordinates");
    return { tier: "REJECTED", tierReasons };
  }

  const blob = labelBlob(candidate);
  if (candidate.signals.isTooGeneric || ADMIN_LABEL_PATTERNS.some((pattern) => pattern.test(blob))) {
    tierReasons.push("admin_like_entity");
    return { tier: "REJECTED", tierReasons };
  }

  if (GENERIC_NAME_PATTERNS.some((pattern) => pattern.test(candidate.name.trim()))) {
    tierReasons.push("generic_name");
    return { tier: "REJECTED", tierReasons };
  }

  if (hasActualCemeterySignal(candidate) || candidate.primaryCategory === "cemetery" || /\bcemetery\b/i.test(blob)) {
    tierReasons.push("cemetery_low_priority");
    return { tier: "C", tierReasons };
  }

  if (["waterfall", "cave", "beach", "viewpoint", "hiking"].includes(candidate.primaryCategory ?? "")) {
    tierReasons.push("destination_outdoor_type");
    return { tier: "A", tierReasons };
  }

  if (/\bgorge\b/i.test(blob) || /\b(notch|gap|pass)\b/i.test(blob)) {
    tierReasons.push("destination_landform");
    return { tier: "A", tierReasons };
  }

  if (candidate.primaryCategory === "quarry" && !hasActualCemeterySignal(candidate)) {
    tierReasons.push(isDestinationName(candidate) || hasStrongSourceSignals(candidate) ? "notable_quarry" : "quarry_without_strong_signals");
    return { tier: isDestinationName(candidate) || hasStrongSourceSignals(candidate) ? "A" : "B", tierReasons };
  }

  if (
    (candidate.primaryCategory === "architecture" || candidate.primaryCategory === "historic" || candidate.primaryCategory === "landmark") &&
    (/\bcastle\b/i.test(blob) || /\bruins\b/i.test(blob) || /\blighthouse\b/i.test(blob))
  ) {
    tierReasons.push("castle_or_ruins");
    return { tier: "A", tierReasons };
  }

  if ((candidate.primaryCategory === "park" || candidate.primaryCategory === "nature") && (isDestinationName(candidate) || hasStrongSourceSignals(candidate))) {
    tierReasons.push("notable_park_or_protected_area");
    return { tier: "A", tierReasons };
  }

  if ((candidate.primaryCategory === "lake" || candidate.primaryCategory === "mountain") && (isDestinationName(candidate) || hasStrongSourceSignals(candidate))) {
    tierReasons.push("notable_nature_feature");
    return { tier: "A", tierReasons };
  }

  if (candidate.primaryCategory === "public_art" && hasStrongSourceSignals(candidate)) {
    tierReasons.push("unique_public_art");
    return { tier: "A", tierReasons };
  }

  if (isGenericNatureFeature(candidate)) {
    tierReasons.push("generic_nature_feature");
    return { tier: "C", tierReasons };
  }

  if (candidate.primaryCategory === "museum") {
    tierReasons.push("museum_candidate");
    return { tier: "B", tierReasons };
  }

  if (candidate.primaryCategory === "historic" && hasStrongSourceSignals(candidate)) {
    tierReasons.push("historic_site");
    return { tier: "B", tierReasons };
  }

  if (candidate.primaryCategory === "landmark" && hasStrongSourceSignals(candidate)) {
    tierReasons.push("notable_landmark");
    return { tier: "B", tierReasons };
  }

  if (candidate.primaryCategory === "garden" || /\barboretum\b/i.test(blob)) {
    tierReasons.push("garden_or_arboretum");
    return { tier: "B", tierReasons };
  }

  if (isCoveredBridge(candidate)) {
    tierReasons.push("covered_bridge");
    return { tier: "B", tierReasons };
  }

  if (isGenericMonument(candidate) || isHistoricMarker(candidate)) {
    tierReasons.push("generic_monument_or_marker");
    return { tier: "C", tierReasons };
  }

  if (isMinorArchitecture(candidate) || isGenericBridge(candidate)) {
    tierReasons.push("minor_architecture");
    return { tier: "C", tierReasons };
  }

  if (candidate.primaryCategory && C_PRIMARY.has(candidate.primaryCategory)) {
    tierReasons.push("low_priority_category");
    return { tier: "C", tierReasons };
  }

  if (candidate.primaryCategory && B_PRIMARY.has(candidate.primaryCategory)) {
    tierReasons.push("secondary_locava_category");
    return { tier: "B", tierReasons };
  }

  tierReasons.push("unclassified_keep_for_debug");
  return { tier: "C", tierReasons };
}
