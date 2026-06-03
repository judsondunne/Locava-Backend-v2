import type { ActivityTitleFields } from "./inventoryActivityTitleEnrichment.js";
import type { LocavaInventoryRoute, LocavaInventorySpot } from "./inventoryLocavaTypes.js";

export const ACTIVITY_TITLE_ALGORITHM_VERSION = "locava_activity_title_v1";

export type ActivityTitleDiagnostics = {
  algorithmVersion: string;
  totalItems: number;
  readyItems: number;
  hiddenItems: number;
  reviewItems: number;
  itemsWithPrimaryActivity: number;
  itemsMissingPrimaryActivity: number;
  byPrimaryActivity: Record<string, number>;
  byActivity: Record<string, number>;
  byTitleQuality: Record<string, number>;
  weakActivities: Array<Record<string, unknown>>;
  weakTitles: Array<Record<string, unknown>>;
  generatedTitles: Array<Record<string, unknown>>;
  badTitlesHidden: Array<Record<string, unknown>>;
  naturalFeaturesKept: Array<Record<string, unknown>>;
  nicheReadyItems: Array<Record<string, unknown>>;
  hiddenNicheCandidates: Array<Record<string, unknown>>;
  suspiciousReadyItems: Array<Record<string, unknown>>;
  activityCombos: {
    hikingForest: number;
    hikingView: number;
    swimmingBeach: number;
    swimmingRiver: number;
    offroadingUnmaintainedRoad: number;
    historicalMuseum: number;
    parkTrails: number;
    waterfallHiking: number;
    viewpointSunset: number;
  };
  samples: {
    goodActivityExamples: Array<Record<string, unknown>>;
    goodGeneratedTitles: Array<Record<string, unknown>>;
    nicheNaturalFeaturesReady: Array<Record<string, unknown>>;
    weakNaturalFeatureFixed: Array<Record<string, unknown>>;
    hiddenJunkExamples: Array<Record<string, unknown>>;
    needsReviewExamples: Array<Record<string, unknown>>;
  };
};

type EnrichedItem = (LocavaInventorySpot | LocavaInventoryRoute) & Partial<ActivityTitleFields>;

function hasActs(item: EnrichedItem, ...acts: string[]): boolean {
  const set = new Set([...(item.activities ?? []), item.primaryActivity ?? ""].filter(Boolean));
  return acts.every((a) => set.has(a));
}

function sampleRow(item: EnrichedItem): Record<string, unknown> {
  return {
    kind: item.kind,
    name: "displayName" in item && item.displayName ? item.displayName : item.name,
    subtitle: item.subtitle,
    primaryActivity: item.primaryActivity,
    activities: item.activities,
    titleQuality: item.titleQuality,
    activityConfidence: item.activityConfidence,
    mapReadiness: item.mapReadiness,
    readinessReason: item.readinessReason,
    category: "category" in item ? item.category : null,
    sourceKey: item.sourceKey,
  };
}

