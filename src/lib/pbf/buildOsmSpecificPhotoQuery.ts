import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";

export const MIN_QUERY_SPECIFICITY_SCORE = 14;

export type OsmPhotoQueryResult = {
  query: string;
  tokens: string[];
  confidenceHints: string[];
  querySpecificityScore: number;
  skip: boolean;
  skipReason?: string;
};

const GENERIC_DISPLAY_NAMES = new Set([
  "shelter",
  "picnic shelter",
  "pavilion",
  "park",
  "viewpoint",
  "picnic area",
  "water access",
  "swimming area",
  "campground",
  "summit",
  "waterfall",
  "spring",
  "beach",
  "playground",
  "connector trail",
  "unnamed hiking trail",
  "hiking trail",
  "trail",
  "bridge",
]);

const CATEGORY_SEARCH_WORDS: Record<string, string> = {
  covered_bridge: "covered bridge",
  bridge: "bridge",
  hiking: "trail",
  hiking_trail: "trail",
  trail: "trail",
  waterfall: "waterfall",
  viewpoint: "viewpoint",
  swimming: "swimming area",
  beach: "beach",
  summit: "summit",
  peak: "peak",
  park: "park",
  restaurant: "restaurant",
  cafe: "cafe",
  bookstore: "bookstore",
  train_bridge: "train bridge",
  rail_bridge: "train bridge",
  bookstore_shop: "bookstore",
};

const JUNK_NAME_PATTERNS = [
  /^highway=/i,
  /^route=/i,
  /^unnamed\s/i,
  /^connector\s+trail$/i,
  /^unnamed\s+hiking\s+trail$/i,
];

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function tagValue(doc: PbfCopierPreviewDoc, key: string): string | undefined {
  const fromSample = doc.sourceTagSample?.[key]?.trim();
  if (fromSample) return fromSample;
  const payload = doc.writePayload as Record<string, unknown> | undefined;
  const source = payload?.source as { tags?: Record<string, string> } | undefined;
  const fromPayload = source?.tags?.[key]?.trim();
  return fromPayload || undefined;
}

function payloadLocationField(
  doc: PbfCopierPreviewDoc,
  field: "city" | "state" | "address",
): string | undefined {
  const payload = doc.writePayload as { location?: Record<string, string> } | undefined;
  const value = payload?.location?.[field]?.trim();
  return value || undefined;
}

function parseIsInTown(isIn: string | undefined): string | undefined {
  if (!isIn) return undefined;
  const parts = isIn
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  const town = parts[0];
  if (!town || /vermont|vt|usa|united states/i.test(town)) return undefined;
  return town;
}

const TOWN_INFERENCE_STOP_WORDS = new Set([
  "historic",
  "marker",
  "monument",
  "museum",
  "memorial",
  "library",
  "battle",
  "covered",
  "free",
  "state",
  "national",
  "park",
  "trail",
  "vermont",
  "tavern",
  "restaurant",
  "cafe",
  "bridge",
  "connector",
  "pond",
  "lake",
  "falls",
  "waterfall",
  "viewpoint",
  "summit",
  "hill",
  "road",
  "street",
  "avenue",
  "warner",
  "seth",
]);

/** Landmark / POI titles embed person or feature names — never treat those tokens as towns. */
const LANDMARK_TITLE_PATTERN =
  /\b(site|shelter|monument|memorial|marker|ruins|homestead|historic|cemetery|lookout|overlook|campground|campsite|camp\s+site)\b/i;

function inferTownFromDisplayName(displayName: string): string | undefined {
  if (isWeakDisplayName(displayName)) return undefined;
  if (LANDMARK_TITLE_PATTERN.test(displayName)) return undefined;
  const words = displayName.match(/\b[A-Z][a-z]{3,}\b/g) ?? [];
  for (const word of words) {
    if (TOWN_INFERENCE_STOP_WORDS.has(word.toLowerCase())) continue;
    if (word.length >= 5) return word;
  }
  return undefined;
}

function extractTown(doc: PbfCopierPreviewDoc): string | undefined {
  const candidates = [
    tagValue(doc, "addr:city"),
    parseIsInTown(tagValue(doc, "is_in")),
    payloadLocationField(doc, "city"),
    doc.attachedTo?.displayName,
    inferTownFromDisplayName(doc.displayName?.trim() ?? ""),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const cleaned = candidate.trim();
    if (cleaned.length >= 3 && !/vermont|vt\b/i.test(cleaned)) return cleaned;
  }
  return undefined;
}

