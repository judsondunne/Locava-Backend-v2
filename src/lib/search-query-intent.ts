export type SearchIndexedPlaceLike = {
  text: string;
  cityRegionId: string;
  stateRegionId: string;
  searchKey: string;
  population: number;
  countryCode: string;
  stateName: string;
  lat: number | null;
  lng: number | null;
};

export type SearchActivityIntent = {
  canonical: string;
  label: string;
  matchedTerms: string[];
  queryActivities: string[];
  relatedActivities: string[];
};

export type SearchLocationIntent = {
  raw: string;
  normalized: string;
  relation: "in" | "near" | "implicit";
  place: SearchIndexedPlaceLike | null;
  stateName: string | null;
  stateRegionId: string | null;
  cityRegionId: string | null;
  displayText: string | null;
};

export type SearchQueryIntent = {
  rawQuery: string;
  normalizedQuery: string;
  displayQuery: string;
  nearMe: boolean;
  genericDiscovery: boolean;
  residualTokens: string[];
  activity: SearchActivityIntent | null;
  location: SearchLocationIntent | null;
  /** True when the query ends with an explicit place phrase such as "in boston" or "near san francisco". */
  hasExplicitLocation: boolean;
  /** Lowercase normalized explicit place token(s), e.g. "new york"; null when absent. */
  explicitLocationText: string | null;
  /** When present, explicit location metadata came from the query text (not geocoding). */
  locationModifierSource: "query" | null;
};

type ActivityDefinition = {
  canonical: string;
  label: string;
  terms: string[];
  queryActivities: string[];
  relatedActivities?: string[];
};

const LOCATION_ALIASES = [
  { alias: "philly", city: "Philadelphia", state: "Pennsylvania" },
  { alias: "philadelphia", city: "Philadelphia", state: "Pennsylvania" },
  { alias: "nyc", city: "New York", state: "New York" },
  { alias: "new york city", city: "New York", state: "New York" },
  { alias: "uvm", city: "Burlington", state: "Vermont" },
  // Common "city-only" query; treat as Burlington, VT to keep search/mixes stable.
  { alias: "burlington", city: "Burlington", state: "Vermont" },
  { alias: "upper valley", city: "Hanover", state: "New Hampshire" },
  { alias: "bay area", city: "San Francisco", state: "California" },
  { alias: "san francisco", city: "San Francisco", state: "California" },
] as const;

export const US_STATE_CODE_TO_NAME: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

const US_STATE_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATE_CODE_TO_NAME).map(([code, name]) => [
    normalizeSearchText(name),
    code,
  ]),
);

