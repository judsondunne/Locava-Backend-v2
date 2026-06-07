import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import type { ParsedPlaceQuery } from "../../types/places.js";
import type { OsmPhotoQueryResult } from "./buildOsmSpecificPhotoQuery.js";

export type TargetPlaceIdentity = {
  canonicalName: string;
  requiredNameTokens: string[];
  optionalNameTokens: string[];
  categoryTokens: string[];
  townTokens: string[];
  stateTokens: string[];
  addressTokens: string[];
  nearbyContextTokens: string[];
  forbiddenGenericOnly: boolean;
  skipImageLookup: boolean;
  skipReason?: string;
};

const GENERIC_NAME_WORDS = new Set([
  "trail",
  "bridge",
  "park",
  "viewpoint",
  "shelter",
  "waterfall",
  "library",
  "road",
  "path",
  "connector",
  "loop",
  "mountain",
  "hill",
  "brook",
  "river",
  "pond",
  "area",
  "conservation",
  "covered",
  "state",
  "forest",
  "hiking",
  "unnamed",
  "swimming",
  "gorge",
  "falls",
  "summit",
  "peak",
  "museum",
  "cafe",
  "restaurant",
  "bookstore",
  "pavilion",
  "campground",
  "beach",
  "spring",
  "gazebo",
  "marina",
  "dam",
  "reservoir",
  "lake",
  "creek",
  "stream",
  "woods",
  "wilderness",
  "preserve",
  "sanctuary",
  "center",
  "centre",
  "station",
  "landing",
  "access",
  "picnic",
  "overlook",
  "scenic",
  "historic",
  "national",
  "recreation",
  "natural",
  "nature",
  "walk",
  "hike",
  "jump",
  "pool",
  "vermont",
  "vt",
]);

const GENERIC_ONLY_DISPLAY_NAMES = new Set([
  "unnamed hiking trail",
  "connector trail",
  "shelter",
  "viewpoint",
  "park",
  "picnic shelter",
  "pavilion",
  "picnic area",
  "water access",
  "swimming area",
  "campground",
  "summit",
  "waterfall",
  "spring",
  "beach",
  "playground",
  "hiking trail",
  "trail",
  "bridge",
  "unnamed trail",
]);

const CATEGORY_WORDS = [
  "bridge",
  "covered bridge",
  "waterfall",
  "trail",
  "library",
  "cafe",
  "restaurant",
  "bookstore",
  "swimming area",
  "park",
  "viewpoint",
  "summit",
  "peak",
  "museum",
  "gorge",
  "falls",
  "farm",
  "gazebo",
  "marina",
  "beach",
  "pavilion",
  "dam",
  "reservoir",
  "brook",
  "river",
  "pond",
  "jump",
  "pool",
];

