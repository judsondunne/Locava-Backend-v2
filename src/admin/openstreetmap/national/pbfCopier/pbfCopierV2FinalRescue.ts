/**
 * Absolute last pass before preview/product output — rescue good renderables, hide slipped junk.
 */
import { normalizePreviewDisplayName } from "./pbfCopierPreviewQuality.js";
import {
  buildUnnamedHikingTrailContext,
  deriveUnnamedHikingTrailName,
  getEffectiveOsmTags,
  isRealUnmarkedHikingTrail,
  isSelfAttachedRoute,
  isSyntheticRouteDisplayName,
  isTrainBridgeCandidate,
  isWalkingPathJunk,
  type UnnamedHikingTrailContext,
} from "./pbfCopierV2DestinationQuality.js";
import {
  isProtectedLocavaDestination,
  isLocavaFoodDrinkDestination,
  isLocavaLocalRetailDestination,
} from "./pbfCopierV2LocavaProductRules.js";
import { hikingTrailColorForName } from "./pbfCopierV2RawDisplay.js";
import {
  emptyDestinationQualityCounters,
  type PbfDestinationQualityCounters,
} from "./pbfCopierV2DestinationQuality.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export const V2_FINAL_RESCUE_TRAIN_BRIDGE = "v2_final_rescue_train_bridge";
export const V2_FINAL_RESCUE_UNMARKED_HIKING = "v2_final_rescue_unmarked_hiking_trail";
export const V2_FINAL_HIDE_INDUSTRIAL_BUILDING = "v2_final_hide_industrial_building";

export type FinalRescueContext = {
  trailContext?: UnnamedHikingTrailContext;
};

const RAIL_RESCUE_TYPES = new Set([
  "rail",
  "disused",
  "abandoned",
  "preserved",
  "narrow_gauge",
  "light_rail",
  "tram",
]);

const TRAIL_SURFACES = new Set([
  "ground",
  "dirt",
  "earth",
  "gravel",
  "woodchips",
  "unpaved",
  "compacted",
  "grass",
  "rock",
]);

const PAVED_SURFACES = new Set(["asphalt", "paved", "concrete", "cement", "paving_stones"]);

const FINAL_HIDE_BUILDINGS = new Set([
  "warehouse",
  "hangar",
  "factory",
  "industrial",
  "manufacture",
  "storage",
  "garages",
  "shed",
  "barn",
  "greenhouse",
  "roof",
  "garage",
  "commercial",
  "retail",
  "office",
  "civic",
]);

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function hasOsmNameTag(tags: Record<string, string>): boolean {
  const name = tags.name?.trim() || tags["name:en"]?.trim();
  return Boolean(name && name.length >= 1);
}

function hasExplicitDestinationTag(tags: Record<string, string>): boolean {
  if (tag(tags, "amenity")) return true;
  if (tag(tags, "shop")) return true;
  if (tag(tags, "tourism")) return true;
  const leisure = tag(tags, "leisure");
  if (leisure && ["park", "nature_reserve", "swimming_area", "beach_resort", "marina"].includes(leisure)) {
    return true;
  }
  if (tag(tags, "historic")) return true;
  if (tag(tags, "natural") === "peak" || tag(tags, "natural") === "beach") return true;
  return false;
}

function hasLineGeometry(doc: PbfCopierPreviewDoc): boolean {
  const coords = doc.routeLineCoordinates ?? doc.routeLineSegments?.find((s) => s.length >= 2);
  return Boolean(coords && coords.length >= 2);
}

function lineMidpoint(doc: PbfCopierPreviewDoc): { lat: number; lng: number } {
  const coords = doc.routeLineCoordinates ?? doc.routeLineSegments?.find((s) => s.length >= 2);
  if (coords && coords.length >= 2) {
    const idx = Math.floor(coords.length / 2);
    return coords[idx] ?? coords[0]!;
  }
  return { lat: doc.lat, lng: doc.lng };
}

function hasTrailSupportMetadata(doc: PbfCopierPreviewDoc): boolean {
  const meta = doc.supportMetadata;
  if (!meta) return false;
  return Boolean(
    meta.trailheads?.length ||
      meta.viewpoints?.length ||
      meta.waterfalls?.length ||
      meta.shelters?.length ||
      meta.informationMaps?.length ||
      meta.parking?.length
  );
}

function isFinalRailroadBridge(doc: PbfCopierPreviewDoc): boolean {
  const tags = getEffectiveOsmTags(doc);
  const railway = tag(tags, "railway");
  if (!railway || !RAIL_RESCUE_TYPES.has(railway)) return false;
  if (railway === "level_crossing") return false;
  const bridge = tag(tags, "bridge");
  if (!bridge || bridge === "no") return false;
  return hasLineGeometry(doc) || (doc.lat != null && doc.lng != null);
}

