/**
 * Canonical Locava activity normalization for PBF Copier V2 export.
 * Keeps derived outdoor discovery spots visible while stripping raw OSM key=value leaks.
 */
import {
  dedupeActivities,
  isLocavaActivity,
  normalizeActivity,
  pickPrimaryActivity,
  type LocavaActivity,
} from "../../../../lib/inventory/activities/locavaActivities.js";
import {
  inferActivitiesFromOsmTags,
  listActivityRelevantTags,
} from "../../../../lib/inventory/inventoryOsmActivityTags.js";
import {
  isLocavaFoodDrinkDestination,
  isLocavaLocalRetailDestination,
} from "./pbfCopierV2LocavaProductRules.js";
import { isNamedSkiRun } from "./pbfCopierV2MountainQuality.js";
import { hasMeaningfulPreviewName, hasOsmNameTag } from "./pbfCopierV2PreviewName.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

/** Pipeline-specific labels that are product-facing but not in LOCAVA_ACTIVITIES. */
const ALLOWED_SPECIAL_ACTIVITIES = new Set(["train_bridge", "parking"]);

const CATEGORY_TO_CANONICAL: Record<string, LocavaActivity> = {
  food: "restaurants",
  historic: "historical",
  restaurant: "restaurants",
  fast_food: "restaurants",
  cafe: "cafe",
  bar: "bar",
  bakery: "bakery",
  marketplace: "market",
  ski_run: "skiing",
  chair_lift: "skiing",
  cemetery: "cemetery",
  viewpoint: "view",
  sightseeing: "view",
  swimming_hole: "swimminghole",
  destination: "things",
  destination_group: "things",
  water: "water",
  water_access: "wateraccess",
  osm: "things",
};

export type CanonicalActivityResult = {
  primaryActivity: LocavaActivity | null;
  primaryCategory: string;
  activities: LocavaActivity[];
  activityEvidence: Record<string, string>;
  activityWarnings: string[];
  rawTagActivitySuppressed: string[];
  canonicalActivitySource: string;
  whyVisible?: string;
  whyHidden?: string;
};

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

export function isRawOsmTagActivityString(value: string | null | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (!v || v === "yes" || v === "no" || v === "osm") return true;
  if (v.includes("=")) return true;
  if (/^(building|landuse|man_made|highway|shop|amenity|natural|leisure|tourism|place|railway|waterway):/.test(v)) {
    return true;
  }
  return false;
}

function isAllowedVisibleActivity(activity: string | null | undefined): activity is LocavaActivity {
  if (!activity) return false;
  if (ALLOWED_SPECIAL_ACTIVITIES.has(activity)) return true;
  return isLocavaActivity(activity);
}

function mapLegacyCategory(category: string | null | undefined): LocavaActivity | null {
  if (!category?.trim()) return null;
  const key = category.trim().toLowerCase();
  if (CATEGORY_TO_CANONICAL[key]) return CATEGORY_TO_CANONICAL[key]!;
  return normalizeActivity(key);
}

function collectRawLeaks(doc: PbfCopierPreviewDoc): string[] {
  const leaks = new Set<string>();
  for (const value of [doc.primaryActivity, doc.primaryCategory, ...(doc.activities ?? [])]) {
    if (value && isRawOsmTagActivityString(value)) leaks.add(value);
  }
  return [...leaks];
}

