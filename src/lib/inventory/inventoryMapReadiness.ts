import type { TitleQuality } from "./names/inventoryTitleGenerator.js";
import type { LocavaActivityResult } from "./activities/inventoryActivityGenerator.js";

export type MapReadiness = "ready" | "review" | "hidden";

export type MapReadinessResult = {
  mapReadiness: MapReadiness;
  readinessReason: string;
  readinessWarnings: string[];
};

const INFRASTRUCTURE_CATEGORIES = new Set([
  "parking",
  "toilets",
  "bench",
  "waste_basket",
  "street_lamp",
  "surveillance",
  "power",
  "transformer",
  "substation",
  "pipeline",
  "utility",
]);

const SUPPORT_CATEGORIES = new Set(["parking", "trailhead", "information", "shelter"]);

const NICHE_NATURAL_TAGS = new Set([
  "rock",
  "bare_rock",
  "stone",
  "peak",
  "hill",
  "ridge",
  "sand",
  "beach",
  "water",
  "wetland",
  "wood",
  "cliff",
  "cave_entrance",
  "spring",
  "waterfall",
]);

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function hasNicheNaturalSignal(tags: Record<string, string>, category?: string | null): boolean {
  const natural = tag(tags, "natural");
  if (natural && NICHE_NATURAL_TAGS.has(natural)) return true;
  if (tag(tags, "waterway") === "waterfall") return true;
  if (tag(tags, "historic") || tag(tags, "heritage") || tag(tags, "tourism")) return true;
  if (tag(tags, "leisure") === "nature_reserve") return true;
  if (category && /waterfall|viewpoint|peak|beach|swim|quarry|wetland|cave|ruins|bridge/.test(category)) return true;
  return false;
}

export function evaluateMapReadiness(input: {
  tags: Record<string, string>;
  category?: string | null;
  placeKind?: string | null;
  titleQuality: TitleQuality;
  activityResult: LocavaActivityResult;
  accessStatus?: string | null;
  itemKind: "spot" | "route";
  locavaScore?: number;
  debugMode?: boolean;
}): MapReadinessResult {
  const warnings: string[] = [];
  const access = input.accessStatus ?? tag(input.tags, "access") ?? tag(input.tags, "vehicle") ?? "unknown";
  const privateAccess = access === "private" || access === "no" || input.accessStatus === "private" || input.accessStatus === "restricted";

  if (privateAccess) {
    return { mapReadiness: "hidden", readinessReason: "private_or_no_access", readinessWarnings: ["access_private_no"] };
  }

  if (input.itemKind === "route") {
    const highway = tag(input.tags, "highway");
    const routeTag = tag(input.tags, "route");
    const trailHighway = highway && ["path", "footway", "track", "bridleway", "cycleway", "steps"].includes(highway);
    const trailRoute = routeTag && ["hiking", "foot", "walking", "running", "bicycle", "mtb"].includes(routeTag);
    if ((trailHighway || trailRoute) && input.activityResult.primaryActivity && input.titleQuality !== "bad") {
      return { mapReadiness: "ready", readinessReason: "named_public_trail_route", readinessWarnings: [] };
    }
  }

  if (input.placeKind === "support_feature" && !input.debugMode) {
    return { mapReadiness: "hidden", readinessReason: "support_feature", readinessWarnings: ["support_feature_hidden"] };
  }

  const cat = (input.category ?? "").toLowerCase();
  if (INFRASTRUCTURE_CATEGORIES.has(cat) && !input.debugMode) {
    return { mapReadiness: "hidden", readinessReason: "infrastructure_not_place", readinessWarnings: ["infrastructure"] };
  }

  if (SUPPORT_CATEGORIES.has(cat) && input.itemKind === "spot" && !input.debugMode) {
    return { mapReadiness: "hidden", readinessReason: "support_parking_or_info", readinessWarnings: ["support_category"] };
  }

  if (input.activityResult.activityWarnings.includes("no_strong_activity_signals")) {
    if (hasNicheNaturalSignal(input.tags, cat) && !["bad", "weak"].includes(input.titleQuality)) {
      warnings.push("niche_natural_low_activity");
    } else {
      return { mapReadiness: "hidden", readinessReason: "no_locava_activity_signal", readinessWarnings: ["name_only_or_weak"] };
    }
  }

  if (input.titleQuality === "bad") {
    if (hasNicheNaturalSignal(input.tags, cat) && input.activityResult.activities.length > 0) {
      return { mapReadiness: "review", readinessReason: "niche_natural_weak_title", readinessWarnings: ["weak_title_niche"] };
    }
    return { mapReadiness: "hidden", readinessReason: "bad_title", readinessWarnings: ["bad_title"] };
  }

  if (input.titleQuality === "weak" && !input.activityResult.primaryActivity) {
    return { mapReadiness: "review", readinessReason: "weak_title_no_primary_activity", readinessWarnings: ["weak_title"] };
  }

  if (!input.activityResult.primaryActivity && input.activityResult.activityConfidence === "low") {
    if (hasNicheNaturalSignal(input.tags, cat)) {
      return { mapReadiness: "review", readinessReason: "niche_natural_low_confidence", readinessWarnings: ["low_activity_confidence"] };
    }
    return { mapReadiness: "hidden", readinessReason: "low_activity_confidence", readinessWarnings: ["low_activity_confidence"] };
  }

  if (input.activityResult.activityConfidence === "low" && input.titleQuality !== "official") {
    return { mapReadiness: "review", readinessReason: "ready_but_low_confidence", readinessWarnings: warnings };
  }

  if (input.titleQuality === "weak" && !hasNicheNaturalSignal(input.tags, cat)) {
    return { mapReadiness: "review", readinessReason: "weak_generic_title", readinessWarnings: ["weak_title"] };
  }

  return { mapReadiness: "ready", readinessReason: "title_and_activity_ok", readinessWarnings: warnings };
}

export function applyMapReadinessToDisplayPriority(
  current: "hero" | "high" | "medium" | "low" | "hidden",
  readiness: MapReadiness
): "hero" | "high" | "medium" | "low" | "hidden" {
  if (readiness === "hidden") return "hidden";
  if (readiness === "review" && current === "hero") return "medium";
  if (readiness === "review" && current === "high") return "medium";
  return current;
}
