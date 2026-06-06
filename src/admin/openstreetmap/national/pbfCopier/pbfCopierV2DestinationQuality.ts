/**
 * PBF Copier V2 — focused destination quality rules (residential junk, rail bridges, unnamed trails).
 */
import {
  collectNamedTrailLines,
  collectRecreationAreaPoints,
  isNearRecreationArea,
  minDistanceToNamedTrailMeters,
  minDistanceToPolylineMeters,
  type NamedTrailLine,
  type RecreationAreaPoint,
} from "./pbfCopierV2TrailProximity.js";
import { normalizePreviewDisplayName } from "./pbfCopierPreviewQuality.js";
import { hikingTrailColorForName, isHikingTrailPreviewDoc } from "./pbfCopierV2RawDisplay.js";
import { haversineMeters } from "./pbfCopierV2SupportObjects.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export const V2_TRAIN_BRIDGE_WARNING = "v2_train_bridge_over_water";
export const V2_TRAIN_BRIDGE_FORCED_WARNING = "v2_train_bridge_forced_visible";
export const V2_UNNAMED_HIKING_TRAIL_WARNING = "v2_unnamed_hiking_trail";
export const V2_SUPPRESSED_BRIDGE_DUPLICATE_WARNING = "v2_suppressed_rail_bridge_duplicate";

export type PbfDestinationQualityCounters = {
  residentialNonDestinationsFiltered: number;
  railWaterBridgesIncluded: number;
  railBridgesForcedVisible: number;
  railroadBridgesForcedVisible: number;
  normalRailwaysStillHidden: number;
  unnamedHikingTrailsIncluded: number;
  unnamedPathsStillFiltered: number;
  realUnmarkedHikingTrailsForcedVisible: number;
  walkingPathsKeptHidden: number;
  selfAttachedRoutesFixed: number;
  selfAttachedRoutesUnhidden: number;
  unnamedHikingRoutesForcedVisible: number;
  supportAttachedRoutesSkippedBecausePrimaryRoute: number;
  activitiesEnrichedWithEvidence: number;
  activitiesSkippedNoEvidence: number;
  finalRescuedTrainBridges: number;
  finalRescuedUnmarkedHikingTrails: number;
  finalPreventedSelfAttachedRoutes: number;
  finalKeptWalkingPathsHidden: number;
  finalNormalRailwaysStillHidden: number;
  finalHiddenIndustrialBuildings: number;
};

export function emptyDestinationQualityCounters(): PbfDestinationQualityCounters {
  return {
    residentialNonDestinationsFiltered: 0,
    railWaterBridgesIncluded: 0,
    railBridgesForcedVisible: 0,
    railroadBridgesForcedVisible: 0,
    normalRailwaysStillHidden: 0,
    unnamedHikingTrailsIncluded: 0,
    unnamedPathsStillFiltered: 0,
    realUnmarkedHikingTrailsForcedVisible: 0,
    walkingPathsKeptHidden: 0,
    selfAttachedRoutesFixed: 0,
    selfAttachedRoutesUnhidden: 0,
    unnamedHikingRoutesForcedVisible: 0,
    supportAttachedRoutesSkippedBecausePrimaryRoute: 0,
    activitiesEnrichedWithEvidence: 0,
    activitiesSkippedNoEvidence: 0,
    finalRescuedTrainBridges: 0,
    finalRescuedUnmarkedHikingTrails: 0,
    finalPreventedSelfAttachedRoutes: 0,
    finalKeptWalkingPathsHidden: 0,
    finalNormalRailwaysStillHidden: 0,
    finalHiddenIndustrialBuildings: 0,
  };
}

/** Merge writePayload tags with preview sample (priority keys always sampled). */
export function getEffectiveOsmTags(doc: PbfCopierPreviewDoc): Record<string, string> {
  const sample = doc.sourceTagSample ?? {};
  const payload = doc.writePayload as Record<string, unknown> | undefined;
  const fromPayload =
    (payload?.osmTags as Record<string, string> | undefined) ??
    (payload?.tags as Record<string, string> | undefined);
  return fromPayload ? { ...fromPayload, ...sample } : sample;
}

const SYNTHETIC_ROUTE_NAME_RE = /^(highway|osm way|osm node|railway)=/i;

export function isSyntheticRouteDisplayName(name: string | undefined): boolean {
  const raw = (name || "").trim();
  if (!raw) return true;
  if (SYNTHETIC_ROUTE_NAME_RE.test(raw)) return true;
  const key = normalizePreviewDisplayName(raw);
  if (!key) return true;
  if (/^(highway|amenity|natural|landuse|man made|shop|tourism|building|waterway|railway) /.test(key)) {
    return true;
  }
  return false;
}