function inferFromDocContext(doc: PbfCopierPreviewDoc): {
  activities: LocavaActivity[];
  evidence: Record<string, string>;
  source: string;
} {
  const tags = doc.sourceTagSample ?? {};
  const evidence: Record<string, string> = {};
  const acts = new Set<LocavaActivity>(inferActivitiesFromOsmTags(tags));

  const add = (activity: LocavaActivity, reason: string) => {
    acts.add(activity);
    evidence[activity] = reason;
  };

  if (doc.warnings?.includes("v2_hiking_trail_merged") || tag(tags, "route") === "hiking") {
    add("hiking", "merged hiking trail");
    add("trail", "merged hiking trail");
  }
  if (isNamedSkiRun(doc)) add("skiing", "named ski run");
  if (isLocavaFoodDrinkDestination(doc)) {
    const amenity = tag(tags, "amenity");
    const shop = tag(tags, "shop");
    if (amenity === "cafe" || shop === "coffee") add("cafe", "food/drink destination");
    else if (amenity === "bar" || amenity === "pub") add("bar", "food/drink destination");
    else if (shop === "bakery") add("bakery", "food/drink destination");
    else if (amenity === "marketplace" || shop === "farm") add("market", "food/drink destination");
    else add("restaurants", "food/drink destination");
  }
  if (isLocavaLocalRetailDestination(doc)) add("shopping", "local retail destination");

  const display = (doc.displayName || "").trim();
  if (/^water access$/i.test(display)) {
    add("wateraccess", "generated Water Access label");
    add("water", "generated Water Access label");
  }
  if (tag(tags, "place") === "island" || tag(tags, "place") === "islet") {
    add("island", "place=island");
    add("nature", "place=island");
  }
  if (tag(tags, "landuse") === "retail" && (hasOsmNameTag(tags) || hasMeaningfulPreviewName(doc))) {
    add("shopping", "named landuse=retail destination group");
    if (/\b(village|market|mall|outlet|gorge)\b/i.test(display)) add("market", "retail village/market name");
  }
  if (doc.primaryActivity === "train_bridge") add("bridge", "train bridge over water");

  let source = acts.size ? "osm_tags" : "none";
  if (doc.warnings?.includes("v2_generated_outdoor_name")) source = "generated_outdoor_category";
  if (isLocavaFoodDrinkDestination(doc) || isLocavaLocalRetailDestination(doc)) source = "locava_product_rules";

  return { activities: dedupeActivities([...acts]), evidence, source };
}

function normalizeExistingActivities(doc: PbfCopierPreviewDoc): LocavaActivity[] {
  const out: LocavaActivity[] = [];
  for (const raw of [doc.primaryActivity, doc.primaryCategory, ...(doc.activities ?? [])]) {
    if (!raw || isRawOsmTagActivityString(raw)) continue;
    const mapped = mapLegacyCategory(raw) ?? normalizeActivity(raw);
    if (mapped) out.push(mapped);
  }
  return dedupeActivities(out);
}

function pickPrimary(
  activities: LocavaActivity[],
  doc: PbfCopierPreviewDoc
): LocavaActivity | null {
  if (!activities.length) return null;
  const weights: Record<string, number> = {};
  for (const a of activities) weights[a] = (weights[a] ?? 0) + 1;
  if (doc.primaryActivity && isAllowedVisibleActivity(doc.primaryActivity)) {
    weights[doc.primaryActivity] = (weights[doc.primaryActivity] ?? 0) + 3;
  }
  const picked = pickPrimaryActivity(weights, {
    routeActivity: doc.primaryActivity ?? undefined,
    category: doc.primaryCategory,
  });
  return picked ?? activities[0] ?? null;
}