function extractState(doc: PbfCopierPreviewDoc): string {
  const fromTag = tagValue(doc, "addr:state");
  const fromPayload = payloadLocationField(doc, "state");
  const raw = (fromTag || fromPayload || "Vermont").trim();
  if (/^vt$/i.test(raw)) return "Vermont";
  return raw;
}

function extractCountry(doc: PbfCopierPreviewDoc): string {
  const fromTag = tagValue(doc, "addr:country");
  const payload = doc.writePayload as { location?: { country?: string } } | undefined;
  const fromPayload = payload?.location?.country?.trim();
  const raw = (fromTag || fromPayload || "United States").trim();
  if (/^us$/i.test(raw) || /^usa$/i.test(raw)) return "United States";
  return raw;
}

function extractAddress(doc: PbfCopierPreviewDoc): string | undefined {
  const housenumber = tagValue(doc, "addr:housenumber");
  const street = tagValue(doc, "addr:street");
  if (housenumber && street) return `${housenumber} ${street}`;
  const payloadAddress = payloadLocationField(doc, "address");
  if (payloadAddress && street && payloadAddress.includes(street)) return payloadAddress;
  if (street && street.length >= 4) return street;
  return payloadAddress;
}

function extractNearbyContext(doc: PbfCopierPreviewDoc): string[] {
  const hints: string[] = [];
  const tags = doc.sourceTagSample ?? {};
  for (const key of ["operator", "brand", "network", "ref"]) {
    const value = tags[key]?.trim();
    if (value && value.length >= 3) hints.push(value);
  }
  for (const key of ["natural", "waterway", "leisure", "boundary"]) {
    const value = tags[key]?.trim();
    if (value && !["yes", "no"].includes(value.toLowerCase())) {
      hints.push(value.replace(/_/g, " "));
    }
  }
  if (doc.attachedTo?.displayName) hints.push(doc.attachedTo.displayName);
  const parent = (doc.writePayload as { parentPlaceName?: string } | undefined)?.parentPlaceName;
  if (parent?.trim()) hints.push(parent.trim());

  const support = doc.supportMetadata;
  if (support) {
    for (const bucket of Object.values(support)) {
      if (!Array.isArray(bucket)) continue;
      for (const item of bucket.slice(0, 2)) {
        if (item.displayName?.trim()) hints.push(item.displayName.trim());
      }
    }
  }
  return [...new Set(hints.map((h) => h.trim()).filter((h) => h.length >= 3))].slice(0, 3);
}

function isWeakDisplayName(name: string): boolean {
  const key = normalizeKey(name);
  if (!key) return true;
  if (GENERIC_DISPLAY_NAMES.has(key)) return true;
  return JUNK_NAME_PATTERNS.some((pattern) => pattern.test(name.trim()));
}

function isRawGeneratedName(name: string): boolean {
  return /^highway=\S+/i.test(name.trim()) || /^route=\S+/i.test(name.trim());
}

function cleanDisplayName(name: string): string {
  let cleaned = name.trim();
  cleaned = cleaned.replace(/^highway=\S+\s*/i, "");
  cleaned = cleaned.replace(/^route=\S+\s*/i, "");
  return cleaned.trim() || name.trim();
}

function categorySearchWord(doc: PbfCopierPreviewDoc): string | undefined {
  const display = doc.displayName.toLowerCase();
  if (/\bcovered bridge\b/.test(display)) return "covered bridge";
  if (/\btrain bridge\b/.test(display) || /\brailroad bridge\b/.test(display)) return "train bridge";
  if (/\bwaterfall\b/.test(display)) return "waterfall";
  if (/\bswimming area\b/.test(display)) return "swimming area";

  const keys = [
    doc.primaryCategory,
    doc.explicitTagCategory,
    doc.primaryActivity,
    ...(doc.activities ?? []),
  ].filter(Boolean) as string[];

  for (const key of keys) {
    const normalized = normalizeKey(key).replace(/\s+/g, "_");
    const mapped = CATEGORY_SEARCH_WORDS[normalized] ?? CATEGORY_SEARCH_WORDS[normalizeKey(key)];
    if (mapped) return mapped;
  }

  if (doc.kind === "unexplored_route") return "trail";
  if (/\bbridge\b/i.test(doc.displayName)) return "bridge";
  if (/\bbookstore\b/i.test(doc.displayName)) return "bookstore";
  if (/\brestaurant\b/i.test(doc.displayName) || /\bcafe\b/i.test(doc.displayName)) {
    return /\bcafe\b/i.test(doc.displayName) ? "cafe" : "restaurant";
  }
  return undefined;
}

