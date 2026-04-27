const QUALITY_WORDS = [
  "best",
  "top",
  "coolest",
  "cool",
  "fun",
  "great",
  "awesome",
  "amazing",
  "good",
] as const;

const QUALITY_CAP: Record<string, string> = {
  best: "Best",
  top: "Top",
  coolest: "Coolest",
  cool: "Cool",
  fun: "Fun",
  great: "Great",
  awesome: "Awesome",
  amazing: "Amazing",
  good: "Good",
};

export type PrefixStem =
  | "things_to_do"
  | "places"
  | "places_to"
  | "hikes"
  | "food_drink"
  | "broad"
  | null;

export type PrefixFrame = {
  rawQuery: string;
  normalized: string;
  quality: string;
  stem: PrefixStem;
  isEmpty: boolean;
  tokens: string[];
  tailAfterPlacesTo: string | null;
};

function capitalizeQuality(word: string): string {
  const lower = word.toLowerCase().trim();
  return QUALITY_CAP[lower] || lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function getPrefixFrame(query: string): PrefixFrame {
  const rawQuery = typeof query === "string" ? query : "";
  const normalized = rawQuery.trim().replace(/\s+/g, " ");
  const isEmpty = normalized.length === 0;
  const tokens = isEmpty ? [] : normalized.toLowerCase().split(/\s+/);
  const first = tokens[0] || "";
  const second = tokens[1] || "";

  let quality = "";
  let stem: PrefixStem = null;
  let tailAfterPlacesTo: string | null = null;

  let qualityLower = first && (QUALITY_WORDS as readonly string[]).includes(first) ? first : "";
  if (!qualityLower && first && first.length <= 4 && "best".startsWith(first)) {
    qualityLower = "best";
  }
  if (qualityLower) quality = capitalizeQuality(qualityLower);

  const lower = normalized.toLowerCase();
  const placesToFullMatch = lower.match(/places\s+to\s+(.+)$/);
  const placesToPartialMatch = lower.match(/places\s+t\s*$/);
  if (placesToFullMatch) {
    stem = "places_to";
    tailAfterPlacesTo = placesToFullMatch[1]?.trim() ?? "";
  } else if (placesToPartialMatch || lower.match(/places\s+to\s*$/)) {
    stem = "places_to";
    tailAfterPlacesTo = "";
  }

  if (
    !stem &&
    (first === "place" || first === "places" || /^place/.test(first))
  ) {
    stem = "places";
  }
  if (
    !stem &&
    qualityLower &&
    (second === "place" || second === "places" || /^place/.test(second))
  ) {
    stem = "places";
  }
  if (!stem && lower.match(/^(best|top|cool)\s+places?\s/)) stem = "places";
  if (!stem && lower.match(/^(best|top|cool)\s+p(l|la|lac|lace|laces)?\s/)) stem = "places";
  if (!stem && lower.match(/^(best|top|cool)\s+p\s/)) stem = "places";
  if (!stem && qualityLower && /^p(l|la|lac|lace|laces|place|places)?\s*$/.test(second)) stem = "places";
  if (!stem && qualityLower && second && /^p/.test(second) && second.length <= 7) stem = "places";

  if (
    !stem &&
    qualityLower &&
    (second === "things" || second === "thing" || /^thing/.test(second))
  ) {
    stem = "things_to_do";
  } else if (!qualityLower && (first === "things" || first === "thing" || /^thing/.test(first))) {
    stem = "things_to_do";
  } else if (lower.match(/^(best|top|cool)\s+things?\s/)) {
    stem = "things_to_do";
  } else if (lower.startsWith("things to do") || lower.startsWith("things to ")) {
    stem = "things_to_do";
  } else if (
    qualityLower &&
    (second === "hike" || second === "hikes" || second === "hiking" || /^hik/.test(second))
  ) {
    stem = "hikes";
  } else if (!qualityLower && (first === "hike" || first === "hikes" || first === "hiking" || /^hik/.test(first))) {
    stem = "hikes";
  } else if (
    qualityLower &&
    (second === "coffee" ||
      second === "cof" ||
      second === "brunch" ||
      second === "bars" ||
      second === "food" ||
      /^cof|^brun|^bar|^food/.test(second))
  ) {
    stem = "food_drink";
  } else if (
    !qualityLower &&
    (first === "coffee" ||
      first === "cof" ||
      first === "brunch" ||
      first === "bars" ||
      /^cof|^brun|^bar/.test(first))
  ) {
    stem = "food_drink";
  } else if (!stem && qualityLower && !second) {
    stem = "broad";
  }
  if (!stem && lower.match(/^(b|be|bes|best)\s*$/)) stem = "broad";

  return { rawQuery, normalized, quality, stem, isEmpty, tokens, tailAfterPlacesTo };
}

