import { createHash } from "node:crypto";
import type { UsStatePlaceConfig } from "./statePlaceCandidateConfig.js";
import type { PlaceCandidate, WikidataRawPlaceCandidate } from "./types.js";

const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\bstate park\b/i, category: "park" },
  { pattern: /\bnational park\b/i, category: "park" },
  { pattern: /\bpark\b/i, category: "park" },
  { pattern: /\bnature reserve\b/i, category: "nature" },
  { pattern: /\bprotected area\b/i, category: "nature" },
  { pattern: /\bwaterfall\b/i, category: "waterfall" },
  { pattern: /\bquarry\b/i, category: "quarry" },
  { pattern: /\bcovered bridge\b/i, category: "covered_bridge" },
  { pattern: /\blake\b/i, category: "lake" },
  { pattern: /\briver\b/i, category: "river" },
  { pattern: /\bmountain\b/i, category: "mountain" },
  { pattern: /\bsummit\b/i, category: "mountain" },
  { pattern: /\btrail\b/i, category: "hiking" },
  { pattern: /\bbeach\b/i, category: "beach" },
  { pattern: /\bcave\b/i, category: "cave" },
  { pattern: /\bviewpoint\b/i, category: "viewpoint" },
  { pattern: /\bscenic overlook\b/i, category: "viewpoint" },
  { pattern: /\bgarden\b/i, category: "garden" },
  { pattern: /\barboretum\b/i, category: "garden" },
  { pattern: /\bmuseum\b/i, category: "museum" },
  { pattern: /\bhistoric district\b/i, category: "historic" },
  { pattern: /\bhistoric site\b/i, category: "historic" },
  { pattern: /\bmonument\b/i, category: "landmark" },
  { pattern: /\bbridge\b/i, category: "architecture" },
  { pattern: /\blighthouse\b/i, category: "landmark" },
  { pattern: /\bcastle\b/i, category: "architecture" },
  { pattern: /\bruins\b/i, category: "historic" },
  { pattern: /\bcemetery\b/i, category: "cemetery" },
  { pattern: /\btourist attraction\b/i, category: "landmark" },
  { pattern: /\blandmark\b/i, category: "landmark" },
  { pattern: /\bpublic art\b/i, category: "public_art" },
  { pattern: /\bsculpture\b/i, category: "public_art" },
  { pattern: /\bcampus\b/i, category: "campus" },
  { pattern: /\bbuilding\b/i, category: "architecture" },
  { pattern: /\brestaurant\b/i, category: "food_drink" },
  { pattern: /\bcity\b/i, category: "town_area" },
  { pattern: /\btown\b/i, category: "town_area" },
  { pattern: /\bvillage\b/i, category: "town_area" },
];

const GENERIC_PATTERNS = [
  /\bhuman settlement\b/i,
  /\badministrative\b/i,
  /\bcensus-designated place\b/i,
  /\bunincorporated\b/i,
  /\bcounty\b/i,
  /\btownship\b/i,
  /\bborough\b/i,
  /\bneighborhood\b/i,
  /\broad\b/i,
  /\bstreet\b/i,
];

const PRIMARY_CATEGORY_PRIORITY = [
  "waterfall",
  "viewpoint",
  "cave",
  "hiking",
  "beach",
  "park",
  "nature",
  "lake",
  "river",
  "mountain",
  "quarry",
  "garden",
  "historic",
  "landmark",
  "public_art",
  "museum",
  "covered_bridge",
  "architecture",
  "cemetery",
  "campus",
  "food_drink",
  "town_area",
  "other",
];

