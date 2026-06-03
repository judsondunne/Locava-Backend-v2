/**
 * PBF Copier V2 — route activity, distance, and shape hints for map + write.
 */
import { distanceMetersForCoords, distanceMilesFromMeters, distanceLabel } from "../../../../lib/inventory/trails/inventoryTrailGraph.js";
import { haversineMeters } from "../../../../lib/inventory/inventoryTileGrid.js";
import { extractRoadClassSignals } from "../../../../lib/inventory/offroad/inventoryOffroadSignals.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export type PbfRouteShapeHint = "loop" | "out_and_back" | "point_to_point" | "unknown";

const LOOP_END_TOLERANCE_METERS = 85;
const OUT_AND_BACK_END_TOLERANCE_METERS = 120;

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

export function isClass4OrOffroadHighwayRoute(doc: PbfCopierPreviewDoc): boolean {
  if (doc.kind !== "unexplored_route") return false;
  const tags = doc.sourceTagSample ?? {};
  const roadClass = extractRoadClassSignals(tags, doc.displayName);
  if (roadClass.vtClass4 || roadClass.nhClass6 || roadClass.legalTrail) return true;
  const highway = tag(tags, "highway");
  if (highway === "track" || highway === "unclassified" || highway === "service") {
    if (
      tag(tags, "atv") === "yes" ||
      tag(tags, "ohv") === "yes" ||
      tag(tags, "ohrv") === "yes" ||
      tag(tags, "4wd_only") === "yes" ||
      tags.motor_vehicle === "yes"
    ) {
      return true;
    }
  }
  return false;
}

/** Class 4 / offroad highways: primary offroading, hiking second. */
export function enrichClass4OffroadRouteActivities(doc: PbfCopierPreviewDoc): PbfCopierPreviewDoc {
  if (!isClass4OrOffroadHighwayRoute(doc)) return doc;
  const tags = doc.sourceTagSample ?? {};
  const roadClass = extractRoadClassSignals(tags, doc.displayName);
  const category = roadClass.vtClass4
    ? "class4_road"
    : roadClass.legalTrail
      ? "legal_trail"
      : roadClass.nhClass6
        ? "class6_road"
        : "offroad_route";
  const acts = new Set<string>(["offroading", "hiking"]);
  for (const a of doc.activities ?? []) {
    if (a && a !== "offroading" && a !== "hiking") acts.add(a);
  }
  return {
    ...doc,
    primaryActivity: "offroading",
    primaryCategory: category,
    activities: ["offroading", "hiking", ...[...acts].filter((a) => a !== "offroading" && a !== "hiking")],
  };
}

export function routeLinePoints(doc: PbfCopierPreviewDoc): Array<{ lat: number; lng: number }> {
  if (doc.routeLineCoordinates && doc.routeLineCoordinates.length >= 2) return doc.routeLineCoordinates;
  if (doc.routeLineSegments?.length) {
    const longest = doc.routeLineSegments.reduce(
      (best, seg) => (seg.length > best.length ? seg : best),
      doc.routeLineSegments[0] ?? []
    );
    if (longest.length >= 2) return longest;
  }
  return [];
}

export function inferRouteShapeHint(
  coords: Array<{ lat: number; lng: number }>,
  tags: Record<string, string>
): PbfRouteShapeHint {
  if (tag(tags, "roundtrip") === "yes") return "loop";
  const routeTag = tag(tags, "route");
  if (routeTag === "roundtrip" || routeTag === "circular") return "loop";
  if (coords.length < 2) return "unknown";

  const start = coords[0]!;
  const end = coords[coords.length - 1]!;
  const endGap = haversineMeters(start, end);
  if (endGap <= LOOP_END_TOLERANCE_METERS) return "loop";

  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += haversineMeters(coords[i - 1]!, coords[i]!);
  }
  if (total > 400 && endGap <= OUT_AND_BACK_END_TOLERANCE_METERS) {
    const straight = haversineMeters(start, end);
    if (straight > 0 && total / straight >= 1.35) return "out_and_back";
  }

  return "point_to_point";
}

export function routeShapeLabel(shape: PbfRouteShapeHint): string {
  switch (shape) {
    case "loop":
      return "Loop";
    case "out_and_back":
      return "Out & back";
    case "point_to_point":
      return "Point to point";
    default:
      return "Unknown";
  }
}

export function enrichRouteDistanceAndShape(doc: PbfCopierPreviewDoc): PbfCopierPreviewDoc {
  if (doc.kind !== "unexplored_route") return doc;
  const coords = routeLinePoints(doc);
  if (coords.length < 2) return doc;

  const tags = doc.sourceTagSample ?? {};
  const meters = doc.distanceMeters ?? distanceMetersForCoords(coords);
  const miles = doc.distanceMiles ?? distanceMilesFromMeters(meters);
  const shape = inferRouteShapeHint(coords, tags);

  return {
    ...doc,
    distanceMeters: meters,
    distanceMiles: miles,
    distanceLabel: doc.distanceLabel ?? distanceLabel(miles),
    routeShapeHint: shape,
    geometryPointCount: coords.length,
  };
}

export function enrichRoutePreviewDoc(doc: PbfCopierPreviewDoc): PbfCopierPreviewDoc {
  if (doc.kind !== "unexplored_route") return doc;
  return enrichRouteDistanceAndShape(enrichClass4OffroadRouteActivities(doc));
}