const ACTIVITY_DEFINITIONS: ActivityDefinition[] = [
  {
    canonical: "hiking",
    label: "Hiking",
    terms: ["hike", "hikes", "hiking", "trail", "trails", "trek", "treks"],
    queryActivities: ["hiking", "walking", "forest", "mountain", "views"],
    relatedActivities: ["walking", "forest", "mountain", "view", "views"],
  },
  {
    canonical: "biking",
    label: "Biking",
    terms: ["bike", "bikes", "biking", "bicycle", "bicycles", "cycling", "ride", "rides", "riding"],
    queryActivities: ["biking", "riding", "walking", "views"],
    relatedActivities: ["riding", "walking", "view"],
  },
  {
    canonical: "swimming",
    label: "Swimming",
    terms: ["swim", "swims", "swimming", "swimming hole", "swimming holes", "swimminghole", "water hole", "water holes"],
    queryActivities: ["swimming", "swimminghole", "waterfall", "beach", "river", "pond"],
    relatedActivities: ["swimminghole", "waterfall", "beach", "river", "pond"],
  },
  {
    canonical: "waterfall",
    label: "Waterfalls",
    terms: ["waterfall", "waterfalls", "falls", "cascade", "cascades"],
    queryActivities: ["waterfall", "swimminghole", "river", "hiking"],
    relatedActivities: ["swimminghole", "river", "hiking", "view"],
  },
  {
    canonical: "coffee",
    label: "Coffee",
    terms: ["coffee", "coffee shop", "coffee shops", "cafe", "cafes", "espresso", "latte"],
    queryActivities: ["cafe", "restaurants", "market", "shopping"],
    relatedActivities: ["cafe", "restaurants", "market", "shopping"],
  },
  {
    canonical: "pizza",
    label: "Pizza",
    terms: ["pizza", "pizzeria", "slice", "slices"],
    queryActivities: ["pizza", "restaurants"],
    relatedActivities: ["restaurants", "cafe"],
  },
  {
    canonical: "bookstore",
    label: "Bookstores",
    terms: ["bookstore", "bookstores", "book shop", "book shops", "bookshop", "books"],
    queryActivities: ["shopping", "market", "museum", "cafe"],
    relatedActivities: ["shopping", "market", "cafe"],
  },
  {
    canonical: "sunset",
    label: "Sunset",
    terms: ["sunset", "sunsets", "sunrise", "golden hour"],
    queryActivities: ["sunset", "view", "views", "beach", "mountain"],
    relatedActivities: ["view", "views", "beach", "mountain"],
  },
  {
    canonical: "view",
    label: "Scenic Views",
    terms: ["view", "views", "scenic", "vista", "vistas", "overlook", "overlooks", "viewpoint", "viewpoints"],
    queryActivities: ["view", "views", "sunset", "mountain", "rockformations"],
    relatedActivities: ["sunset", "mountain", "rockformations", "hiking"],
  },
  {
    canonical: "food",
    label: "Food",
    terms: ["food", "foods", "eat", "eats", "eating", "restaurant", "restaurants", "dining", "dinner", "lunch", "brunch"],
    queryActivities: ["restaurants", "cafe", "pizza", "market"],
    relatedActivities: ["restaurants", "cafe", "pizza", "market"],
  },
  {
    canonical: "trail",
    label: "Trails",
    terms: ["trail", "trails"],
    queryActivities: ["hiking", "walking", "biking"],
    relatedActivities: ["hiking", "walking", "biking"],
  },
  {
    canonical: "picnic",
    label: "Picnic",
    terms: ["picnic", "picnics"],
    queryActivities: ["park", "view", "beach"],
    relatedActivities: ["park", "view", "beach"],
  },
  {
    canonical: "abandoned",
    label: "Abandoned",
    terms: ["abandoned", "ruins", "ruin"],
    queryActivities: ["abandoned", "ruins", "historical"],
    relatedActivities: ["ruins", "historical", "castle"],
  },
  {
    canonical: "castle",
    label: "Castles",
    terms: ["castle", "castles"],
    queryActivities: ["castle", "historical", "ruins"],
    relatedActivities: ["historical", "ruins", "view"],
  },
  {
    canonical: "study",
    label: "Study Spots",
    terms: ["study", "studying", "study spot", "study spots"],
    queryActivities: ["cafe", "shopping", "market"],
    relatedActivities: ["cafe", "shopping"],
  },
  {
    canonical: "date",
    label: "Date Spots",
    terms: ["date", "dates", "date spot", "date spots"],
    queryActivities: ["sunset", "cafe", "restaurants", "view"],
    relatedActivities: ["sunset", "cafe", "restaurants", "view"],
  },
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "best",
  "cool",
  "do",
  "find",
  "for",
  "fun",
  "get",
  "go",
  "good",
  "in",
  "me",
  "my",
  "near",
  "of",
  "place",
  "places",
  "spot",
  "spots",
  "the",
  "things",
  "to",
]);