/** True for accepted hiking line routes that must stay visible (not support-only). */
export function isPrimaryHikingRoute(doc: PbfCopierPreviewDoc): boolean {
  if (doc.kind !== "unexplored_route") return false;
  const tags = getEffectiveOsmTags(doc);
  if (tag(tags, "footway") === "sidewalk" || tag(tags, "footway") === "crossing" || tag(tags, "footway") === "access_aisle") {
    return false;
  }
  if (tag(tags, "service") === "driveway" || tag(tags, "service") === "parking_aisle") return false;
  if (isWalkingPathJunk(doc)) return false;
  if (doc.primaryActivity === "hiking" || doc.primaryCategory === "hiking") return true;
  if (doc.warnings?.includes("v2_hiking_trail_merged") || doc.warnings?.includes(V2_UNNAMED_HIKING_TRAIL_WARNING)) {
    return true;
  }
  return isHikingTrailPreviewDoc(doc);
}

export function isSameOsmItem(a: PbfCopierPreviewDoc, b: PbfCopierPreviewDoc): boolean {
  return a.osmType === b.osmType && a.osmId === b.osmId;
}

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function hasTag(tags: Record<string, string>, key: string): boolean {
  return Boolean(tags[key]?.trim());
}

function hasOsmNameTag(tags: Record<string, string>): boolean {
  const name = tags.name?.trim() || tags["name:en"]?.trim();
  return Boolean(name && name.length >= 1);
}

function hasMeaningfulBridgeName(doc: PbfCopierPreviewDoc, name: string): boolean {
  const raw = name.trim().toLowerCase();
  if (!raw) return false;
  if (raw.startsWith("highway=") || raw.startsWith("osm way/") || raw.startsWith("osm node/")) return false;
  const key = normalizePreviewDisplayName(name);
  if (!key) return false;
  if (/^(highway|amenity|natural|landuse|man made|shop|tourism|building|waterway|railway) /.test(key)) {
    return false;
  }
  return true;
}

const RESIDENTIAL_LANDUSE = new Set(["residential", "apartments"]);
const RESIDENTIAL_SUBTAG = new Set([
  "condominium",
  "apartments",
  "mobile_home",
  "trailer_park",
  "housing_estate",
]);
const HOUSING_PLACE_LABELS = new Set(["neighbourhood", "neighborhood", "suburb", "hamlet"]);
const RESIDENTIAL_BUILDING = new Set([
  "house",
  "residential",
  "apartments",
  "detached",
  "semidetached",
  "terrace",
  "dormitory",
  "garage",
  "shed",
  "commercial",
  "yes",
]);

const DESTINATION_AMENITY = new Set([
  "restaurant",
  "cafe",
  "bar",
  "pub",
  "library",
  "theatre",
  "arts_centre",
  "community_centre",
  "biergarten",
  "fast_food",
  "marketplace",
]);

const DESTINATION_LEISURE = new Set(["park", "nature_reserve", "recreation_ground", "garden"]);
const DESTINATION_NATURAL = new Set([
  "peak",
  "beach",
  "waterfall",
  "cliff",
  "cave_entrance",
  "spring",
  "wood",
  "scrub",
  "wetland",
]);

const ALLOWED_RETAIL_SHOPS = new Set([
  "bakery",
  "farm",
  "coffee",
  "deli",
  "pastry",
  "confectionery",
  "cheese",
  "wine",
  "bicycle",
  "bike",
  "ski",
  "outdoor",
  "books",
  "book",
  "supermarket",
  "convenience",
  "greengrocer",
  "seafood",
  "butcher",
  "alcohol",
  "sports",
  "clothes",
  "art",
  "gift",
  "craft",
  "florist",
  "chocolate",
  "toy",
  "toys",
  "general",
  "antiques",
  "variety",
]);

const RAIL_BRIDGE_RAILWAY = new Set([
  "rail",
  "disused",
  "abandoned",
  "preserved",
  "narrow_gauge",
  "light_rail",
  "tram",
  "subway",
  "monorail",
  "funicular",
]);

const WATERWAY_VALUES = new Set(["river", "stream", "brook", "canal", "ditch"]);
const WATER_TAG_VALUES = new Set(["river", "pond", "lake", "reservoir"]);

const TRAIL_SURFACES = new Set([
  "dirt",
  "ground",
  "earth",
  "grass",
  "gravel",
  "woodchips",
  "compacted",
  "unpaved",
  "rock",
]);

const PAVED_SURFACES = new Set(["asphalt", "concrete", "paved", "paving_stones"]);

const OUTDOOR_OPERATOR_PATTERN =
  /\b(gmc|green mountain club|doc|department of conservation|park service|forest service|conservation|land trust|national park|state park|appalachian trail|atc)\b/i;

const MIN_UNNAMED_TRAIL_METERS = 60;
const RAIL_WATER_PROXIMITY_METERS = 20;
const BRIDGE_DUPLICATE_SUPPRESS_METERS = 45;