function hasFinalUnmarkedHikingEvidence(
  doc: PbfCopierPreviewDoc,
  tags: Record<string, string>,
  trailContext: UnnamedHikingTrailContext
): boolean {
  const footway = tag(tags, "footway");
  if (footway && ["sidewalk", "crossing", "access_aisle"].includes(footway)) return false;
  if (tag(tags, "service") === "driveway" || tag(tags, "service") === "parking_aisle") return false;

  const highway = tag(tags, "highway");
  if (highway !== "path" && highway !== "footway" && highway !== "track") return false;

  const surface = tag(tags, "surface");
  if (surface && PAVED_SURFACES.has(surface)) return false;
  if (isWalkingPathJunk(doc)) return false;

  if (surface && TRAIL_SURFACES.has(surface)) return true;
  if (tag(tags, "trail_visibility") || tag(tags, "sac_scale")) return true;
  const foot = tag(tags, "foot");
  if (foot && ["yes", "designated", "permissive"].includes(foot)) return true;
  if (hasTrailSupportMetadata(doc)) return true;
  return isRealUnmarkedHikingTrail(doc, trailContext);
}

function deriveFinalTrainBridgeName(doc: PbfCopierPreviewDoc, tags: Record<string, string>): string {
  const candidates = [
    doc.displayName?.trim(),
    tags.name?.trim(),
    tags["name:en"]?.trim(),
    tags["railway:name"]?.trim(),
    tags.ref?.trim(),
    tags.operator?.trim(),
  ].filter(Boolean) as string[];

  for (const raw of candidates) {
    if (isSyntheticRouteDisplayName(raw)) continue;
    if (/\bbridge\b/i.test(raw)) return raw;
    return `${raw} Train Bridge`;
  }
  return "Train Bridge";
}

function sanitizeFinalDisplayName(doc: PbfCopierPreviewDoc): string {
  const name = (doc.displayName || "").trim();
  if (!name.toLowerCase().startsWith("highway=")) return name;

  if (doc.primaryActivity === "train_bridge") {
    const tags = getEffectiveOsmTags(doc);
    return deriveFinalTrainBridgeName(doc, tags);
  }
  if (doc.primaryActivity === "hiking" || doc.kind === "unexplored_route") {
    if (/\bconnector\b/i.test(name)) return "Connector Trail";
    return "Unnamed Hiking Trail";
  }
  return name.replace(/^highway=\S+\s*/i, "").trim() || "Unnamed Hiking Trail";
}

function shouldFinalHideNonDestination(doc: PbfCopierPreviewDoc): string | null {
  if (doc.filteredOut) return null;
  if (isProtectedLocavaDestination(doc)) return null;
  if (isLocavaFoodDrinkDestination(doc) || isLocavaLocalRetailDestination(doc)) return null;

  const tags = getEffectiveOsmTags(doc);
  if (hasExplicitDestinationTag(tags)) return null;

  const building = tag(tags, "building");
  if (building && FINAL_HIDE_BUILDINGS.has(building)) {
    return `generic building=${building}`;
  }

  const display = (doc.displayName || "").trim().toLowerCase();
  if (display.startsWith("building=")) return "synthetic building label";
  if (display.startsWith("landuse=") || display.startsWith("man_made=")) return "synthetic infrastructure label";

  const landuse = tag(tags, "landuse");
  if (landuse && ["industrial", "commercial", "retail", "garages"].includes(landuse) && !hasOsmNameTag(tags)) {
    return `generic landuse=${landuse}`;
  }

  return null;
}

function rescueTrainBridge(
  doc: PbfCopierPreviewDoc,
  counters: PbfDestinationQualityCounters
): PbfCopierPreviewDoc {
  const tags = getEffectiveOsmTags(doc);
  const anchor = doc.routeMarkerCoordinate ?? lineMidpoint(doc);
  const center = doc.routeCenterCoordinate ?? anchor;
  const displayName = deriveFinalTrainBridgeName(doc, tags);

  counters.finalRescuedTrainBridges += 1;

  return {
    ...doc,
    displayName,
    primaryActivity: "train_bridge",
    primaryCategory: "bridge",
    activities: ["train_bridge", "sightseeing"],
    filteredOut: false,
    filteredBy: [],
    filterReason: undefined,
    lat: anchor.lat,
    lng: anchor.lng,
    center: anchor,
    routeMarkerCoordinate: anchor,
    routeCenterCoordinate: center,
    routeLineColor: doc.routeLineColor ?? "#64748b",
    warnings: [...(doc.warnings ?? []), V2_FINAL_RESCUE_TRAIN_BRIDGE],
  };
}

