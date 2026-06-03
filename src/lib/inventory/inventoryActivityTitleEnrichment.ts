import { generateLocavaActivities, type ActivityGenerationContext, type LocavaActivityResult } from "./activities/inventoryActivityGenerator.js";
import { dedupeActivities, normalizeActivity } from "./activities/locavaActivities.js";
import { generateInventoryTitle } from "./names/inventoryTitleGenerator.js";
import { applyMapReadinessToDisplayPriority, evaluateMapReadiness } from "./inventoryMapReadiness.js";
import type { LocavaInventoryRoute, LocavaInventorySpot } from "./inventoryLocavaTypes.js";

export type ActivityTitleFields = {
  primaryActivity: string | null;
  activities: string[];
  activityWeights: Record<string, number>;
  activityReasons: Array<{ activity: string; weight: number; reason: string; source: string }>;
  searchableAliases: string[];
  searchText: string;
  searchBoostTerms: string[];
  activityConfidence: "high" | "medium" | "low";
  activityWarnings: string[];
  subtitle?: string;
  titleQuality?: "official" | "contextual" | "generated" | "weak" | "bad";
  titleReason?: string;
  titleWarnings?: string[];
  mapReadiness?: "ready" | "review" | "hidden";
  readinessReason?: string;
};

function buildSearchText(parts: Array<string | null | undefined>): string {
  return parts
    .filter(Boolean)
    .map((p) => String(p).toLowerCase())
    .join(" ");
}

function buildSearchBoostTerms(input: {
  primaryActivity: string | null;
  activities: string[];
  searchableAliases: string[];
  displayName: string;
  parentPlaceName?: string | null;
}): string[] {
  const boosts = new Set<string>();
  if (input.primaryActivity) boosts.add(input.primaryActivity);
  for (const a of input.activities.slice(0, 8)) boosts.add(a);
  for (const alias of input.searchableAliases.slice(0, 12)) boosts.add(alias);
  if (input.parentPlaceName) boosts.add(input.parentPlaceName.toLowerCase());
  boosts.add(input.displayName.toLowerCase());
  return [...boosts].filter(Boolean);
}

function spotContext(spot: LocavaInventorySpot): ActivityGenerationContext {
  return {
    itemKind: "spot",
    tags: spot.tags,
    category: spot.category,
    name: spot.displayName ?? spot.name,
    rawName: spot.rawName ?? spot.name,
    parentPlaceName: spot.parentPlaceName ?? spot.parentContext?.parentName,
    parentCategory: spot.parentContext?.parentCategory,
    parentContext: spot.parentContext,
    childHighlights: spot.childHighlights?.map((c) => ({ type: c.type, name: c.name, displayName: c.displayName })),
    childFeatureTypes: spot.childFeatureTypes,
    source: spot.source,
    hasParking: spot.parking?.hasParking,
    hasTrailhead: spot.trailhead?.hasTrailhead,
  };
}

function routeContext(route: LocavaInventoryRoute): ActivityGenerationContext {
  return {
    itemKind: "route",
    tags: route.tags,
    category: route.activity,
    name: route.name,
    rawName: route.name,
    parentPlaceName: route.parentPlaceName,
    parentCategory: null,
    source: route.source,
    sourceDatasetName: route.sourceDatasetName,
    routeKind: route.routeKind,
    routeActivity: route.activity,
    offroad: route.offroad,
    hasParking: Boolean(route.selectedParking),
    hasTrailhead: Boolean(route.selectedTrailhead),
    distanceMiles: route.distanceMiles,
  };
}

function sanitizeActivityResult(act: LocavaActivityResult): LocavaActivityResult {
  const activities = dedupeActivities(act.activities);
  let primary = act.primaryActivity ? normalizeActivity(act.primaryActivity) : null;
  if (primary && !activities.includes(primary)) activities.unshift(primary);
  if (primary === "nature" && activities.length > 1) {
    const specific = activities.find((a) => a !== "nature" && a !== "conservation" && a !== "forest");
    if (specific) primary = specific;
  }
  if (!primary && activities.length > 0) primary = activities[0] ?? null;
  return {
    ...act,
    primaryActivity: primary,
    activities: dedupeActivities(activities),
  };
}