/** True when OSM tags describe housing/subdivision geometry, not a visitor destination. */
export function hasExplicitResidentialDestinationExemption(tags: Record<string, string>): boolean {
  const amenity = tag(tags, "amenity");
  if (amenity && DESTINATION_AMENITY.has(amenity)) return true;

  const shop = tag(tags, "shop");
  if (shop && ALLOWED_RETAIL_SHOPS.has(shop)) return true;

  if (hasTag(tags, "tourism")) return true;
  if (hasTag(tags, "historic")) return true;

  const leisure = tag(tags, "leisure");
  if (leisure && DESTINATION_LEISURE.has(leisure)) return true;

  const natural = tag(tags, "natural");
  if (natural && DESTINATION_NATURAL.has(natural)) return true;

  if (tag(tags, "waterway") === "waterfall" || tag(tags, "natural") === "waterfall") return true;
  if (tag(tags, "highway") === "trailhead") return true;
  if (tag(tags, "route") === "hiking" || tag(tags, "route") === "foot") return true;

  return false;
}

export function isResidentialNonDestination(tags: Record<string, string>): boolean {
  if (hasExplicitResidentialDestinationExemption(tags)) return false;

  const landuse = tag(tags, "landuse");
  if (landuse && RESIDENTIAL_LANDUSE.has(landuse)) return true;

  const residential = tag(tags, "residential");
  if (residential && RESIDENTIAL_SUBTAG.has(residential)) return true;

  const place = tag(tags, "place");
  if (place && HOUSING_PLACE_LABELS.has(place)) return true;

  const building = tag(tags, "building");
  if (building && RESIDENTIAL_BUILDING.has(building)) return true;

  return false;
}

export function matchResidentialNonDestination(doc: PbfCopierPreviewDoc): { reason: string } | null {
  const tags = doc.sourceTagSample ?? {};
  if (!isResidentialNonDestination(tags)) return null;
  const landuse = tag(tags, "landuse");
  const residential = tag(tags, "residential");
  const building = tag(tags, "building");
  const place = tag(tags, "place");
  if (landuse) return { reason: `residential landuse=${landuse}, not destination` };
  if (residential) return { reason: `residential=${residential}, not destination` };
  if (building) return { reason: `residential building=${building}, not destination` };
  if (place) return { reason: `housing place=${place}, not destination` };
  return { reason: "non-destination residential area" };
}

export type UnnamedHikingTrailContext = {
  namedTrails: NamedTrailLine[];
  recreationAreas: RecreationAreaPoint[];
  acceptedTrailDocs: PbfCopierPreviewDoc[];
};

function polylineLengthMeters(coords: Array<{ lat: number; lng: number }> | undefined): number {
  if (!coords || coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineMeters(
      coords[i - 1]!.lat,
      coords[i - 1]!.lng,
      coords[i]!.lat,
      coords[i]!.lng
    );
  }
  return total;
}

function isRejectedPathHighway(tags: Record<string, string>): boolean {
  const footway = tag(tags, "footway");
  if (footway && ["sidewalk", "crossing", "access_aisle"].includes(footway)) return true;

  const highway = tag(tags, "highway");
  if (highway && ["service", "residential", "primary", "secondary", "tertiary"].includes(highway)) {
    return true;
  }

  const service = tag(tags, "service");
  if (service && ["driveway", "parking_aisle"].includes(service)) return true;

  return false;
}

function hasTrailSupportMetadata(doc: PbfCopierPreviewDoc): boolean {
  const meta = doc.supportMetadata;
  if (!meta) return false;
  return Boolean(
    meta.trailheads?.length ||
      meta.viewpoints?.length ||
      meta.waterfalls?.length ||
      meta.shelters?.length ||
      meta.informationMaps?.length
  );
}

function hasStrongTrailSignal(tags: Record<string, string>): boolean {
  const foot = tag(tags, "foot");
  if (foot && ["yes", "designated", "permissive"].includes(foot)) return true;
  if (hasTag(tags, "sac_scale") || hasTag(tags, "trail_visibility")) return true;

  const surface = tag(tags, "surface");
  if (surface && TRAIL_SURFACES.has(surface)) return true;

  if (tag(tags, "motor_vehicle") === "no") return true;

  const bicycle = tag(tags, "bicycle");
  const horse = tag(tags, "horse");
  if ((bicycle === "no" || horse === "no") && foot && foot !== "no") return true;

  const operator = tags.operator?.trim() || tags["operator:type"]?.trim() || "";
  if (operator && OUTDOOR_OPERATOR_PATTERN.test(operator)) return true;

  return false;
}

function isNearAcceptedTrailGroup(
  doc: PbfCopierPreviewDoc,
  context: UnnamedHikingTrailContext,
  maxMeters: number
): boolean {
  if (doc.lat == null || doc.lng == null) return false;
  for (const trail of context.acceptedTrailDocs) {
    const d = minDistanceToPolylineMeters(doc.lat, doc.lng, trail.routeLineCoordinates);
    if (d <= maxMeters) return true;
  }
  return minDistanceToNamedTrailMeters(doc.lat, doc.lng, context.namedTrails) <= maxMeters;
}