export function deriveCanonicalActivityState(doc: PbfCopierPreviewDoc): CanonicalActivityResult {
  const rawTagActivitySuppressed = collectRawLeaks(doc);
  const activityWarnings: string[] = [];
  const fromTags = inferFromDocContext(doc);
  const fromExisting = normalizeExistingActivities(doc);

  let activities = dedupeActivities([...fromTags.activities, ...fromExisting]);
  let canonicalActivitySource = fromTags.source;

  if (!activities.length) {
    activityWarnings.push("no_canonical_activity_from_tags");
  } else if (rawTagActivitySuppressed.length) {
    canonicalActivitySource = `${canonicalActivitySource}+suppressed_raw`;
  }

  const primaryActivity = pickPrimary(activities, doc);
  if (primaryActivity && !activities.includes(primaryActivity)) {
    activities = dedupeActivities([primaryActivity, ...activities]);
  }

  const primaryCategory = primaryActivity ?? activities[0] ?? "things";

  const activityEvidence: Record<string, string> = {
    ...(doc.activityEvidence ?? {}),
    ...fromTags.evidence,
  };
  if (rawTagActivitySuppressed.length) {
    activityEvidence._rawSuppressed = rawTagActivitySuppressed.join(", ");
  }
  for (const tagKey of Object.keys(listActivityRelevantTags(doc.sourceTagSample ?? {})).slice(0, 8)) {
    const val = doc.sourceTagSample?.[tagKey];
    if (val) activityEvidence[`tag:${tagKey}`] = val;
  }

  let whyVisible: string | undefined;
  let whyHidden: string | undefined;

  if (!primaryActivity || !isAllowedVisibleActivity(primaryActivity)) {
    whyHidden = "no canonical Locava activity could be inferred from OSM metadata";
    activityWarnings.push("hide_no_canonical_primary");
  } else if (rawTagActivitySuppressed.length && !fromTags.activities.length && !fromExisting.length) {
    whyHidden = `raw OSM activity leak with no canonical mapping: ${rawTagActivitySuppressed.join(", ")}`;
    activityWarnings.push("hide_raw_osm_only");
  } else {
    whyVisible = `canonical ${primaryActivity} from ${canonicalActivitySource}`;
    if (doc.warnings?.includes("v2_generated_outdoor_name")) {
      whyVisible += "; generated outdoor display name preserved";
    }
  }

  return {
    primaryActivity,
    primaryCategory,
    activities,
    activityEvidence,
    activityWarnings,
    rawTagActivitySuppressed,
    canonicalActivitySource,
    whyVisible,
    whyHidden,
  };
}

export function canonicalizePreviewDocActivities(doc: PbfCopierPreviewDoc): PbfCopierPreviewDoc {
  const result = deriveCanonicalActivityState(doc);
  return {
    ...doc,
    primaryActivity: result.primaryActivity,
    primaryCategory: result.primaryCategory,
    activities: result.activities,
    activityEvidence: Object.keys(result.activityEvidence).length ? result.activityEvidence : undefined,
    activityWarnings: result.activityWarnings.length ? result.activityWarnings : undefined,
    rawTagActivitySuppressed: result.rawTagActivitySuppressed.length ? result.rawTagActivitySuppressed : undefined,
    canonicalActivitySource: result.canonicalActivitySource,
    whyVisible: result.whyVisible,
    whyHidden: result.whyHidden,
  };
}

export function hasVisibleRawActivityLeak(doc: PbfCopierPreviewDoc): boolean {
  for (const value of [doc.primaryActivity, doc.primaryCategory, ...(doc.activities ?? [])]) {
    if (value && isRawOsmTagActivityString(value)) return true;
  }
  return false;
}

export function matchRawOsmActivityLeak(doc: PbfCopierPreviewDoc): { reason: string } | null {
  const canon = deriveCanonicalActivityState(doc);
  if (!canon.primaryActivity || !isAllowedVisibleActivity(canon.primaryActivity)) {
    return {
      reason: canon.whyHidden ?? "no canonical activity mapping for OSM tags",
    };
  }
  if (hasVisibleRawActivityLeak(doc)) {
    return { reason: "raw OSM tag string in activity fields after canonicalization" };
  }
  for (const activity of canon.activities) {
    if (!isAllowedVisibleActivity(activity)) {
      return { reason: `non-canonical activity remains: ${activity}` };
    }
  }
  return null;
}

export function enforceVisibleCanonicalActivities<T extends PbfCopierPreviewDoc>(
  doc: T
): T & { filteredOut?: boolean; filteredBy?: string[]; filterReason?: string } {
  const canon = canonicalizePreviewDocActivities(doc);
  if (doc.filteredOut) return canon as T;

  const leak = matchRawOsmActivityLeak(canon);
  if (!leak) return canon as T;

  return {
    ...canon,
    filteredOut: true,
    filteredBy: [...new Set([...(doc.filteredBy ?? []), "raw_osm_activity"])],
    filterReason: [doc.filterReason, leak.reason].filter(Boolean).join("; "),
    whyHidden: leak.reason,
    whyVisible: undefined,
  } as T & { filteredOut?: boolean; filteredBy?: string[]; filterReason?: string };
}
