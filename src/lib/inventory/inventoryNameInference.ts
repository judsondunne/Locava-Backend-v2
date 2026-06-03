/**
 * Strict name-inference gating for Locava OSM classification.
 *
 * Name hints may reinforce category/activity only when explicit destination
 * tags exist and disqualifying settlement/infrastructure signals do not.
 */

export type NameInferenceEvaluation = {
  nameInferenceUsed: boolean;
  nameInferenceReason: string | null;
  nameInferenceBlockedReason: string | null;
  supportingTags: string[];
  disqualifyingTags: string[];
  inferredCategory: string | null;
};

const SETTLEMENT_PLACES = new Set([
  "hamlet",
  "village",
  "town",
  "locality",
  "suburb",
  "neighbourhood",
  "neighborhood",
  "quarter",
  "isolated_dwelling",
]);

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function hasTag(tags: Record<string, string>, key: string, value?: string): boolean {
  const v = tag(tags, key);
  if (v == null) return false;
  return value == null ? true : v === value;
}

export function isGeographicBeachName(name: string | null | undefined, tags: Record<string, string>): boolean {
  const n = (name ?? tag(tags, "name") ?? "").trim().toLowerCase();
  if (!/\bbeach\b/.test(n)) return false;
  if (getSupportingDestinationTags(tags).includes("beach")) return true;

  const beforeBeach = n.replace(/\s+beach\s*$/i, "").trim();
  if (!beforeBeach) return false;
  const words = beforeBeach.split(/\s+/).filter(Boolean);
  const place = tag(tags, "place");

  // Multi-word beach names like "Starr Farm Beach" are geographic even when mis-tagged place=hamlet.
  if (words.length >= 2) return true;

  // Single-word + Beach on a populated place node is usually a settlement name (Cedar Beach).
  if (place && SETTLEMENT_PLACES.has(place)) return false;

  return words.length >= 1 && !place;
}

export function inferSafeBeachCategoryFromName(
  tags: Record<string, string>,
  name: string | null | undefined
): string | null {
  return isGeographicBeachName(name, tags) ? "beach" : null;
}

export function inferPrimaryCategoryFromName(name: string | null | undefined): string | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return null;
  if (/\b(falls|cascade|waterfall)\b/.test(n)) return "waterfall";
  if (/\bbeach\b/.test(n)) return "beach";
  if (/\b(swim|bathing|swimming hole|swimming)\b/.test(n)) return "swimming_hole";
  if (/\b(trailhead|trail head)\b/.test(n)) return "trailhead";
  if (/\b(view|vista|overlook|lookout|ledge|platform)\b/.test(n)) return "viewpoint";
  if (/\b(pond|lake)\b/.test(n)) return "water";
  if (/\b(river|brook|creek|stream)\b/.test(n)) return "water";
  if (/\b(mountain|peak|summit)\b/.test(n)) return "peak";
  if (/\b(preserve|reservation|conservation area)\b/.test(n)) return "nature_reserve";
  if (/\b(cave|grotto)\b/.test(n)) return "cave";
  if (/\bquarry\b/.test(n)) return "quarry";
  if (/\b(trail|loop|path)\b/.test(n)) return "trail";
  return null;
}

/** Explicit OSM destination tags that may allow a name hint to reinforce category. */
export function getSupportingDestinationTags(tags: Record<string, string>): string[] {
  const out: string[] = [];
  if (hasTag(tags, "natural", "waterfall") || hasTag(tags, "waterway", "waterfall")) out.push("waterfall");
  if (hasTag(tags, "natural", "beach") || hasTag(tags, "leisure", "beach_resort") || hasTag(tags, "beach", "yes") || hasTag(tags, "leisure", "beach")) {
    out.push("beach");
  }
  if (hasTag(tags, "tourism", "viewpoint")) out.push("viewpoint");
  if (hasTag(tags, "man_made", "observation_tower")) out.push("viewpoint");
  if (hasTag(tags, "man_made", "tower") && ["observation", "watchtower"].includes(tag(tags, "tower:type") ?? "")) {
    out.push("viewpoint");
  }
  if (hasTag(tags, "natural", "peak") || hasTag(tags, "natural", "hill")) out.push("peak");
  if (hasTag(tags, "leisure", "park") || hasTag(tags, "leisure", "nature_reserve") || hasTag(tags, "leisure", "swimming_area")) {
    out.push("park");
  }
  if (hasTag(tags, "tourism", "picnic_site")) out.push("picnic_site");
  if (hasTag(tags, "natural", "water") || hasTag(tags, "water")) out.push("water");
  if (hasTag(tags, "natural", "wetland")) out.push("wetland");
  if (hasTag(tags, "highway", "trailhead") || hasTag(tags, "parking", "trailhead")) out.push("trailhead");
  if (hasTag(tags, "route", "hiking") || hasTag(tags, "route", "foot")) out.push("hiking_route");
  if (hasTag(tags, "highway", "path") || hasTag(tags, "highway", "footway") || hasTag(tags, "highway", "track")) {
    if (hasTag(tags, "hiking", "yes") || hasTag(tags, "foot", "designated") || hasTag(tags, "sac_scale") || hasTag(tags, "trail_visibility")) {
      out.push("trail_highway");
    }
  }
  if (hasTag(tags, "boundary", "protected_area")) out.push("protected_area");
  return out;
}