function hasTrailOrParkContext(doc: PbfCopierPreviewDoc, context: UnnamedHikingTrailContext): boolean {
  if (doc.lat == null || doc.lng == null) return false;
  if (isNearRecreationArea(doc.lat, doc.lng, context.recreationAreas, 200)) return true;
  if (isNearAcceptedTrailGroup(doc, context, 80)) return true;
  return minDistanceToNamedTrailMeters(doc.lat, doc.lng, context.namedTrails) <= 120;
}

function trailProbePoint(doc: PbfCopierPreviewDoc): { lat: number; lng: number } | null {
  const coords = doc.routeLineCoordinates ?? doc.routeLineSegments?.find((s) => s.length >= 2);
  if (coords && coords.length > 0) {
    const mid = coords[Math.floor(coords.length / 2)] ?? coords[0]!;
    return { lat: mid.lat, lng: mid.lng };
  }
  if (doc.lat != null && doc.lng != null) return { lat: doc.lat, lng: doc.lng };
  return null;
}

/** Deterministic check: real unmarked hiking trail (not sidewalk/campus connector). */
export function isRealUnmarkedHikingTrail(
  item: PbfCopierPreviewDoc,
  context: UnnamedHikingTrailContext
): boolean {
  if (item.kind !== "unexplored_route" && !item.routeLineCoordinates?.length) return false;
  const tags = getEffectiveOsmTags(item);
  const coords = item.routeLineCoordinates ?? item.routeLineSegments?.find((s) => s.length >= 2);
  return isUnnamedRealHikingTrail(
    tags,
    { coordinates: coords, lengthMeters: polylineLengthMeters(coords) },
    context,
    trailProbePoint(item)
  ) || hasTrailSupportMetadata(item);
}

/** Accept unnamed path/footway/track segments that look like real hiking trails, not urban connectors. */
export function isUnnamedRealHikingTrail(
  tags: Record<string, string>,
  geometry: { coordinates?: Array<{ lat: number; lng: number }>; lengthMeters?: number } | undefined,
  context: UnnamedHikingTrailContext,
  probe?: { lat: number; lng: number } | null
): boolean {
  if (hasOsmNameTag(tags)) return false;
  if (isRejectedPathHighway(tags)) return false;

  const highway = tag(tags, "highway");
  const footway = tag(tags, "footway");
  const isCandidate =
    highway === "path" ||
    highway === "track" ||
    footway === "path" ||
    (highway === "footway" && footway !== "sidewalk" && footway !== "crossing" && footway !== "access_aisle");
  if (!isCandidate) return false;

  const access = tag(tags, "access");
  const probeDoc =
    probe != null
      ? ({ lat: probe.lat, lng: probe.lng } as PbfCopierPreviewDoc)
      : ({ lat: geometry?.coordinates?.[0]?.lat, lng: geometry?.coordinates?.[0]?.lng } as PbfCopierPreviewDoc);
  const trailContext = hasTrailOrParkContext(probeDoc, context);

  if (access === "private" && !trailContext) return false;

  const surface = tag(tags, "surface");
  if (surface && PAVED_SURFACES.has(surface) && !trailContext) return false;

  if (!hasStrongTrailSignal(tags) && !trailContext) return false;

  const lengthMeters = geometry?.lengthMeters ?? polylineLengthMeters(geometry?.coordinates);
  if (lengthMeters < MIN_UNNAMED_TRAIL_METERS && !trailContext) return false;

  return trailContext || hasStrongTrailSignal(tags);
}

export function isUnnamedRealHikingTrailDoc(
  doc: PbfCopierPreviewDoc,
  context: UnnamedHikingTrailContext
): boolean {
  return isRealUnmarkedHikingTrail(doc, context);
}

/** Walking paths/sidewalks/paved connectors that must stay hidden. */
export function isWalkingPathJunk(doc: PbfCopierPreviewDoc): boolean {
  const tags = getEffectiveOsmTags(doc);
  if (isRejectedPathHighway(tags)) return true;
  const highway = tag(tags, "highway");
  if (highway !== "path" && highway !== "footway" && highway !== "steps") return false;
  if (hasOsmNameTag(tags) && hasStrongTrailSignal(tags)) return false;
  if (tag(tags, "sac_scale") || tag(tags, "trail_visibility")) return false;
  if (tag(tags, "route") === "hiking" || tag(tags, "route") === "foot") return false;
  const surface = tag(tags, "surface");
  if (surface && PAVED_SURFACES.has(surface) && !tag(tags, "leisure") && !tag(tags, "tourism")) return true;
  const coords = doc.routeLineCoordinates ?? doc.routeLineSegments?.find((s) => s.length >= 2);
  const lengthMeters = polylineLengthMeters(coords);
  if (lengthMeters < MIN_UNNAMED_TRAIL_METERS && !hasStrongTrailSignal(tags)) return true;
  return !hasStrongTrailSignal(tags);
}

