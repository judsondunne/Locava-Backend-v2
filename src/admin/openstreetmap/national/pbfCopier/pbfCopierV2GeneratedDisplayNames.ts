/**
 * Generated display names for strong unnamed outdoor / social categories (Locava broad discovery).
 */
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { isSyntheticPreviewLabel } from "./pbfCopierV2MountainQuality.js";
import { hasOsmNameTag, hasMeaningfulPreviewName } from "./pbfCopierV2QualityFilters.js";

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function hasTag(tags: Record<string, string>, key: string): boolean {
  return Boolean(tags[key]?.trim());
}

export type GeneratedOutdoorName = {
  displayName: string;
  category: string;
  activity: string;
  reason: string;
};

const GENERATED_NAME_BY_TAG: Array<{
  match: (tags: Record<string, string>) => boolean;
  displayName: string;
  category: string;
  activity: string;
  reason: string;
}> = [
  {
    match: (t) => tag(t, "natural") === "beach",
    displayName: "Beach",
    category: "beach",
    activity: "beach",
    reason: "unnamed_beach",
  },
  {
    match: (t) => tag(t, "leisure") === "swimming_area",
    displayName: "Swimming Area",
    category: "swimming",
    activity: "swimming",
    reason: "unnamed_swimming_area",
  },
  {
    match: (t) => tag(t, "tourism") === "viewpoint",
    displayName: "Viewpoint",
    category: "viewpoint",
    activity: "sightseeing",
    reason: "unnamed_viewpoint",
  },
  {
    match: (t) => tag(t, "tourism") === "picnic_site",
    displayName: "Picnic Area",
    category: "picnic",
    activity: "picnic",
    reason: "unnamed_picnic_site",
  },
  {
    match: (t) => tag(t, "leisure") === "playground",
    displayName: "Playground",
    category: "playground",
    activity: "playground",
    reason: "unnamed_playground",
  },
  {
    match: (t) =>
      tag(t, "leisure") === "pitch" ||
      tag(t, "leisure") === "sports_centre" ||
      Boolean(tag(t, "sport")),
    displayName: "Sports Court",
    category: "sports",
    activity: "sports",
    reason: "unnamed_sports_court",
  },
  {
    match: (t) => tag(t, "leisure") === "slipway" || tag(t, "harbour") === "yes",
    displayName: "Boat Launch",
    category: "boating",
    activity: "boating",
    reason: "unnamed_boat_launch",
  },
  {
    match: (t) => tag(t, "waterway") === "waterfall" || tag(t, "natural") === "waterfall",
    displayName: "Waterfall",
    category: "waterfall",
    activity: "hiking",
    reason: "unnamed_waterfall",
  },
  {
    match: (t) => tag(t, "natural") === "spring",
    displayName: "Spring",
    category: "spring",
    activity: "hiking",
    reason: "unnamed_spring",
  },
  {
    match: (t) => tag(t, "highway") === "trailhead",
    displayName: "Trailhead",
    category: "trailhead",
    activity: "hiking",
    reason: "unnamed_trailhead",
  },
  {
    match: (t) => tag(t, "amenity") === "parking" && (tag(t, "parking") === "trailhead" || tag(t, "hiking") === "yes"),
    displayName: "Trailhead Parking",
    category: "trailhead",
    activity: "hiking",
    reason: "unnamed_trailhead_parking",
  },
  {
    match: (t) =>
      tag(t, "natural") === "water" ||
      tag(t, "waterway") === "river" ||
      tag(t, "water") === "pond" ||
      tag(t, "water") === "lake",
    displayName: "Water Access",
    category: "water",
    activity: "water",
    reason: "unnamed_water_access",
  },
  {
    match: (t) => tag(t, "tourism") === "camp_site",
    displayName: "Campground",
    category: "camping",
    activity: "camping",
    reason: "unnamed_campground",
  },
  {
    match: (t) => tag(t, "leisure") === "park" || tag(t, "leisure") === "nature_reserve",
    displayName: "Park",
    category: "park",
    activity: "park",
    reason: "unnamed_park",
  },
];

export function inferGeneratedOutdoorName(tags: Record<string, string>): GeneratedOutdoorName | null {
  for (const rule of GENERATED_NAME_BY_TAG) {
    if (rule.match(tags)) return rule;
  }
  return null;
}

export function hasStrongUnnamedOutdoorCategory(tags: Record<string, string>): boolean {
  return inferGeneratedOutdoorName(tags) != null;
}

export function shouldRejectUnnamedBusinessOrBuilding(tags: Record<string, string>): boolean {
  if (hasStrongUnnamedOutdoorCategory(tags)) return false;
  if (tag(tags, "shop") || tag(tags, "office") || tag(tags, "craft")) return true;
  const building = tag(tags, "building");
  if (building && !["yes", "roof"].includes(building)) return true;
  const amenity = tag(tags, "amenity");
  if (
    amenity &&
    !["parking", "bench", "waste_basket", "drinking_water", "toilets", "shelter"].includes(amenity)
  ) {
    return true;
  }
  if (tag(tags, "man_made") || tag(tags, "power")) return true;
  return false;
}

/** Apply category-based display names to unnamed outdoor spots/routes worth keeping. */
export function enrichUnnamedOutdoorDisplayNames(docs: PbfCopierPreviewDoc[]): PbfCopierPreviewDoc[] {
  return docs.map((doc) => {
    const tags = doc.sourceTagSample ?? {};
    if (hasOsmNameTag(tags) && hasMeaningfulPreviewName(doc) && !isSyntheticPreviewLabel(doc)) {
      return doc;
    }
    if (shouldRejectUnnamedBusinessOrBuilding(tags) && !hasStrongUnnamedOutdoorCategory(tags)) {
      return doc;
    }

    const generated = inferGeneratedOutdoorName(tags);
    if (!generated) return doc;

    const warnings = [...(doc.warnings ?? [])];
    if (!warnings.includes("v2_generated_outdoor_name")) warnings.push("v2_generated_outdoor_name");

    return {
      ...doc,
      displayName: generated.displayName,
      derivedName: true,
      nameSource: "outdoor_category",
      nameConfidence: "medium",
      primaryCategory: doc.primaryCategory ?? generated.category,
      primaryActivity: doc.primaryActivity ?? generated.activity,
      activities: doc.activities?.length ? doc.activities : [generated.activity],
      warnings,
    };
  });
}