export function normalizeSearchText(input: string): string {
  return String(input ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function slugRegionPart(input: string): string {
  return String(input ?? "")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildStateRegionId(countryCode: string, stateName: string): string {
  const cc = String(countryCode ?? "").trim().toLowerCase() || "us";
  return `${cc}:${slugRegionPart(stateName).toLowerCase()}`;
}

export function buildCityRegionId(countryCode: string, stateName: string, cityName: string): string {
  const base = buildStateRegionId(countryCode, stateName);
  return `${base}:${slugRegionPart(cityName).toLowerCase()}`;
}

export function resolveStateNameFromAny(input: string): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (US_STATE_CODE_TO_NAME[upper]) return US_STATE_CODE_TO_NAME[upper];
  const normalized = normalizeSearchText(raw);
  if (US_STATE_NAME_TO_CODE[normalized]) {
    return US_STATE_CODE_TO_NAME[US_STATE_NAME_TO_CODE[normalized]] ?? null;
  }
  if (normalized.length < 2) return null;
  const prefixHit = Object.keys(US_STATE_NAME_TO_CODE).find((name) =>
    name.startsWith(normalized),
  );
  if (!prefixHit) return null;
  const stateCode = US_STATE_NAME_TO_CODE[prefixHit];
  if (!stateCode) return null;
  return US_STATE_CODE_TO_NAME[stateCode] ?? null;
}

export function extractResidualTokens(query: string): string[] {
  return normalizeSearchText(query)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function scoreActivityDefinition(normalizedQuery: string, definition: ActivityDefinition): number {
  let score = 0;
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  for (const term of definition.terms) {
    const normalizedTerm = normalizeSearchText(term);
    if (!normalizedTerm) continue;
    if (normalizedQuery === normalizedTerm) score += 120;
    else if (normalizedQuery.startsWith(normalizedTerm) || normalizedTerm.startsWith(normalizedQuery)) score += 70;
    else if (normalizedQuery.includes(normalizedTerm)) score += 45;
    else if (tokens.some((token) => normalizedTerm.startsWith(token) || token.startsWith(normalizedTerm))) score += 18;
  }
  return score;
}

export function resolveActivityIntent(query: string): SearchActivityIntent | null {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return null;
  const ranked = ACTIVITY_DEFINITIONS.map((definition) => ({
    definition,
    score: scoreActivityDefinition(normalizedQuery, definition),
  }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.definition.canonical.localeCompare(b.definition.canonical));
  const winner = ranked[0]?.definition;
  if (!winner) return null;
  return {
    canonical: winner.canonical,
    label: winner.label,
    matchedTerms: winner.terms.filter((term) => normalizedQuery.includes(normalizeSearchText(term))).slice(0, 4),
    queryActivities: [...winner.queryActivities],
    relatedActivities: [...(winner.relatedActivities ?? [])],
  };
}

export function resolveActivitySuggestions(query: string, limit = 6): SearchActivityIntent[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  return ACTIVITY_DEFINITIONS.map((definition) => ({
    definition,
    score: scoreActivityDefinition(normalizedQuery, definition),
  }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.definition.canonical.localeCompare(b.definition.canonical))
    .slice(0, Math.max(1, Math.min(12, limit)))
    .map(({ definition }) => ({
      canonical: definition.canonical,
      label: definition.label,
      matchedTerms: definition.terms.filter((term) => normalizeSearchText(term).startsWith(normalizedQuery)).slice(0, 4),
      queryActivities: [...definition.queryActivities],
      relatedActivities: [...(definition.relatedActivities ?? [])],
    }));
}

/** Tail anchor: explicit place after in/near/around/by (no geocoding required). */
const EXPLICIT_LOCATION_TAIL_RE =
  /\b(in|near|around|by)\s+([a-zA-Z][a-zA-Z\s.'-]{1,60})$/i;

const EXPLICIT_LOCATION_STOP_PHRASES = new Set([
  "here",
  "there",
  "my area",
  "this area",
  "the area",
]);

/**
 * Detects a trailing explicit location phrase ("in boston", "near san francisco", "by easton").
 * Returns normalized lowercase location tokens; excludes "near me" and generic non-place tails.
 */
export function parseExplicitLocationPhrase(rawQuery: string): {
  preposition: "in" | "near" | "around" | "by";
  explicitLocationText: string;
  rawLocationPhrase: string;
} | null {
  const s = String(rawQuery ?? "").trim();
  const m = s.match(EXPLICIT_LOCATION_TAIL_RE);
  if (!m) return null;
  const prepRaw = String(m[1] ?? "").toLowerCase();
  if (prepRaw !== "in" && prepRaw !== "near" && prepRaw !== "around" && prepRaw !== "by") return null;

  let rawLoc = String(m[2] ?? "")
    .trim()
    .replace(/[.,;:!?]+$/g, "")
    .trim();
  if (rawLoc.length < 2) return null;

  const normalizedLoc = normalizeSearchText(rawLoc);
  if (normalizedLoc.length < 2) return null;

  if (prepRaw === "near") {
    if (normalizedLoc === "me" || normalizedLoc.startsWith("me ")) return null;
  }

  if (EXPLICIT_LOCATION_STOP_PHRASES.has(normalizedLoc)) return null;
  if (/^my\s+area$/i.test(normalizedLoc)) return null;

  return {
    preposition: prepRaw as "in" | "near" | "around" | "by",
    explicitLocationText: normalizedLoc,
    rawLocationPhrase: rawLoc,
  };
}

/** Display title for explicit tail locations resolved without an indexed place row. */
export function formatExplicitLocationDisplay(normalizedLocation: string): string {
  const parts = normalizeSearchText(normalizedLocation).split(/\s+/).filter(Boolean);
  return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function resolveAliasPlace(query: string): SearchIndexedPlaceLike | null {
  const normalized = normalizeSearchText(query);
  const alias = LOCATION_ALIASES.find((row) => row.alias === normalized);
  if (!alias) return null;
  const stateRegionId = buildStateRegionId("US", alias.state);
  return {
    text: alias.city,
    cityRegionId: buildCityRegionId("US", alias.state, alias.city),
    stateRegionId,
    searchKey: normalizeSearchText(alias.city),
    population: 0,
    countryCode: "US",
    stateName: alias.state,
    lat: null,
    lng: null,
  };
}

export function resolveLocationIntent(
  query: string,
  resolvePlace?: (normalizedQuery: string) => SearchIndexedPlaceLike | null,
): SearchLocationIntent | null {
  const rawQuery = String(query ?? "").trim();
  const normalized = normalizeSearchText(rawQuery);
  if (!normalized) return null;

  const nearMe = /\bnear me\b|\bnearby\b|\bnear you\b/.test(normalized);
  if (nearMe) {
    return {
      raw: "near me",
      normalized: "near me",
      relation: "near",
      place: null,
      stateName: null,
      stateRegionId: null,
      cityRegionId: null,
      displayText: "Near me",
    };
  }

  const explicitPhrase = parseExplicitLocationPhrase(rawQuery);

  let normalizedLocation: string;
  let rawLocationForIntent: string;
  let fromStrictTail: boolean;
  let relationWord: "in" | "near" | "around" | "by";

  if (explicitPhrase) {
    fromStrictTail = true;
    normalizedLocation = explicitPhrase.explicitLocationText;
    rawLocationForIntent = explicitPhrase.rawLocationPhrase;
    relationWord = explicitPhrase.preposition;
  } else {
    const relationMatch = normalized.match(/\b(in|near|around|by)\s+(.+)$/);
    if (!relationMatch) return null;
    fromStrictTail = false;
    relationWord = String(relationMatch[1] ?? "in").toLowerCase() as "in" | "near" | "around" | "by";
    rawLocationForIntent = relationMatch[2] ?? "";
    normalizedLocation = normalizeSearchText(rawLocationForIntent);
    if (!normalizedLocation) return null;
  }

  const aliasPlace = resolveAliasPlace(normalizedLocation);
  const stateName = resolveStateNameFromAny(normalizedLocation);
  let directPlace = aliasPlace ?? resolvePlace?.(normalizedLocation) ?? null;

  // If the user is typing a prefix of a US state (ex: "ver" => "Vermont"),
  // prefer interpreting it as the state instead of snapping to a town match
  // (ex: Burlington, Vermont). This keeps generated collections stable and
  // avoids surprising "in Burlington" mixes before the user actually typed it.
  if (stateName) {
    const normalizedState = normalizeSearchText(stateName);
    const isPrefixOfState = normalizedLocation.length >= 2 && normalizedState.startsWith(normalizedLocation);
    const isFullState = normalizedLocation === normalizedState;
    if (isPrefixOfState && !isFullState) {
      directPlace = null;
    }
  }

  const relation: SearchLocationIntent["relation"] = relationWord === "near" ? "near" : "in";

  if (directPlace || stateName) {
    return {
      raw: rawLocationForIntent,
      normalized: normalizedLocation,
      relation,
      place: directPlace,
      stateName: directPlace?.stateName ?? stateName,
      stateRegionId:
        directPlace?.stateRegionId ??
        (stateName ? buildStateRegionId("US", stateName) : null),
      cityRegionId: directPlace?.cityRegionId ?? null,
      displayText:
        directPlace != null
          ? `${directPlace.text}, ${directPlace.stateName}`
          : stateName,
    };
  }

  // Typed location phrase without an index/state resolution — still explicit (ex: "in boston").
  if (fromStrictTail) {
    return {
      raw: rawLocationForIntent,
      normalized: normalizedLocation,
      relation,
      place: null,
      stateName: null,
      stateRegionId: null,
      cityRegionId: null,
      displayText: formatExplicitLocationDisplay(normalizedLocation),
    };
  }

  return null;
}

export function parseSearchQueryIntent(
  query: string,
  resolvePlace?: (normalizedQuery: string) => SearchIndexedPlaceLike | null,
): SearchQueryIntent {
  const rawQuery = String(query ?? "").trim();
  const normalizedQuery = normalizeSearchText(rawQuery);
  const nearMe = /\bnear me\b|\bnearby\b|\bnear you\b/.test(normalizedQuery);
  const explicitPhrase = parseExplicitLocationPhrase(rawQuery);
  const activity = resolveActivityIntent(rawQuery);
  const location = resolveLocationIntent(rawQuery, resolvePlace);
  const residualTokens = extractResidualTokens(
    normalizedQuery
      .replace(/\bnear me\b|\bnearby\b|\bnear you\b/g, " ")
      .replace(/\b(in|near|around|by)\s+[a-z0-9\s.'-]+$/g, " "),
  ).filter((token) => !activity?.matchedTerms.some((term) => normalizeSearchText(term) === token));
  const genericDiscovery = !activity && !location && residualTokens.length === 0;
  return {
    rawQuery,
    normalizedQuery,
    displayQuery: rawQuery,
    nearMe,
    genericDiscovery,
    residualTokens,
    activity,
    location:
      location && location.normalized === "near me"
        ? null
        : location,
    hasExplicitLocation: Boolean(explicitPhrase),
    explicitLocationText: explicitPhrase?.explicitLocationText ?? null,
    locationModifierSource: explicitPhrase ? "query" : null,
  };
}