export function isSelfAttachedRoute(doc: PbfCopierPreviewDoc): boolean {
  if (doc.attachedToRouteId && doc.destinationGroupId && doc.attachedToRouteId === doc.destinationGroupId) {
    return true;
  }
  if (
    doc.attachedTo &&
    doc.attachedTo.osmType === doc.osmType &&
    doc.attachedTo.osmId === doc.osmId
  ) {
    return true;
  }
  return false;
}

export function buildUnnamedHikingTrailContext(items: PbfCopierPreviewDoc[]): UnnamedHikingTrailContext {
  const acceptedTrailDocs = items.filter((d) => {
    if (d.kind !== "unexplored_route") return false;
    if (d.warnings?.includes("v2_hiking_trail_merged") || d.warnings?.includes(V2_UNNAMED_HIKING_TRAIL_WARNING)) {
      return true;
    }
    const tags = d.sourceTagSample ?? {};
    return hasOsmNameTag(tags) && isHikingTrailPreviewDoc(d);
  });
  return {
    namedTrails: collectNamedTrailLines(items),
    recreationAreas: collectRecreationAreaPoints(items),
    acceptedTrailDocs,
  };
}

export function deriveUnnamedHikingTrailName(
  doc: PbfCopierPreviewDoc,
  context: UnnamedHikingTrailContext
): { displayName: string; nameSource: string; nameConfidence: string } {
  if (doc.lat != null && doc.lng != null) {
    let nearestTrail: NamedTrailLine | null = null;
    let nearestDist = Infinity;
    for (const trail of context.namedTrails) {
      const d = minDistanceToPolylineMeters(doc.lat, doc.lng, trail.coordinates);
      if (d < nearestDist) {
        nearestDist = d;
        nearestTrail = trail;
      }
    }
    if (nearestTrail && nearestDist <= 120 && !isSyntheticRouteDisplayName(nearestTrail.displayName)) {
      return {
        displayName: `${nearestTrail.displayName} Connector Trail`,
        nameSource: "trail_context",
        nameConfidence: nearestDist <= 50 ? "medium" : "low",
      };
    }

    for (const area of context.recreationAreas) {
      const pointDist = haversineMeters(doc.lat, doc.lng, area.lat, area.lng);
      const inBbox =
        area.bbox &&
        doc.lat >= area.bbox.minLat &&
        doc.lat <= area.bbox.maxLat &&
        doc.lng >= area.bbox.minLng &&
        doc.lng <= area.bbox.maxLng;
      if (pointDist <= 200 || inBbox) {
        const areaName = area.name?.trim();
        if (areaName) {
          return {
            displayName: `${areaName} Trail`,
            nameSource: "park_context",
            nameConfidence: pointDist <= 80 ? "medium" : "low",
          };
        }
      }
    }

    for (const trail of context.acceptedTrailDocs) {
      const d = minDistanceToPolylineMeters(doc.lat, doc.lng, trail.routeLineCoordinates);
      if (d <= 80 && trail.displayName?.trim() && !isSyntheticRouteDisplayName(trail.displayName)) {
        return {
          displayName: `${trail.displayName} Connector Trail`,
          nameSource: "route_group_context",
          nameConfidence: "low",
        };
      }
    }
  }

  const tags = doc.sourceTagSample ?? {};
  if (
    tag(tags, "highway") === "path" ||
    tag(tags, "highway") === "footway" ||
    tag(tags, "highway") === "track"
  ) {
    return {
      displayName: "Connector Trail",
      nameSource: "trail_context",
      nameConfidence: "low",
    };
  }

  return {
    displayName: "Unnamed Hiking Trail",
    nameSource: "trail_context",
    nameConfidence: "low",
  };
}

export function promoteUnnamedHikingTrailDoc(
  doc: PbfCopierPreviewDoc,
  context: UnnamedHikingTrailContext
): PbfCopierPreviewDoc {
  const derived = deriveUnnamedHikingTrailName(doc, context);
  const warnings = [...(doc.warnings ?? []).filter((w) => w !== "v2_raw_osm_unfiltered" && w !== "v2_line_no_marker")];
  warnings.push(V2_UNNAMED_HIKING_TRAIL_WARNING);

  const coords = doc.routeLineCoordinates ?? doc.routeLineSegments?.find((s) => s.length >= 2);
  const anchor = coords?.[0] ?? { lat: doc.lat, lng: doc.lng };

  return {
    ...doc,
    displayName: derived.displayName,
    derivedName: true,
    nameSource: derived.nameSource,
    nameConfidence: derived.nameConfidence,
    primaryActivity: "hiking",
    activities: ["hiking"],
    primaryCategory: "hiking",
    lat: anchor.lat,
    lng: anchor.lng,
    center: anchor,
    routeMarkerCoordinate: doc.routeMarkerCoordinate ?? anchor,
    warnings,
  };
}

