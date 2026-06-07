import type { ParsedPlaceQuery, PlaceImageResult } from "../../types/places.js";

const US_STATE_ABBREVS: Record<string, string> = {
  vt: "vermont",
  nh: "new hampshire",
  ma: "massachusetts",
  ny: "new york",
  pa: "pennsylvania",
};

const REGION_CONTEXT_ALIASES: Record<string, string[]> = {
  ascutney: ["weathersfield", "windsor", "mount ascutney", "vermont"],
};

const FOREIGN_LOCATION_SIGNALS = [
  "iceland",
  "norway",
  "new zealand",
  "scotland",
  "california",
  "oregon",
  "washington state",
  "colorado",
  "utah",
  "montana",
  "tennessee",
  "north carolina",
  "wyoming",
  "grand teton",
  "big cottonwood",
  "placer county",
  "genesee valley",
  "yellowstone",
  "yosemite",
  "hawaii",
];

const TRUSTED_SOURCE_PATTERNS = [
  /wikimedia|wikipedia/i,
  /stateparks|nps\.gov/i,
  /waterfalls?\.com/i,
  /vermont/i,
  /\.gov\b/i,
  /alltrails/i,
  /worldwaterfalldatabase/i,
  /newenglandwaterfalls/i,
  /atlasobscura/i,
  /tripadvisor/i,
];

function significantWords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !["the", "and", "near", "for"].includes(word));
}

function metadataHaystack(result: PlaceImageResult): string {
  return `${result.caption} ${result.sourceName} ${result.sourceUrl} ${result.imageUrl}`.toLowerCase();
}

function expandRegionTokens(region: string): string[] {
  const tokens = new Set<string>();
  for (const part of region.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!part) continue;
    tokens.add(part);
    const expanded = US_STATE_ABBREVS[part];
    if (expanded) tokens.add(expanded);
    const aliases = REGION_CONTEXT_ALIASES[part];
    if (aliases) {
      for (const alias of aliases) tokens.add(alias);
    }
  }
  return [...tokens];
}

export function scoreAsRegion(label: string): number {
  const lower = label.toLowerCase();
  let score = 0;
  if (/\b(mt\.?|mount)\b/.test(lower)) score += 4;
  if (/\bvt\b|\bvermont\b/.test(lower)) score += 4;
  if (/\b(county|town|village|city|state)\b/.test(lower)) score += 2;
  if (/\b(north|south|east|west)\b/.test(lower) && /\bvt\b/.test(lower)) score += 2;
  for (const part of lower.split(/[^a-z0-9]+/)) {
    if (US_STATE_ABBREVS[part]) score += 3;
  }
  return score;
}

export function scoreAsFeature(label: string): number {
  const lower = label.toLowerCase();
  let score = 0;
  if (/\b(falls?|waterfall|cascade|gorge|spring)\b/.test(lower)) score += 4;
  if (/\b(trail|peak|summit|launch|overlook|bridge|museum|park)\b/.test(lower)) score += 2;
  if (/\bhang\s*glider\b/.test(lower)) score += 3;
  return score;
}

export function resolveRegionAndFeature(
  left: string,
  right: string,
): { region: string; feature: string } {
  const leftRegion = scoreAsRegion(left);
  const rightRegion = scoreAsRegion(right);
  const leftFeature = scoreAsFeature(left);
  const rightFeature = scoreAsFeature(right);

  const leftAsRegion = leftRegion + rightFeature * 0.5;
  const rightAsRegion = rightRegion + leftFeature * 0.5;

  if (leftAsRegion > rightAsRegion) {
    return { region: left, feature: right };
  }
  if (rightAsRegion > leftAsRegion) {
    return { region: right, feature: left };
  }

  return { region: left, feature: right };
}

function matchesFeature(result: PlaceImageResult, feature: string): boolean {
  const haystack = metadataHaystack(result);
  const words = significantWords(feature);
  if (words.length === 0) return true;
  const phrase = feature.trim().toLowerCase();
  if (phrase && haystack.includes(phrase)) return true;
  const matched = words.filter((word) => haystack.includes(word));
  return matched.length >= Math.max(1, Math.ceil(words.length * 0.75));
}

function looksLikeWrongRegion(result: PlaceImageResult, region: string): boolean {
  if (!region) return false;
  const haystack = metadataHaystack(result);
  const allowed = new Set(expandRegionTokens(region));
  for (const signal of FOREIGN_LOCATION_SIGNALS) {
    if (!haystack.includes(signal)) continue;
    const allowedHit = [...allowed].some((token) => token.length >= 4 && haystack.includes(token));
    if (!allowedHit) return true;
  }
  return false;
}