/** Tags/name patterns that block unsafe public-ready name fallback. */
export function getDisqualifyingNameInferenceTags(
  tags: Record<string, string>,
  name: string | null | undefined
): string[] {
  const out: string[] = [];
  const place = tag(tags, "place");
  if (place && SETTLEMENT_PLACES.has(place)) out.push(`place=${place}`);

  if (hasTag(tags, "landuse", "residential")) out.push("landuse=residential");
  if (hasTag(tags, "landuse", "commercial") || hasTag(tags, "landuse", "industrial")) {
    out.push(`landuse=${tag(tags, "landuse")}`);
  }

  const n = (name ?? tag(tags, "name") ?? "").toLowerCase();
  if (/\bmobile home park\b/.test(n)) out.push("name:mobile_home_park");
  if (/\btrailer park\b/.test(n)) out.push("name:trailer_park");
  if (/\bhome park\b/.test(n) && !hasTag(tags, "leisure", "park")) out.push("name:home_park");
  if (/\bjunction\b/.test(n) && !getSupportingDestinationTags(tags).includes("water")) out.push("name:junction_without_water_tags");

  if (tag(tags, "railway")) out.push(`railway=${tag(tags, "railway")}`);
  if (tag(tags, "power")) out.push(`power=${tag(tags, "power")}`);
  if (hasTag(tags, "man_made", "mast") || hasTag(tags, "man_made", "tower") && tag(tags, "tower:type") === "communication") {
    out.push("utility_infrastructure");
  }
  if (hasTag(tags, "highway", "motorway_junction")) out.push("highway=motorway_junction");

  return out;
}

export function evaluateNameInference(
  tags: Record<string, string>,
  name: string | null | undefined
): NameInferenceEvaluation {
  const supportingTags = getSupportingDestinationTags(tags);
  const disqualifyingTags = getDisqualifyingNameInferenceTags(tags, name);
  const inferredCategory = inferPrimaryCategoryFromName(name);

  if (disqualifyingTags.length > 0) {
    return {
      nameInferenceUsed: false,
      nameInferenceReason: null,
      nameInferenceBlockedReason: disqualifyingTags.join(", "),
      supportingTags,
      disqualifyingTags,
      inferredCategory: null,
    };
  }

  if (supportingTags.length === 0) {
    return {
      nameInferenceUsed: false,
      nameInferenceReason: null,
      nameInferenceBlockedReason: "no_supporting_destination_tags",
      supportingTags,
      disqualifyingTags,
      inferredCategory: null,
    };
  }

  if (!inferredCategory) {
    return {
      nameInferenceUsed: false,
      nameInferenceReason: null,
      nameInferenceBlockedReason: "no_name_pattern",
      supportingTags,
      disqualifyingTags,
      inferredCategory: null,
    };
  }

  return {
    nameInferenceUsed: true,
    nameInferenceReason: `name_hint_with_${supportingTags[0]}`,
    nameInferenceBlockedReason: null,
    supportingTags,
    disqualifyingTags,
    inferredCategory,
  };
}

/** Small score bump only when name hint is allowed and aligns with supporting tags. */
export function nameInferenceScoreBoost(evaluation: NameInferenceEvaluation): number {
  if (!evaluation.nameInferenceUsed || !evaluation.inferredCategory) return 0;
  return 15;
}