type WaterLine = {
  displayName: string;
  coordinates: Array<{ lat: number; lng: number }>;
};

function isWaterFeatureDoc(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const waterway = tag(tags, "waterway");
  if (waterway && WATERWAY_VALUES.has(waterway)) return true;
  if (tag(tags, "natural") === "water") return true;
  const water = tag(tags, "water");
  if (water && WATER_TAG_VALUES.has(water)) return true;
  if (tag(tags, "waterway") === "riverbank") return true;
  if (tag(tags, "landuse") === "reservoir") return true;
  return false;
}

function collectWaterLines(items: PbfCopierPreviewDoc[]): WaterLine[] {
  const lines: WaterLine[] = [];
  for (const doc of items) {
    if (!isWaterFeatureDoc(doc)) continue;
    const coords = doc.routeLineCoordinates ?? doc.routeLineSegments?.find((s) => s.length >= 2);
    if (!coords || coords.length < 2) continue;
    const tags = doc.sourceTagSample ?? {};
    lines.push({
      displayName: doc.displayName || tags.name || tags["name:en"] || "",
      coordinates: coords,
    });
  }
  return lines;
}

export function isTrainBridgeCandidate(tags: Record<string, string>): boolean {
  const railway = tag(tags, "railway");
  if (!railway || !RAIL_BRIDGE_RAILWAY.has(railway)) return false;
  const bridge = tag(tags, "bridge");
  if (!bridge || bridge === "no") return false;
  return true;
}

export function isRailroadBridge(item: PbfCopierPreviewDoc): boolean {
  const tags = getEffectiveOsmTags(item);
  if (!isTrainBridgeCandidate(tags)) return false;
  const coords = resolveBridgeLineCoords(item);
  return coords.length >= 2 || (item.lat != null && item.lng != null);
}

function minDistanceLineToWaterMeters(
  coords: Array<{ lat: number; lng: number }>,
  waterLines: WaterLine[]
): { distanceMeters: number; waterName: string } | null {
  let best: { distanceMeters: number; waterName: string } | null = null;
  for (const point of coords) {
    for (const water of waterLines) {
      const d = minDistanceToPolylineMeters(point.lat, point.lng, water.coordinates);
      if (d <= RAIL_WATER_PROXIMITY_METERS && (!best || d < best.distanceMeters)) {
        best = { distanceMeters: d, waterName: water.displayName };
      }
    }
  }
  if (best) return best;

  for (let i = 0; i < coords.length - 1; i++) {
    const mid = {
      lat: (coords[i]!.lat + coords[i + 1]!.lat) / 2,
      lng: (coords[i]!.lng + coords[i + 1]!.lng) / 2,
    };
    for (const water of waterLines) {
      const d = minDistanceToPolylineMeters(mid.lat, mid.lng, water.coordinates);
      if (d <= RAIL_WATER_PROXIMITY_METERS && (!best || d < best.distanceMeters)) {
        best = { distanceMeters: d, waterName: water.displayName };
      }
    }
  }
  return best;
}

function deriveTrainBridgeDisplayName(
  doc: PbfCopierPreviewDoc,
  waterName: string | undefined
): string {
  const tags = doc.sourceTagSample ?? {};
  const docName = doc.displayName?.trim();
  if (docName && hasMeaningfulBridgeName(doc, docName) && !isSyntheticRouteDisplayName(docName)) {
    return docName;
  }

  const bridgeName = tags.name?.trim() || tags["name:en"]?.trim();
  if (bridgeName && hasMeaningfulBridgeName(doc, bridgeName)) return bridgeName;

  const lineName =
    tags["railway:name"]?.trim() ||
    tags.ref?.trim() ||
    tags.operator?.trim();
  if (waterName?.trim() && !isSyntheticRouteDisplayName(waterName)) {
    return `${waterName.trim()} Train Bridge`;
  }
  if (lineName && !isSyntheticRouteDisplayName(lineName)) return `${lineName} Train Bridge`;
  return "Train Bridge";
}

function midpoint(coords: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  const idx = Math.floor(coords.length / 2);
  return coords[idx] ?? coords[0]!;
}

function resolveBridgeLineCoords(doc: PbfCopierPreviewDoc): Array<{ lat: number; lng: number }> {
  const coords = doc.routeLineCoordinates ?? doc.routeLineSegments?.find((s) => s.length >= 2);
  if (coords && coords.length >= 2) return coords;
  if (doc.lat != null && doc.lng != null) {
    return [
      { lat: doc.lat, lng: doc.lng },
      { lat: doc.lat + 0.00001, lng: doc.lng + 0.00001 },
    ];
  }
  return [];
}