export function enrichSpotActivityTitle(spot: LocavaInventorySpot): LocavaInventorySpot & ActivityTitleFields {
  const act = sanitizeActivityResult(generateLocavaActivities(spotContext(spot)));
  const title = generateInventoryTitle({
    rawName: spot.rawName ?? spot.name,
    category: spot.category,
    tags: spot.tags,
    parentPlaceName: spot.parentPlaceName ?? spot.parentContext?.parentName,
    parentContext: spot.parentContext,
    itemKind: "spot",
    activities: act.activities,
    primaryActivity: act.primaryActivity,
    hasParking: spot.parking?.hasParking,
    offroadLabel: null,
  });

  const readiness = evaluateMapReadiness({
    tags: spot.tags,
    category: spot.category,
    placeKind: spot.placeKind,
    titleQuality: title.titleQuality,
    activityResult: act,
    itemKind: "spot",
    locavaScore: spot.locavaScore,
  });

  const displayName = title.displayName;
  const searchText = buildSearchText([
    displayName,
    title.subtitle,
    act.primaryActivity,
    ...act.activities,
    ...act.searchableAliases,
    spot.parentPlaceName,
    spot.category,
  ]);
  const searchBoostTerms = buildSearchBoostTerms({
    primaryActivity: act.primaryActivity,
    activities: act.activities,
    searchableAliases: act.searchableAliases,
    displayName,
    parentPlaceName: spot.parentPlaceName,
  });

  return {
    ...spot,
    name: displayName,
    displayName,
    activities: act.activities.length ? act.activities : spot.activities,
    primaryActivity: act.primaryActivity,
    activityWeights: act.activityWeights,
    activityReasons: act.activityReasons,
    searchableAliases: act.searchableAliases,
    searchText,
    searchBoostTerms,
    activityConfidence: act.activityConfidence,
    activityWarnings: act.activityWarnings,
    subtitle: title.subtitle,
    titleQuality: title.titleQuality,
    titleReason: title.titleReason,
    titleWarnings: title.titleWarnings,
    mapReadiness: readiness.mapReadiness,
    readinessReason: readiness.readinessReason,
    displayPriority: applyMapReadinessToDisplayPriority(spot.displayPriority, readiness.mapReadiness),
  };
}

export function enrichRouteActivityTitle(route: LocavaInventoryRoute): LocavaInventoryRoute & ActivityTitleFields {
  const act = sanitizeActivityResult(generateLocavaActivities(routeContext(route)));
  const title = generateInventoryTitle({
    rawName: route.name,
    category: route.activity,
    tags: route.tags,
    parentPlaceName: route.parentPlaceName,
    itemKind: "route",
    activities: act.activities,
    primaryActivity: act.primaryActivity ?? route.activity,
    distanceMiles: route.distanceMiles,
    hasParking: Boolean(route.selectedParking),
    offroadLabel: route.offroad?.legalDisplayLabel ?? null,
  });

  const readiness = evaluateMapReadiness({
    tags: route.tags,
    category: route.activity,
    placeKind: route.placeKind,
    titleQuality: title.titleQuality,
    activityResult: act,
    accessStatus: route.offroad?.accessStatus,
    itemKind: "route",
    locavaScore: route.locavaScore,
  });

  const displayName = title.displayName;
  const primaryActivity = act.primaryActivity ?? route.activity;
  const searchText = buildSearchText([
    displayName,
    title.subtitle,
    primaryActivity,
    ...act.activities,
    ...act.searchableAliases,
    route.parentPlaceName,
    route.offroad?.legalDisplayLabel,
  ]);
  const searchBoostTerms = buildSearchBoostTerms({
    primaryActivity,
    activities: act.activities,
    searchableAliases: act.searchableAliases,
    displayName,
    parentPlaceName: route.parentPlaceName,
  });

  const alignedCategories = primaryActivity
    ? [primaryActivity, ...act.activities.filter((a) => a !== primaryActivity)]
    : route.categories;

  return {
    ...route,
    name: displayName,
    activity: primaryActivity ?? route.activity,
    categories: alignedCategories.length ? alignedCategories : route.categories,
    activities: act.activities.length ? act.activities : route.activities,
    primaryActivity,
    activityWeights: act.activityWeights,
    activityReasons: act.activityReasons,
    searchableAliases: act.searchableAliases,
    searchText,
    searchBoostTerms,
    activityConfidence: act.activityConfidence,
    activityWarnings: act.activityWarnings,
    subtitle: title.subtitle,
    titleQuality: title.titleQuality,
    titleReason: title.titleReason,
    titleWarnings: title.titleWarnings,
    mapReadiness: readiness.mapReadiness,
    readinessReason: readiness.readinessReason,
    displayPriority: applyMapReadinessToDisplayPriority(route.displayPriority, readiness.mapReadiness),
  };
}

export function enrichInventoryActivityTitle(input: {
  spots: LocavaInventorySpot[];
  routes: LocavaInventoryRoute[];
}): { spots: (LocavaInventorySpot & ActivityTitleFields)[]; routes: (LocavaInventoryRoute & ActivityTitleFields)[] } {
  return {
    spots: input.spots.map(enrichSpotActivityTitle),
    routes: input.routes.map(enrichRouteActivityTitle),
  };
}