function rescueUnmarkedHikingTrail(
  doc: PbfCopierPreviewDoc,
  trailContext: UnnamedHikingTrailContext,
  counters: PbfDestinationQualityCounters
): PbfCopierPreviewDoc {
  const derived = deriveUnnamedHikingTrailName(doc, trailContext);
  const anchor = doc.routeMarkerCoordinate ?? lineMidpoint(doc);
  const center = doc.routeCenterCoordinate ?? anchor;
  const colorKey =
    normalizePreviewDisplayName(derived.displayName) || `osm/${doc.osmType}/${doc.osmId}`;
  const displayName = sanitizeFinalDisplayName({
    ...doc,
    displayName: isSyntheticRouteDisplayName(doc.displayName) ? derived.displayName : doc.displayName,
  });

  counters.finalRescuedUnmarkedHikingTrails += 1;

  return {
    ...doc,
    displayName,
    derivedName: true,
    primaryActivity: "hiking",
    primaryCategory: doc.primaryCategory === "osm" ? "hiking" : doc.primaryCategory,
    activities: doc.activities?.includes("hiking") ? doc.activities : ["hiking", ...(doc.activities ?? [])],
    filteredOut: false,
    filteredBy: (doc.filteredBy ?? []).filter(
      (k) => k !== "support_attached" && k !== "unnamed_path" && k !== "generic_footway"
    ),
    filterReason: undefined,
    attachedToRouteId: undefined,
    attachedTo: undefined,
    attachReason: undefined,
    lat: anchor.lat,
    lng: anchor.lng,
    center: anchor,
    routeMarkerCoordinate: anchor,
    routeCenterCoordinate: center,
    routeLineColor: doc.routeLineColor ?? hikingTrailColorForName(colorKey),
    warnings: [...(doc.warnings ?? []), V2_FINAL_RESCUE_UNMARKED_HIKING],
  };
}

function preventSelfAttachedRoute(
  doc: PbfCopierPreviewDoc,
  counters: PbfDestinationQualityCounters
): PbfCopierPreviewDoc {
  if (!isSelfAttachedRoute(doc)) return doc;
  counters.finalPreventedSelfAttachedRoutes += 1;

  const filteredBy = (doc.filteredBy ?? []).filter((k) => k !== "support_attached");
  return {
    ...doc,
    filteredOut: filteredBy.length > 0 ? doc.filteredOut : false,
    filteredBy,
    filterReason: filteredBy.length ? doc.filterReason : undefined,
    attachedToRouteId: undefined,
    attachedTo: undefined,
    attachReason: undefined,
  };
}

/** Last step: hide slipped junk, rescue rail bridges + unmarked hiking trails, sanitize names. */
export function rescueFinalRenderableDestinations(
  items: PbfCopierPreviewDoc[],
  context: FinalRescueContext = {},
  counters: PbfDestinationQualityCounters = emptyDestinationQualityCounters()
): PbfCopierPreviewDoc[] {
  const trailContext = context.trailContext ?? buildUnnamedHikingTrailContext(items);

  const pass1 = items.map((raw) => {
    const hideReason = shouldFinalHideNonDestination(raw);
    if (hideReason) {
      counters.finalHiddenIndustrialBuildings += 1;
      return {
        ...raw,
        filteredOut: true,
        filteredBy: [...new Set([...(raw.filteredBy ?? []), "map_junk"])],
        filterReason: hideReason,
        warnings: [...(raw.warnings ?? []), V2_FINAL_HIDE_INDUSTRIAL_BUILDING],
      };
    }
    return raw;
  });

  return pass1.map((raw) => {
    let doc: PbfCopierPreviewDoc = { ...raw };
    const tags = getEffectiveOsmTags(doc);

    const railway = tag(tags, "railway");
    if (railway === "level_crossing") {
      if (doc.filteredOut) counters.finalKeptWalkingPathsHidden += 0;
      counters.finalNormalRailwaysStillHidden += doc.filteredOut ? 1 : 0;
      return doc;
    }
    if (railway && RAIL_RESCUE_TYPES.has(railway) && !isTrainBridgeCandidate(tags)) {
      counters.finalNormalRailwaysStillHidden += doc.filteredOut ? 1 : 0;
    }

    if (isWalkingPathJunk(doc) && doc.filteredOut) {
      counters.finalKeptWalkingPathsHidden += 1;
    }

    if (doc.kind === "unexplored_route" && doc.primaryActivity === "hiking") {
      doc = preventSelfAttachedRoute(doc, counters);
    }

    if (isFinalRailroadBridge(doc)) {
      doc = rescueTrainBridge(doc, counters);
    } else if (
      doc.kind === "unexplored_route" &&
      doc.primaryActivity === "hiking" &&
      hasLineGeometry(doc) &&
      hasFinalUnmarkedHikingEvidence(doc, tags, trailContext)
    ) {
      const needsRescue =
        doc.filteredOut ||
        (doc.filteredBy ?? []).some((k) =>
          ["support_attached", "unnamed_path", "generic_footway", "non_destination_amenity", "map_junk"].includes(k)
        ) ||
        !doc.routeMarkerCoordinate ||
        !doc.routeLineColor ||
        isSyntheticRouteDisplayName(doc.displayName);
      if (needsRescue) {
        doc = rescueUnmarkedHikingTrail(doc, trailContext, counters);
      }
    }

    if (!doc.filteredOut) {
      const sanitized = sanitizeFinalDisplayName(doc);
      if (sanitized !== doc.displayName) {
        doc = { ...doc, displayName: sanitized, derivedName: true };
      }
    }

    return doc;
  });
}