export function normalizeCategoryLabels(labels: string[]): {
  categories: string[];
  primaryCategory?: string;
  matchedSourceCategories: string[];
  isTooGeneric: boolean;
} {
  const matchedSourceCategories = [...new Set(labels.map((l) => String(l || "").trim()).filter(Boolean))];
  const categories = new Set<string>();
  for (const label of matchedSourceCategories) {
    for (const rule of CATEGORY_RULES) {
      if (rule.pattern.test(label)) categories.add(rule.category);
    }
  }
  if (categories.size === 0 && matchedSourceCategories.length > 0) {
    categories.add("other");
  }
  const ordered = PRIMARY_CATEGORY_PRIORITY.filter((c) => categories.has(c));
  const primaryCategory = ordered[0] ?? (categories.size > 0 ? [...categories][0] : undefined);
  const isTooGeneric =
    matchedSourceCategories.some((label) => GENERIC_PATTERNS.some((pattern) => pattern.test(label))) ||
    primaryCategory === "town_area";
  return {
    categories: ordered.length > 0 ? ordered : [...categories],
    primaryCategory,
    matchedSourceCategories,
    isTooGeneric,
  };
}

function placeCandidateIdFromQid(qid: string): string {
  return createHash("sha1").update(`wikidata:${qid}`).digest("hex").slice(0, 16);
}

function commonsCategoryUrl(category: string): string {
  const slug = category.replace(/^Category:/i, "").replace(/ /g, "_");
  return `https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(slug)}`;
}

export function normalizeWikidataPlaceCandidate(
  raw: WikidataRawPlaceCandidate,
  state: UsStatePlaceConfig,
  includeRaw: boolean,
): PlaceCandidate {
  const actualTypeLabels = [...new Set(raw.instanceLabels.map((label) => String(label || "").trim()).filter(Boolean))];
  const bucketHintsApplied = Boolean(raw.targetedCategoryHints?.length || raw.sourceBucketLabels?.length);
  const labelInputs = [...actualTypeLabels, ...(raw.targetedCategoryHints ?? [])];
  const category = normalizeCategoryLabels(labelInputs);
  const wikidataUrl = `https://www.wikidata.org/wiki/${raw.qid}`;
  return {
    placeCandidateId: placeCandidateIdFromQid(raw.qid),
    name: raw.name,
    state: state.stateName,
    stateCode: state.stateCode,
    country: "US",
    lat: raw.lat,
    lng: raw.lng,
    categories: category.categories,
    primaryCategory: category.primaryCategory,
    sourceIds: {
      wikidata: raw.qid,
      wikipedia: raw.wikipediaUrl ? raw.wikipediaUrl.split("/wiki/")[1] : undefined,
      commonsCategory: raw.commonsCategory,
    },
    sourceUrls: {
      wikidata: wikidataUrl,
      wikipedia: raw.wikipediaUrl,
      commonsCategory: raw.commonsCategory ? commonsCategoryUrl(raw.commonsCategory) : undefined,
    },
    rawSources: ["wikidata"],
    sourceConfidence: 0.7,
    locavaScore: 0,
    candidateTier: "C",
    signals: {
      hasCoordinates: Number.isFinite(raw.lat) && Number.isFinite(raw.lng),
      hasWikipedia: Boolean(raw.wikipediaUrl),
      hasWikidata: true,
      hasCommonsCategory: Boolean(raw.commonsCategory),
      hasImageField: Boolean(raw.imageField),
      hasUsefulCategory: category.categories.some((c) => c !== "other" && c !== "town_area"),
      isOutdoorLikely: category.categories.some((c) =>
        ["park", "nature", "waterfall", "hiking", "lake", "river", "mountain", "beach", "cave", "viewpoint", "garden"].includes(c),
      ),
      isLandmarkLikely: category.categories.some((c) => ["landmark", "historic", "architecture", "public_art", "museum"].includes(c)),
      isTourismLikely: category.categories.includes("landmark") || /tourist attraction/i.test(category.matchedSourceCategories.join(" ")),
      isTooGeneric: category.isTooGeneric,
    },
    debug: {
      matchedSourceCategories: category.matchedSourceCategories,
      normalizedFrom: ["wikidata"],
      scoreReasons: [],
      tierReasons: [],
      dedupeKey: `${raw.qid}`,
      sourceBucketIds: raw.sourceBucketIds,
      sourceBucketLabels: raw.sourceBucketLabels,
      targetedCategoryHints: raw.targetedCategoryHints,
      actualTypeLabels,
      bucketHintsApplied,
      raw: includeRaw ? raw.raw : undefined,
    },
  };
}