function buildTrainBridgeDoc(base: PbfCopierPreviewDoc, waterName?: string): PbfCopierPreviewDoc {
  const coords = resolveBridgeLineCoords(base);
  const anchor = coords.length > 0 ? midpoint(coords) : { lat: base.lat, lng: base.lng };
  const displayName = deriveTrainBridgeDisplayName(base, waterName);
  const lineColor = base.routeLineColor ?? "#64748b";

  return {
    ...base,
    kind: coords.length >= 2 ? "unexplored_route" : "unexplored_spot",
    collection: coords.length >= 2 ? "unexploredRoutes" : "unexploredSpots",
    displayName,
    primaryActivity: "train_bridge",
    activities: ["train_bridge", "sightseeing"],
    primaryCategory: "bridge",
    lat: anchor.lat,
    lng: anchor.lng,
    center: anchor,
    routeMarkerCoordinate: anchor,
    routeCenterCoordinate: anchor,
    routeLineCoordinates: coords.length >= 2 ? coords : base.routeLineCoordinates,
    routeLineColor: lineColor,
    filteredOut: false,
    filteredBy: [],
    filterReason: undefined,
    warnings: [
      ...(base.warnings ?? []).filter((w) => w !== "v2_line_no_marker"),
      V2_TRAIN_BRIDGE_WARNING,
      V2_TRAIN_BRIDGE_FORCED_WARNING,
    ],
  };
}

function forceVisibleRealUnmarkedHikingTrail(
  doc: PbfCopierPreviewDoc,
  context: UnnamedHikingTrailContext,
  counters: PbfDestinationQualityCounters
): PbfCopierPreviewDoc {
  const promoted = promoteUnnamedHikingTrailDoc(doc, context);
  const coords =
    promoted.routeLineCoordinates ?? promoted.routeLineSegments?.find((s) => s.length >= 2);
  const anchor = coords?.[Math.floor((coords.length - 1) / 2)] ?? coords?.[0] ?? {
    lat: promoted.lat,
    lng: promoted.lng,
  };
  const colorKey =
    normalizePreviewDisplayName(promoted.displayName) ||
    `osm/${promoted.osmType}/${promoted.osmId}`;
  const lineColor = promoted.routeLineColor ?? hikingTrailColorForName(colorKey);

  counters.realUnmarkedHikingTrailsForcedVisible += 1;
  counters.unnamedHikingRoutesForcedVisible += 1;

  return {
    ...promoted,
    lat: anchor.lat,
    lng: anchor.lng,
    center: anchor,
    routeMarkerCoordinate: anchor,
    routeCenterCoordinate: anchor,
    routeLineColor: lineColor,
    filteredOut: false,
    filteredBy: (promoted.filteredBy ?? []).filter(
      (k) => k !== "support_attached" && k !== "unnamed_path" && k !== "generic_footway"
    ),
    filterReason: undefined,
    attachedToRouteId: undefined,
    attachedTo: undefined,
    attachReason: undefined,
    primaryActivity: "hiking",
    primaryCategory: promoted.primaryCategory === "osm" ? "hiking" : promoted.primaryCategory,
    activities: ["hiking"],
  };
}

