import {
  confidenceFromScore,
  DECISION_THRESHOLD,
  displayPriorityFromCategory,
  hasRealName,
  inferActivities,
  isBridgeSpot,
  isDestinationSpotEligible,
  isPrivateRecreationDestination,
  isStrongSwimmingOrBeachTagSignal,
  isTrailLikeHighway,
  scoreOsmFeatureForLocava,
} from "./inventoryLocavaScoring.js";
import type {
  LocavaClassificationResult,
  LocavaClassifierConfig,
  LocavaClassifierFeatureInput,
  LocavaGeometryIntent,
} from "./inventoryLocavaTypes.js";
import { dedupeActivities } from "./activities/locavaActivities.js";

export function normalizeLocavaName(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ");
}

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function geometryIntentFor(feature: LocavaClassifierFeatureInput, decision: "spot" | "route"): LocavaGeometryIntent {
  if (decision === "route") return "line";
  if (feature.geometryKind === "polygon" || feature.closed) return "area_center";
  if (feature.geometryKind === "point") return "dot";
  if (feature.lat != null && feature.lng != null) return "dot";
  return "none";
}

function preferRoute(breakdown: { spotScore: number; routeScore: number }, feature: LocavaClassifierFeatureInput): boolean {
  if (feature.geometryKind === "line" && (feature.coordinates?.length ?? 0) >= 2) {
    if (isTrailLikeHighway(feature.tags)) return true;
    if (breakdown.routeScore >= breakdown.spotScore) return true;
  }
  if (feature.geometryKind === "polygon" || feature.closed) return false;
  return breakdown.routeScore > breakdown.spotScore + 10;
}

function isRouteCandidate(feature: LocavaClassifierFeatureInput, breakdown: ReturnType<typeof scoreOsmFeatureForLocava>): boolean {
  if ((feature.coordinates?.length ?? 0) < 2) return false;
  if (feature.geometryKind !== "line") return false;
  if (isTrailLikeHighway(feature.tags)) return breakdown.routeScore >= 30;
  if (tag(feature.tags, "route")) return breakdown.routeScore >= DECISION_THRESHOLD;
  return false;
}