function isStrongProperPlaceName(displayName: string): boolean {
  const lower = displayName.toLowerCase();
  const nameWords = lower.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  if (nameWords.length < 2) return false;
  return /\b(mountain|hill|summit|falls|waterfall|gorge|bridge|museum|library|cemetery|park|trail|lake|pond|swimming|viewpoint|homestead|mill|store|brewing|airport|covered|village|center|centre)\b/.test(
    lower,
  );
}

function scoreSpecificity(parts: {
  displayName: string;
  town?: string;
  state: string;
  categoryWord?: string;
  nearby: string[];
  address?: string;
  weakName: boolean;
}): number {
  let score = 0;
  const nameWords = parts.displayName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  if (nameWords.length >= 2) score += 6;
  else if (nameWords.length === 1 && !parts.weakName) score += 4;
  else if (!parts.weakName) score += 2;

  if (!parts.weakName && isStrongProperPlaceName(parts.displayName)) score += 4;
  if (parts.town) score += 5;
  if (parts.state) score += 2;
  if (parts.categoryWord) score += 3;
  if (parts.nearby.length > 0) score += 3;
  if (parts.address) score += 2;
  if (parts.weakName && !parts.town && parts.nearby.length === 0) score -= 8;
  return score;
}

export function buildOsmSpecificPhotoQuery(doc: PbfCopierPreviewDoc): OsmPhotoQueryResult {
  const confidenceHints: string[] = [];
  const rawName = doc.displayName?.trim() ?? "";
  if (isRawGeneratedName(rawName)) {
    return {
      query: "",
      tokens: [],
      confidenceHints: [],
      querySpecificityScore: 0,
      skip: true,
      skipReason: "query_too_generic",
    };
  }
  const displayName = cleanDisplayName(rawName);
  const weakName = isWeakDisplayName(displayName);
  const town = extractTown(doc);
  const state = extractState(doc);
  const country = extractCountry(doc);
  const address = extractAddress(doc);
  const nearby = extractNearbyContext(doc);
  const categoryWord = categorySearchWord(doc);

  if (town) confidenceHints.push(`town:${town}`);
  if (state) confidenceHints.push(`state:${state}`);
  if (country) confidenceHints.push(`country:${country}`);
  if (categoryWord) confidenceHints.push(`category:${categoryWord}`);
  for (const hint of nearby) confidenceHints.push(`nearby:${hint}`);
  if (address) confidenceHints.push(`address:${address}`);

  if (weakName && !town && nearby.length === 0) {
    return {
      query: "",
      tokens: [],
      confidenceHints,
      querySpecificityScore: 0,
      skip: true,
      skipReason: "query_too_generic_no_town",
    };
  }

  const segments: string[] = [];
  if (displayName && !isRawGeneratedName(displayName)) {
    if (isStrongProperPlaceName(displayName)) {
      segments.push(`"${displayName}"`);
    } else {
      segments.push(displayName);
    }
  } else if (!weakName) {
    segments.push(displayName);
  }

  if (categoryWord && !displayName.toLowerCase().includes(categoryWord.toLowerCase())) {
    segments.push(categoryWord);
  }

  if (doc.kind === "unexplored_route" && town) {
    if (!segments.some((s) => s.toLowerCase().includes("trail"))) {
      segments.push("trail");
    }
  }

  if (weakName && nearby.length > 0) {
    segments.push(nearby[0]!);
  }

  if (town) segments.push(town);
  if (state) segments.push(state);
  if (country) segments.push(country);

  if (!weakName && address && address.length <= 48) {
    segments.push(address);
  }

  if (weakName && nearby.length > 1) {
    segments.push(nearby[1]!);
  }

  const query = [...new Set(segments.map((s) => s.trim()).filter(Boolean))].join(" ");
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);

  const querySpecificityScore = scoreSpecificity({
    displayName,
    town,
    state,
    categoryWord,
    nearby,
    address,
    weakName,
  });

  if (!query || querySpecificityScore < MIN_QUERY_SPECIFICITY_SCORE) {
    return {
      query,
      tokens,
      confidenceHints,
      querySpecificityScore,
      skip: true,
      skipReason: "query_too_generic",
    };
  }

  return {
    query,
    tokens,
    confidenceHints,
    querySpecificityScore,
    skip: false,
  };
}