function clearSelfAttachedRoute(
  doc: PbfCopierPreviewDoc,
  counters: PbfDestinationQualityCounters
): PbfCopierPreviewDoc {
  if (!isSelfAttachedRoute(doc)) return doc;
  counters.selfAttachedRoutesUnhidden += 1;
  counters.selfAttachedRoutesFixed += 1;

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

/** Last-pass correction after grouping/post-filters: force real trails and rail bridges visible. */
export function finalizeDestinationQuality(
  items: PbfCopierPreviewDoc[],
  counters: PbfDestinationQualityCounters = emptyDestinationQualityCounters()
): PbfCopierPreviewDoc[] {
  const trailContext = buildUnnamedHikingTrailContext(items);
  const waterLines = collectWaterLines(items);

  return items.map((raw) => {
    let doc: PbfCopierPreviewDoc = { ...raw };

    if (isRailroadBridge(doc)) {
      const coords = resolveBridgeLineCoords(doc);
      const waterHit = waterLines.length ? minDistanceLineToWaterMeters(coords, waterLines) : null;
      doc = buildTrainBridgeDoc(doc, waterHit?.waterName);
      counters.railroadBridgesForcedVisible += 1;
      counters.railBridgesForcedVisible += 1;
      return doc;
    }

    const tags = getEffectiveOsmTags(doc);
    const railway = tag(tags, "railway");
    if (railway && ACTIVE_RAILWAY_VALUES.has(railway) && !isTrainBridgeCandidate(tags)) {
      counters.normalRailwaysStillHidden += doc.filteredOut ? 1 : 0;
    }

    const isHikingLineRoute =
      doc.kind === "unexplored_route" &&
      (doc.primaryActivity === "hiking" ||
        isPrimaryHikingRoute(doc) ||
        isRealUnmarkedHikingTrail(doc, trailContext) ||
        doc.warnings?.includes("v2_hiking_trail_merged"));

    if (isHikingLineRoute && isSelfAttachedRoute(doc)) {
      doc = clearSelfAttachedRoute(doc, counters);
    }

    if (
      isHikingLineRoute &&
      (doc.filteredOut ||
        (doc.filteredBy ?? []).some((k) =>
          ["support_attached", "unnamed_path", "generic_footway", "non_destination_amenity"].includes(k)
        ) ||
        isSyntheticRouteDisplayName(doc.displayName))
    ) {
      if (isRealUnmarkedHikingTrail(doc, trailContext) || isPrimaryHikingRoute(doc)) {
        doc = forceVisibleRealUnmarkedHikingTrail(doc, trailContext, counters);
      } else if (isPrimaryHikingRoute(doc) || doc.warnings?.includes("v2_hiking_trail_merged")) {
        const derived = deriveUnnamedHikingTrailName(doc, trailContext);
        const coords =
          doc.routeLineCoordinates ?? doc.routeLineSegments?.find((s) => s.length >= 2);
        const anchor = coords?.[Math.floor((coords.length - 1) / 2)] ?? {
          lat: doc.lat,
          lng: doc.lng,
        };
        const colorKey = normalizePreviewDisplayName(derived.displayName) || `osm/${doc.osmType}/${doc.osmId}`;
        doc = {
          ...doc,
          displayName: isSyntheticRouteDisplayName(doc.displayName) ? derived.displayName : doc.displayName,
          derivedName: true,
          routeMarkerCoordinate: doc.routeMarkerCoordinate ?? anchor,
          routeCenterCoordinate: doc.routeCenterCoordinate ?? anchor,
          routeLineColor: doc.routeLineColor ?? hikingTrailColorForName(colorKey),
          filteredOut: false,
          filteredBy: (doc.filteredBy ?? []).filter((k) => k !== "support_attached"),
          filterReason: undefined,
          attachedToRouteId: undefined,
          attachedTo: undefined,
          primaryActivity: "hiking",
          activities: doc.activities?.length ? doc.activities : ["hiking"],
        };
        counters.selfAttachedRoutesUnhidden += 1;
        counters.unnamedHikingRoutesForcedVisible += 1;
      }
    }

    return doc;
  });
}

const ACTIVE_RAILWAY_VALUES = new Set(["rail", "light_rail", "subway", "tram", "monorail", "funicular"]);

function overlapsTrainBridge(spot: PbfCopierPreviewDoc, bridge: PbfCopierPreviewDoc): boolean {
  if (tag(spot.sourceTagSample ?? {}, "man_made") !== "bridge") return false;
  if (spot.lat == null || spot.lng == null || bridge.lat == null || bridge.lng == null) return false;
  return haversineMeters(spot.lat, spot.lng, bridge.lat, bridge.lng) <= BRIDGE_DUPLICATE_SUPPRESS_METERS;
}

/** Promote railway+bridge segments to visible train_bridge items in-place (water optional for naming). */
export function extractRailWaterBridges(
  items: PbfCopierPreviewDoc[],
  counters: PbfDestinationQualityCounters = emptyDestinationQualityCounters()
): PbfCopierPreviewDoc[] {
  const waterLines = collectWaterLines(items);
  const promoted: PbfCopierPreviewDoc[] = [];

  const next = items.map((doc) => {
    const tags = getEffectiveOsmTags(doc);
    if (!isTrainBridgeCandidate(tags)) return doc;

    const coords = resolveBridgeLineCoords(doc);
    if (coords.length < 2) return doc;

    const waterHit = waterLines.length ? minDistanceLineToWaterMeters(coords, waterLines) : null;
    const bridgeDoc = buildTrainBridgeDoc(doc, waterHit?.waterName);
    promoted.push(bridgeDoc);
    counters.railWaterBridgesIncluded += 1;
    counters.railBridgesForcedVisible += 1;
    return bridgeDoc;
  });

  if (!promoted.length) return next;

  const suppressedIds = new Set<string>();
  for (const bridge of promoted) {
    for (const doc of next) {
      if (doc.kind !== "unexplored_spot") continue;
      if (overlapsTrainBridge(doc, bridge)) suppressedIds.add(doc.id);
    }
  }

  return next.filter((doc) => !suppressedIds.has(doc.id));
}

export function isTrainBridgeOverWaterDoc(doc: PbfCopierPreviewDoc): boolean {
  if (doc.primaryActivity === "train_bridge") return true;
  if (doc.warnings?.includes(V2_TRAIN_BRIDGE_WARNING)) return true;
  if (doc.warnings?.includes(V2_TRAIN_BRIDGE_FORCED_WARNING)) return true;
  return isTrainBridgeCandidate(getEffectiveOsmTags(doc));
}

export function isUnnamedHikingTrailDoc(doc: PbfCopierPreviewDoc): boolean {
  return doc.warnings?.includes(V2_UNNAMED_HIKING_TRAIL_WARNING) === true;
}