export function classifyOsmFeatureForLocava(
  feature: LocavaClassifierFeatureInput,
  config: LocavaClassifierConfig
): LocavaClassificationResult {
  const breakdown = scoreOsmFeatureForLocava(feature, config);
  const normalizedName = normalizeLocavaName(feature.name);
  const named = hasRealName(feature);
  const highway = tag(feature.tags, "highway");

  let decision: "spot" | "route" | "reject" = "reject";
  let reason = "below_threshold";
  let rejectionReason: string | undefined = breakdown.hardRejectReason ?? "below_threshold";

  const routePreferred = preferRoute(breakdown, feature);
  const routeCandidate = isRouteCandidate(feature, breakdown);
  const effectiveScore = routePreferred ? breakdown.routeScore : Math.max(breakdown.spotScore, breakdown.routeScore);

  if (breakdown.hardReject && !breakdown.visitorOverride) {
    decision = "reject";
    reason = "hard_reject";
    rejectionReason = breakdown.hardRejectReason ?? "hard_reject";
  } else if (
    feature.geometryKind === "line" &&
    highway &&
    !isTrailLikeHighway(feature.tags) &&
    !tag(feature.tags, "route") &&
    !isBridgeSpot(feature.tags)
  ) {
    decision = "reject";
    reason = "linear_highway_not_trail";
    rejectionReason = breakdown.hardRejectReason ?? "linear_highway_not_trail";
  } else if (isBridgeSpot(feature.tags) && feature.lat != null && feature.lng != null && breakdown.spotScore >= 40) {
    decision = "spot";
    reason = "bridge_spot";
    rejectionReason = undefined;
  } else if (routeCandidate && routePreferred) {
    decision = "route";
    reason = "trail_route_signals";
    rejectionReason = undefined;
  } else if (
    breakdown.spotScore >= DECISION_THRESHOLD &&
    isDestinationSpotEligible(feature) &&
    feature.lat != null &&
    feature.lng != null &&
    (feature.geometryKind !== "line" || isBridgeSpot(feature.tags))
  ) {
    decision = "spot";
    reason = "destination_signals";
    rejectionReason = undefined;
  } else if (routePreferred && (feature.coordinates?.length ?? 0) < 2) {
    decision = "reject";
    reason = "route_missing_geometry";
    rejectionReason = "route_missing_geometry";
  } else {
    decision = "reject";
    if (!isDestinationSpotEligible(feature) && highway) rejectionReason = "linear_highway_not_spot";
    else if (!named && effectiveScore < 20) rejectionReason = "unnamed_infrastructure";
    else if (breakdown.hardRejectReason) rejectionReason = breakdown.hardRejectReason;
    else rejectionReason = "below_threshold";
    reason = rejectionReason;
  }

  if (
    decision === "reject" &&
    !breakdown.hardReject &&
    isStrongSwimmingOrBeachTagSignal(feature.tags) &&
    !isPrivateRecreationDestination(feature.tags) &&
    feature.lat != null &&
    feature.lng != null &&
    feature.geometryKind !== "line"
  ) {
    decision = "spot";
    reason = "swimming_beach_priority";
    rejectionReason = undefined;
  }

  if (decision === "spot" && !breakdown.primaryCategory) {
    decision = "reject";
    reason = "missing_category";
    rejectionReason = "missing_category";
  }

  if (decision === "spot" && breakdown.activities.length === 0) {
    decision = "reject";
    reason = "no_activity_metadata";
    rejectionReason = "no_activity_metadata";
  }

  if (decision === "spot") {
    breakdown.activities = dedupeActivities(breakdown.activities);
    if (breakdown.activities.length === 0) {
      decision = "reject";
      reason = "no_canonical_activity";
      rejectionReason = "no_canonical_activity";
    }
  }

  const confidence = confidenceFromScore(effectiveScore, breakdown.warnings);
  const { displayPriority, showAtZoom } = displayPriorityFromCategory(
    breakdown.primaryCategory,
    effectiveScore,
    decision === "reject" ? "spot" : decision
  );

  const finalDisplay =
    decision === "reject" || displayPriority === "hidden"
      ? { displayPriority: "hidden" as const, showAtZoom: 99 }
      : { displayPriority, showAtZoom };

  if (decision === "reject" && breakdown.negativeSignals.some((s) => s.startsWith("sidewalk"))) {
    rejectionReason = "sidewalk_or_crossing";
  }

  return {
    sourceKey: feature.sourceKey,
    sourceType: feature.sourceType,
    sourceId: feature.sourceId,
    name: feature.name,
    normalizedName,
    decision,
    confidence,
    locavaScore: Math.max(0, Math.min(100, effectiveScore)),
    primaryCategory: breakdown.primaryCategory,
    secondaryCategories: breakdown.secondaryCategories,
    activities: breakdown.activities,
    geometryIntent: decision === "reject" ? "none" : geometryIntentFor(feature, decision),
    reason,
    rejectionReason: decision === "reject" ? rejectionReason : undefined,
    displayPriority: finalDisplay.displayPriority,
    showAtZoom: finalDisplay.showAtZoom,
    tagSignals: breakdown.tagSignals,
    negativeSignals: breakdown.negativeSignals,
    warnings: breakdown.warnings,
    diagnostics: {
      spotScore: breakdown.spotScore,
      routeScore: breakdown.routeScore,
      hardReject: breakdown.hardReject,
      visitorOverride: breakdown.visitorOverride,
    },
  };
}

export function classifyOsmFeaturesForLocava(
  features: LocavaClassifierFeatureInput[],
  config: LocavaClassifierConfig
): LocavaClassificationResult[] {
  return features.map((feature) => classifyOsmFeatureForLocava(feature, config));
}