const VT_TOWNS = [
  "quechee",
  "norwich",
  "woodstock",
  "hartford",
  "arlington",
  "shelburne",
  "burlington",
  "montpelier",
  "rutland",
  "stowe",
  "bennington",
  "manchester",
  "middlebury",
  "brattleboro",
  "waterbury",
  "warren",
  "granville",
  "taftsville",
  "ascutney",
  "hartland",
  "shaftsbury",
  "newfane",
  "ludlow",
  "killington",
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function cleanCanonicalName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function splitDistinctiveTokens(tokens: string[]): { required: string[]; optional: string[] } {
  const required: string[] = [];
  const optional: string[] = [];
  for (const token of tokens) {
    if (GENERIC_NAME_WORDS.has(token)) optional.push(token);
    else if (token.length >= 3) required.push(token);
  }
  return { required: [...new Set(required)], optional: [...new Set(optional)] };
}

function townWordInText(text: string, town: string): boolean {
  const escaped = town.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function extractTownTokens(...sources: string[]): string[] {
  const hay = sources.join(" ");
  const found = VT_TOWNS.filter((town) => townWordInText(hay, town));
  for (const source of sources) {
    for (const token of tokenize(source)) {
      if (VT_TOWNS.includes(token) && !found.includes(token)) found.push(token);
    }
  }
  return [...new Set(found)];
}

function extractCategoryTokens(displayName: string, primaryCategory?: string, activities?: string[]): string[] {
  const hay = `${displayName} ${primaryCategory ?? ""} ${(activities ?? []).join(" ")}`.toLowerCase();
  return CATEGORY_WORDS.filter((c) => hay.includes(c));
}

export function deriveTargetPlaceIdentityFromDoc(
  doc: PbfCopierPreviewDoc,
  query?: OsmPhotoQueryResult | null,
): TargetPlaceIdentity {
  const canonicalName = cleanCanonicalName(doc.displayName);
  const payload = doc.writePayload as { location?: { city?: string; state?: string; address?: string } } | undefined;
  const town = payload?.location?.city || doc.sourceTagSample?.["addr:city"] || "";
  const state = payload?.location?.state || doc.sourceTagSample?.["addr:state"] || "Vermont";
  const address = payload?.location?.address || "";

  const nameTokens = tokenize(canonicalName);
  const queryTokens = query ? query.tokens.map((t) => t.toLowerCase()) : [];
  const contextTokens = tokenize(
    [
      doc.primaryActivity,
      doc.primaryCategory,
      ...(doc.activities ?? []),
      ...(doc.warnings ?? []),
      query?.query ?? "",
    ]
      .filter(Boolean)
      .join(" "),
  );

  const merged = [...new Set([...nameTokens, ...queryTokens, ...contextTokens])];
  const { required, optional } = splitDistinctiveTokens(merged);
  const townFromMerged = required.filter((t) => VT_TOWNS.includes(t) && !nameTokens.includes(t));
  const requiredNameTokens = required.filter((t) => !VT_TOWNS.includes(t) || nameTokens.includes(t));

  const townTokens = [...new Set([...extractTownTokens(town, query?.query ?? "", canonicalName), ...townFromMerged])];
  const stateTokens = ["vermont", "vt"];
  if (state.toLowerCase().includes("vermont")) stateTokens.push("vermont");

  const categoryTokens = extractCategoryTokens(canonicalName, doc.primaryCategory, doc.activities);
  const addressTokens = tokenize(address);
  const nearbyContextTokens = contextTokens.filter((t) => !GENERIC_NAME_WORDS.has(t) && !requiredNameTokens.includes(t));

  const normalizedDisplay = canonicalName.toLowerCase();
  const forbiddenGenericOnly =
    GENERIC_ONLY_DISPLAY_NAMES.has(normalizedDisplay) ||
    (normalizedDisplay === "covered bridge" && requiredNameTokens.length === 0);
  const hasDistinctive = requiredNameTokens.length > 0;
  const hasStrongContext =
    townTokens.length > 0 ||
    nearbyContextTokens.length >= 2 ||
    (query?.confidenceHints ?? []).some((h) => h.startsWith("town:") || h.startsWith("park:") || h.startsWith("trail:"));

  let skipImageLookup = false;
  let skipReason: string | undefined;
  if (forbiddenGenericOnly && !hasDistinctive && !hasStrongContext) {
    skipImageLookup = true;
    skipReason = "generic_display_name_only";
  } else if (!hasDistinctive && !hasStrongContext) {
    skipImageLookup = true;
    skipReason = "no_distinctive_name_tokens";
  }

  return {
    canonicalName,
    requiredNameTokens,
    optionalNameTokens: optional,
    categoryTokens,
    townTokens,
    stateTokens,
    addressTokens,
    nearbyContextTokens,
    forbiddenGenericOnly,
    skipImageLookup,
    skipReason,
  };
}

export function deriveTargetPlaceIdentityFromParsedQuery(query: ParsedPlaceQuery): TargetPlaceIdentity {
  const canonicalName = cleanCanonicalName(query.displayName);
  const searchTokens = tokenize(query.searchQuery);
  const displayTokens = tokenize(canonicalName);
  const regionTokens = query.region ? tokenize(query.region) : [];
  const featureTokens = query.feature ? tokenize(query.feature) : [];
  const merged = [...new Set([...displayTokens, ...searchTokens, ...featureTokens])];
  const { required, optional } = splitDistinctiveTokens(merged);
  const townFromMerged = required.filter((t) => VT_TOWNS.includes(t) && !displayTokens.includes(t));
  const requiredNameTokens = required.filter((t) => !VT_TOWNS.includes(t) || displayTokens.includes(t));

  const townTokens = [...new Set([...extractTownTokens(query.searchQuery, query.region ?? "", canonicalName), ...townFromMerged])];
  const categoryTokens = extractCategoryTokens(
    query.feature ?? query.displayName,
    undefined,
    featureTokens,
  );

  const normalizedDisplay = canonicalName.toLowerCase();
  const forbiddenGenericOnly =
    GENERIC_ONLY_DISPLAY_NAMES.has(normalizedDisplay) ||
    (normalizedDisplay === "covered bridge" && requiredNameTokens.length === 0);
  const hasDistinctive = requiredNameTokens.length > 0;
  const hasStrongContext = townTokens.length > 0 || (query.scoped && featureTokens.length > 0);

  let skipImageLookup = false;
  let skipReason: string | undefined;
  if (forbiddenGenericOnly && !hasDistinctive && !hasStrongContext) {
    skipImageLookup = true;
    skipReason = "generic_display_name_only";
  } else if (!hasDistinctive && !hasStrongContext && !query.scoped) {
    skipImageLookup = true;
    skipReason = "no_distinctive_name_tokens";
  }

  return {
    canonicalName,
    requiredNameTokens,
    optionalNameTokens: optional,
    categoryTokens,
    townTokens,
    stateTokens: ["vermont", "vt"],
    addressTokens: [],
    nearbyContextTokens: [...regionTokens, ...featureTokens].filter((t) => !required.includes(t)),
    forbiddenGenericOnly,
    skipImageLookup,
    skipReason,
  };
}
