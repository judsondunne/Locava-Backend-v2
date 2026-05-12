import type { WikimediaMvpSeedPlace } from "./WikimediaMvpTypes.js";

export type CommonsQueryPlanEntry = {
  query: string;
  variantType: string;
  rank: number;
};

const SYNONYM_RULES: Array<{ match: (c: string) => boolean; queries: string[]; variantPrefix: string }> = [
  {
    match: (c) => /\b(waterfall|falls)\b/i.test(c),
    queries: ["waterfall", "falls"],
    variantPrefix: "synonym_waterfall",
  },
  {
    match: (c) => /\b(quarry)\b/i.test(c),
    queries: ["quarry"],
    variantPrefix: "synonym_quarry",
  },
  {
    match: (c) => /\b(castle)\b/i.test(c),
    queries: ["castle"],
    variantPrefix: "synonym_castle",
  },
  {
    match: (c) => /\b(beach)\b/i.test(c),
    queries: ["beach"],
    variantPrefix: "synonym_beach",
  },
  {
    match: (c) => /\b(notch|gap|pass)\b/i.test(c),
    queries: ["notch", "gap", "pass"],
    variantPrefix: "synonym_notch",
  },
];

/**
 * Ranked Commons search query variants for a place.
 * Simpler place-name queries are tried before comma-heavy state labels (better recall on Commons).
 */
export function buildCommonsSearchQueryPlan(place: WikimediaMvpSeedPlace): CommonsQueryPlanEntry[] {
  const name = String(place.placeName || "").trim();
  if (!name) return [];
  const stateName = String(place.stateName || "").trim();
  const stateCode = String(place.stateCode || "").trim();
  const town = String(place.nearestTown || "").trim();
  const county = String(place.countyName || "").trim();
  const catText = [...(place.themes ?? []), ...(place.placeCategoryKeywords ?? [])].join(" ").toLowerCase();
  const nameLower = name.toLowerCase();

  const out: CommonsQueryPlanEntry[] = [];
  const seen = new Set<string>();
  let rank = 0;
  const add = (query: string, variantType: string) => {
    const q = query.trim();
    if (!q || seen.has(q)) return;
    seen.add(q);
    out.push({ query: q, variantType, rank: rank++ });
  };

  add(name, "exact_place_name");
  if (stateName) add(`${name} ${stateName}`, "place_plus_state_name");
  if (stateCode) add(`${name} ${stateCode}`, "place_plus_state_code");
  add(`"${name}"`, "quoted_exact_name");
  if (town) add(`${name} ${town}`, "place_plus_nearest_town");
  if (county) add(`${name} ${county}`, "place_plus_county");

  for (const rule of SYNONYM_RULES) {
    if (!rule.match(catText) && !rule.match(nameLower)) continue;
    for (const suffix of rule.queries) {
      add(`${name} ${suffix}`, `${rule.variantPrefix}_${suffix}`);
    }
  }

  const legacy = String(place.searchQuery || "").trim();
  if (legacy && legacy !== name && !seen.has(legacy)) {
    add(legacy, "legacy_full_label");
  }
  return out;
}
