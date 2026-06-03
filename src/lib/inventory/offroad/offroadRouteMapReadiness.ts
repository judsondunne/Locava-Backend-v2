import type { LocavaInventoryRoute } from "../inventoryLocavaTypes.js";
import { formatOffroadDisplayName } from "./offroadDisplayName.js";

export type OffroadRouteReadiness = "ready" | "review" | "hidden";

export function evaluateOffroadRouteMapReadiness(route: LocavaInventoryRoute): {
  mapReadiness: OffroadRouteReadiness;
  readinessReason: string;
  readinessWarnings: string[];
} {
  const access = route.offroad?.accessStatus ?? "unknown";
  const confidence = route.offroad?.offroadConfidence ?? "candidate";
  const source = route.source;
  const warnings = [...(route.offroad?.accessWarnings ?? [])];

  if (access === "private") {
    return { mapReadiness: "hidden", readinessReason: "private_access", readinessWarnings: ["private_access"] };
  }
  if (access === "restricted" || route.displayPriority === "hidden") {
    return { mapReadiness: "hidden", readinessReason: "restricted_or_hidden", readinessWarnings: ["restricted"] };
  }

  const officialState =
    source === "vtrans_public_highway_system" || source === "nhdot_legislative_class";
  const officialFederal = source === "usfs_mvum" || source === "blm_gtlf";
  const limitedBlm = source === "blm_gtlf" && access === "limited";

  if (officialState && access === "limited") {
    return {
      mapReadiness: "review",
      readinessReason: "official_state_limited_access",
      readinessWarnings: warnings,
    };
  }

  if (officialState && confidence === "explicit") {
    return { mapReadiness: "ready", readinessReason: "official_state_offroad", readinessWarnings: warnings };
  }
  if (officialFederal && !limitedBlm) {
    return { mapReadiness: "ready", readinessReason: "official_federal_mvum_or_blm", readinessWarnings: warnings };
  }
  if (limitedBlm) {
    return { mapReadiness: "review", readinessReason: "blm_limited_motorized", readinessWarnings: warnings };
  }
  if (confidence === "explicit" || confidence === "strong") {
    return { mapReadiness: "review", readinessReason: "osm_explicit_offroad", readinessWarnings: warnings };
  }
  return { mapReadiness: "review", readinessReason: "osm_candidate_offroad", readinessWarnings: warnings };
}

export function applyOffroadMapReadinessToRoutes(routes: LocavaInventoryRoute[]): LocavaInventoryRoute[] {
  return routes.map((route) => {
    const readiness = evaluateOffroadRouteMapReadiness(route);
    const name = formatOffroadDisplayName(route.name);
    return {
      ...route,
      name,
      normalizedName: route.normalizedName ?? name.toLowerCase(),
      mapReadiness: readiness.mapReadiness,
      readinessReason: readiness.readinessReason,
      titleWarnings: [...new Set([...(route.titleWarnings ?? []), ...readiness.readinessWarnings])],
      primaryActivity: route.primaryActivity ?? "offroading",
      activityConfidence: route.activityConfidence ?? (readiness.mapReadiness === "ready" ? "high" : "medium"),
    };
  });
}
