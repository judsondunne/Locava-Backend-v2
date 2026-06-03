/**
 * Map presentation rules shared with the PBF Copier V2 dashboard (MapLibre preview).
 */
import { hikingTrailColorForName } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2RawDisplay.js";

export { HIKING_TRAIL_LINE_COLORS } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2RawDisplay.js";

export type RouteMapPresentation = {
  trailLike: boolean;
  routeLineColor: string;
  lineWidth: number;
  lineOpacity: number;
  showTrailStartDot: boolean;
};

function tag(data: Record<string, unknown>, key: string): string | undefined {
  const source = data.source as { tags?: Record<string, string> } | undefined;
  const tags =
    source?.tags && typeof source.tags === "object"
      ? source.tags
      : (data.sourceTags as Record<string, string> | undefined);
  const v = tags?.[key];
  return typeof v === "string" ? v.trim().toLowerCase() : undefined;
}

function hasWarning(data: Record<string, unknown>, needle: string): boolean {
  const warnings = data.warnings;
  if (!Array.isArray(warnings)) return false;
  return warnings.some((w) => w === needle);
}

/** Mirrors `isTrailLikeRouteForMap` in openstreetmap-pbf-copier-v2.ts */
export function isTrailLikeRouteDoc(data: Record<string, unknown>): boolean {
  if (hasWarning(data, "v2_hiking_trail_merged")) return true;
  if (typeof data.routeLineColor === "string" && data.routeLineColor.trim()) return true;
  const highway = tag(data, "highway") ?? "";
  if (tag(data, "footway") === "sidewalk" || tag(data, "foot") === "no") return false;
  if (tag(data, "sac_scale") || tag(data, "trail_visibility")) return true;
  const route = tag(data, "route") ?? "";
  if (route === "hiking" || route === "foot" || route === "walking") return true;
  if (highway === "path" || highway === "steps" || highway === "bridleway" || highway === "footway") {
    return true;
  }
  if (highway === "track") {
    const foot = tag(data, "foot") ?? "";
    if (
      foot === "designated" ||
      foot === "yes" ||
      foot === "permissive" ||
      tag(data, "hiking") === "yes"
    ) {
      return true;
    }
  }
  const act = String(data.primaryActivity ?? data.category ?? "").toLowerCase();
  if (act.includes("hik") || act.includes("walk")) return true;
  const routeKind = String(data.routeKind ?? data.routeType ?? "").toLowerCase();
  if (routeKind.includes("hiking") || routeKind.includes("trail")) return true;
  return false;
}

export function resolveRouteMapPresentation(data: Record<string, unknown>): RouteMapPresentation {
  const trailLike = isTrailLikeRouteDoc(data);
  const title =
    (typeof data.displayName === "string" && data.displayName) ||
    (typeof data.title === "string" && data.title) ||
    (typeof data.id === "string" ? data.id : "");
  const explicitColor =
    typeof data.routeLineColor === "string" && data.routeLineColor.trim()
      ? data.routeLineColor.trim()
      : null;
  const routeLineColor =
    explicitColor ?? (trailLike ? hikingTrailColorForName(title) : "#64748b");
  return {
    trailLike,
    routeLineColor,
    lineWidth: trailLike ? 3 : 1.5,
    lineOpacity: trailLike ? 0.4 : 0.26,
    showTrailStartDot: trailLike,
  };
}