function matchesRegionScope(
  result: PlaceImageResult,
  region: string,
  feature?: string,
): boolean {
  const haystack = metadataHaystack(result);
  if (looksLikeWrongRegion(result, region)) return false;

  const regionLower = region.toLowerCase();
  if (
    feature &&
    haystack.includes("vermont") &&
    matchesFeature(result, feature) &&
    (regionLower.includes("ascutney") ||
      regionLower.includes("vt") ||
      regionLower.includes("vermont") ||
      /\bmount\b/.test(regionLower))
  ) {
    return true;
  }

  const tokens = expandRegionTokens(region);
  const regionHits = tokens.filter((token) => token.length >= 3 && haystack.includes(token));
  if (regionHits.length === 0) return false;

  const hasLocality = tokens.some(
    (token) =>
      token.length >= 5 &&
      !["vermont", "new", "hampshire", "york", "pennsylvania"].includes(token) &&
      haystack.includes(token),
  );
  if (hasLocality) return true;

  return regionHits.includes("vermont") || regionHits.includes("ascutney") || regionHits.includes("weathersfield");
}

export function matchesScopedFeature(
  result: PlaceImageResult,
  feature: string,
  region: string,
): boolean {
  if (matchesFeature(result, feature)) {
    return matchesRegionScope(result, region, feature);
  }

  const haystack = metadataHaystack(result);
  const words = significantWords(feature);
  if (words.length === 0) return matchesRegionScope(result, region, feature);

  const natureLike = /\b(falls?|waterfall|cascade|gorge|trail|launch|summit|peak)\b/.test(haystack);
  if (!natureLike) return false;
  if (!matchesRegionScope(result, region, feature)) return false;

  const overlap = words.filter((word) => haystack.includes(word));
  return overlap.length >= Math.max(1, Math.ceil(words.length * 0.5));
}

export function scoreLocationRelevance(
  result: PlaceImageResult,
  query: ParsedPlaceQuery,
): number {
  if (query.scoped && query.region && query.feature) {
    if (!matchesScopedFeature(result, query.feature, query.region)) return -1_000;
    let score = 10;
    if (matchesFeature(result, query.feature)) score += 6;
    if (matchesRegionScope(result, query.region, query.feature)) score += 8;
    return score;
  }

  const haystack = metadataHaystack(result);
  const terms = significantWords(query.searchQuery);
  if (terms.length === 0) return 1;

  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += term.length >= 5 ? 3 : 2;
    }
  }

  if (score === 0) return -1_000;
  return score;
}

export function scorePhotoAppeal(result: PlaceImageResult): number {
  let score = 0;
  const haystack = metadataHaystack(result);

  if (TRUSTED_SOURCE_PATTERNS.some((pattern) => pattern.test(haystack))) {
    score += 8;
  }

  const width = result.imageWidth ?? 0;
  const height = result.imageHeight ?? 0;
  const pixels = width * height;
  if (pixels >= 640 * 480) score += 10;
  else if (pixels >= 480 * 320) score += 6;
  else if (pixels >= 320 * 240) score += 3;
  else if (pixels > 0 && pixels < 200 * 150) score -= 6;

  if (/\b(thumb|thumbnail|icon|logo)\b/i.test(result.imageUrl)) score -= 8;
  if (/\b(view|scenic|overlook|summit|panorama|aerial|cascade|falls|waterfall|trail)\b/i.test(result.caption)) {
    score += 4;
  }

  if (/facebook|fbcdn|fbsbx|pinterest|pinimg/i.test(haystack)) score -= 100;

  return score;
}

export function rankPlaceImages(
  results: PlaceImageResult[],
  query: ParsedPlaceQuery,
): PlaceImageResult[] {
  return [...results].sort((a, b) => {
    const relevanceDiff = scoreLocationRelevance(b, query) - scoreLocationRelevance(a, query);
    if (relevanceDiff !== 0) return relevanceDiff;
    return scorePhotoAppeal(b) - scorePhotoAppeal(a);
  });
}

export function filterRelevantPlaceImages(
  results: PlaceImageResult[],
  query: ParsedPlaceQuery,
): PlaceImageResult[] {
  return results.filter((result) => scoreLocationRelevance(result, query) > 0);
}