export function buildActivityTitleDiagnostics(input: {
  spots: EnrichedItem[];
  routes: EnrichedItem[];
}): ActivityTitleDiagnostics {
  const items = [...input.spots, ...input.routes];
  const byPrimaryActivity: Record<string, number> = {};
  const byActivity: Record<string, number> = {};
  const byTitleQuality: Record<string, number> = {};

  let readyItems = 0;
  let hiddenItems = 0;
  let reviewItems = 0;
  let itemsWithPrimaryActivity = 0;

  const weakActivities: Array<Record<string, unknown>> = [];
  const weakTitles: Array<Record<string, unknown>> = [];
  const generatedTitles: Array<Record<string, unknown>> = [];
  const badTitlesHidden: Array<Record<string, unknown>> = [];
  const naturalFeaturesKept: Array<Record<string, unknown>> = [];
  const nicheReadyItems: Array<Record<string, unknown>> = [];
  const hiddenNicheCandidates: Array<Record<string, unknown>> = [];
  const suspiciousReadyItems: Array<Record<string, unknown>> = [];

  const combos = {
    hikingForest: 0,
    hikingView: 0,
    swimmingBeach: 0,
    swimmingRiver: 0,
    offroadingUnmaintainedRoad: 0,
    historicalMuseum: 0,
    parkTrails: 0,
    waterfallHiking: 0,
    viewpointSunset: 0,
  };

  for (const item of items) {
    const readiness = item.mapReadiness ?? "ready";
    if (readiness === "ready") readyItems += 1;
    else if (readiness === "hidden") hiddenItems += 1;
    else reviewItems += 1;

    if (item.primaryActivity) {
      itemsWithPrimaryActivity += 1;
      byPrimaryActivity[item.primaryActivity] = (byPrimaryActivity[item.primaryActivity] ?? 0) + 1;
    }
    for (const a of item.activities ?? []) {
      byActivity[a] = (byActivity[a] ?? 0) + 1;
    }
    const tq = item.titleQuality ?? "unknown";
    byTitleQuality[tq] = (byTitleQuality[tq] ?? 0) + 1;

    if (hasActs(item, "hiking", "forest")) combos.hikingForest += 1;
    if (hasActs(item, "hiking", "view")) combos.hikingView += 1;
    if (hasActs(item, "swimming", "beach")) combos.swimmingBeach += 1;
    if (hasActs(item, "swimming", "river")) combos.swimmingRiver += 1;
    if (hasActs(item, "offroading", "unmaintainedroad")) combos.offroadingUnmaintainedRoad += 1;
    if (hasActs(item, "historical", "museum")) combos.historicalMuseum += 1;
    if (hasActs(item, "park", "trail")) combos.parkTrails += 1;
    if (hasActs(item, "waterfall", "hiking")) combos.waterfallHiking += 1;
    if (hasActs(item, "view", "sunset")) combos.viewpointSunset += 1;

    if (item.activityConfidence === "low" && weakActivities.length < 25) weakActivities.push(sampleRow(item));
    if (item.titleQuality === "weak" && weakTitles.length < 25) weakTitles.push(sampleRow(item));
    if ((item.titleQuality === "generated" || item.titleQuality === "contextual") && generatedTitles.length < 25) {
      generatedTitles.push(sampleRow(item));
    }
    if (item.mapReadiness === "hidden" && item.titleQuality === "bad" && badTitlesHidden.length < 25) {
      badTitlesHidden.push(sampleRow(item));
    }
    if (
      ("category" in item && item.category === "natural_feature") ||
      item.titleWarnings?.includes("natural_feature_title_fixed")
    ) {
      if (item.mapReadiness !== "hidden" && naturalFeaturesKept.length < 25) naturalFeaturesKept.push(sampleRow(item));
    }
    if (readiness === "ready" && item.activityConfidence === "medium" && nicheReadyItems.length < 25) {
      nicheReadyItems.push(sampleRow(item));
    }
    if (readiness === "hidden" && hasActs(item, "nature", "hiking") && hiddenNicheCandidates.length < 25) {
      hiddenNicheCandidates.push(sampleRow(item));
    }
    if (readiness === "ready" && item.activityConfidence === "low" && suspiciousReadyItems.length < 25) {
      suspiciousReadyItems.push(sampleRow(item));
    }
  }

  const goodActivityExamples = items
    .filter((i) => i.mapReadiness === "ready" && i.activityConfidence === "high")
    .slice(0, 10)
    .map(sampleRow);
  const goodGeneratedTitles = generatedTitles.slice(0, 10);
  const nicheNaturalFeaturesReady = naturalFeaturesKept.slice(0, 10);
  const weakNaturalFeatureFixed = items
    .filter((i) => i.titleWarnings?.includes("natural_feature_title_fixed"))
    .slice(0, 10)
    .map(sampleRow);
  const hiddenJunkExamples = badTitlesHidden.slice(0, 10);
  const needsReviewExamples = items.filter((i) => i.mapReadiness === "review").slice(0, 10).map(sampleRow);

  return {
    algorithmVersion: ACTIVITY_TITLE_ALGORITHM_VERSION,
    totalItems: items.length,
    readyItems,
    hiddenItems,
    reviewItems,
    itemsWithPrimaryActivity,
    itemsMissingPrimaryActivity: items.length - itemsWithPrimaryActivity,
    byPrimaryActivity,
    byActivity,
    byTitleQuality,
    weakActivities,
    weakTitles,
    generatedTitles,
    badTitlesHidden,
    naturalFeaturesKept,
    nicheReadyItems,
    hiddenNicheCandidates,
    suspiciousReadyItems,
    activityCombos: combos,
    samples: {
      goodActivityExamples,
      goodGeneratedTitles,
      nicheNaturalFeaturesReady,
      weakNaturalFeatureFixed,
      hiddenJunkExamples,
      needsReviewExamples,
    },
  };
}
