/**
 * PBF Copier V2 — post-fetch quality filters (runs after raw OSM + trail merge).
 * Annotates items with filteredOut / filteredBy / filterReason without mutating source geometry.
 */
import { normalizePreviewDisplayName } from "./pbfCopierPreviewQuality.js";
import { isHikingTrailPreviewDoc } from "./pbfCopierV2RawDisplay.js";
import {
  applyPbfSupportRelationships,
  DEFAULT_PBF_SUPPORT_OBJECT_SETTINGS,
  isPrimaryDestination,
  isSupportBench,
  isSupportBicycleParking,
  isSupportChargingStation,
  isSupportObject,
  isSupportParking,
  isSupportShelter,
  isSupportToilet,
  isSupportInfoMap,
  matchNonDestinationJunk,
  type PbfSupportObjectSettings,
} from "./pbfCopierV2SupportObjects.js";
import {
  enrichLocavaProductClassification,
  isLocavaCemeteryDestination,
  isLocavaFoodDrinkDestination,
  isLocavaLocalRetailDestination,
  isProtectedLocavaDestination,
  matchLocavaMapJunk,
  matchLocavaProductRules,
  emptyLocavaProductSummary,
  trackLocavaProductVisibility,
  type PbfLocavaProductSummary,
} from "./pbfCopierV2LocavaProductRules.js";
import {
  enrichOutdoorResortClassification,
  isNamedSkiRun,
  matchMountainOutdoorQuality,
} from "./pbfCopierV2MountainQuality.js";
import {
  buildOutdoorDestinationGroups,
  type PbfOutdoorGroupingSummary,
} from "./pbfCopierV2OutdoorDestinationGroups.js";
import {
  applyLocavaPostGroupingFilters,
  emptyLocavaPostFilterSummary,
} from "./pbfCopierV2LocavaPostFilters.js";
import { enrichActivities } from "./pbfCopierV2ActivityEnrichment.js";
import { rescueFinalRenderableDestinations } from "./pbfCopierV2FinalRescue.js";
import {
  emptyDestinationQualityCounters,
  extractRailWaterBridges,
  finalizeDestinationQuality,
  isPrimaryHikingRoute,
  isTrainBridgeCandidate,
  isTrainBridgeOverWaterDoc,
  isUnnamedHikingTrailDoc,
  isWalkingPathJunk,
  matchResidentialNonDestination,
  type PbfDestinationQualityCounters,
} from "./pbfCopierV2DestinationQuality.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export type PbfQualityFilterKey =
  | "infrastructure"
  | "service_road"
  | "administrative"
  | "railway"
  | "broad_geography"
  | "unnamed_land"
  | "unnamed_path"
  | "parking_support_unattached"
  | "tiny_non_destination_amenity"
  | "non_destination_amenity"
  | "support_attached"
  | "aerialway_pylon"
  | "address_only"
  | "unnamed_terrain"
  | "generic_track"
  | "unnamed_piste"
  | "unnamed_aerialway_station"
  | "lift_infrastructure"
  | "place_label"
  | "school_campus"
  | "place_of_worship"
  | "generic_lodging"
  | "resort_lodge"
  | "generic_retail"
  | "healthcare"
  | "golf_micro"
  | "sports_micro"
  | "private_pool"
  | "landscape_object"
  | "road_furniture"
  | "bank_atm"
  | "support_infrastructure"
  | "public_service"
  | "professional_office"
  | "age_restricted_retail"
  | "address_only"
  | "map_junk"
  | "residential_land"
  | "non_destination_residential";

export type PbfQualityFilterSettings = PbfSupportObjectSettings & {
  hideInfrastructure: boolean;
  hideServiceRoads: boolean;
  hideAdministrative: boolean;
  hideRailway: boolean;
  hideBroadGeography: boolean;
  hideUnnamedLand: boolean;
  hideUnnamedPaths: boolean;
  hideNonDestinationAmenities: boolean;
  hideMountainOutdoorQuality: boolean;
};

export const DEFAULT_PBF_QUALITY_FILTER_SETTINGS: PbfQualityFilterSettings = {
  ...DEFAULT_PBF_SUPPORT_OBJECT_SETTINGS,
  hideInfrastructure: true,
  hideServiceRoads: true,
  hideAdministrative: true,
  hideRailway: true,
  hideBroadGeography: true,
  hideUnnamedLand: true,
  hideUnnamedPaths: true,
  hideNonDestinationAmenities: true,
  hideMountainOutdoorQuality: true,
};

export type PbfQualityFilteredPreviewDoc = PbfCopierPreviewDoc & {
  filteredOut: boolean;
  filteredBy: PbfQualityFilterKey[];
  filterReason: string;
};

export type PbfQualityFilterSummary = {
  rawItems: number;
  visibleItems: number;
  hiddenItems: number;
  countsByFilter: Partial<Record<PbfQualityFilterKey, number>>;
};

export type PbfQualityFilterResult = {
  items: PbfQualityFilteredPreviewDoc[];
  summary: PbfQualityFilterSummary;
  groupingSummary?: PbfOutdoorGroupingSummary;
  locavaProductSummary?: PbfLocavaProductSummary;
  destinationQualityCounters?: PbfDestinationQualityCounters;
};

type FilterMatch = { key: PbfQualityFilterKey; reason: string };

const UTILITY_MAN_MADE = new Set([
  "storage_tank",
  "wastewater_plant",
  "water_works",
  "pipeline",
  "beacon",
  "crane",
  "silo",
  "works",
  "gasometer",
  "surveillance",
  "monitoring_station",
]);

const MOTOR_HIGHWAYS = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
]);

const VEHICLE_HIGHWAYS = new Set(["residential", "unclassified", "living_street", "road"]);

const ACTIVE_RAILWAY = new Set(["rail", "light_rail", "subway", "tram", "monorail", "funicular"]);

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function hasTag(tags: Record<string, string>, key: string): boolean {
  return Boolean(tags[key]?.trim());
}

export function hasOsmNameTag(tags: Record<string, string>): boolean {
  const name = tags.name?.trim() || tags["name:en"]?.trim();
  return Boolean(name && name.length >= 1);
}

export function hasMeaningfulPreviewName(doc: PbfCopierPreviewDoc): boolean {
  const raw = (doc.displayName || "").trim().toLowerCase();
  if (!raw) return false;
  if (raw.startsWith("highway=") || raw.startsWith("osm way/") || raw.startsWith("osm node/")) return false;

  const key = normalizePreviewDisplayName(doc.displayName);
  if (!key) return false;
  if (/^(highway|amenity|natural|landuse|man made|shop|tourism|building|waterway|railway) /.test(key)) {
    return false;
  }
  return true;
}

function isTrailLikeTags(tags: Record<string, string>): boolean {
  const highway = tag(tags, "highway");
  if (highway === "path" || highway === "footway" || highway === "steps" || highway === "bridleway") {
    return true;
  }
  if (highway === "track") {
    const foot = tag(tags, "foot");
    if (
      foot === "designated" ||
      foot === "yes" ||
      foot === "permissive" ||
      tag(tags, "hiking") === "yes" ||
      hasTag(tags, "sac_scale")
    ) {
      return true;
    }
  }
  if (hasTag(tags, "sac_scale") || hasTag(tags, "trail_visibility")) return true;
  const route = tag(tags, "route");
  if (route && ["hiking", "foot", "walking"].includes(route)) return true;
  if (tag(tags, "highway") === "trailhead") return true;
  return false;
}

function isRiverOrWaterAccessPoint(tags: Record<string, string>): boolean {
  const amenity = tag(tags, "amenity");
  if (amenity && ["boat_rental", "ferry_terminal", "slipway", "parking"].includes(amenity)) return true;
  const leisure = tag(tags, "leisure");
  if (leisure && ["slipway", "marina", "swimming_area", "beach_resort", "park", "nature_reserve"].includes(leisure)) {
    return true;
  }
  if (tag(tags, "natural") === "beach") return true;
  if (tag(tags, "tourism")) return true;
  if (tag(tags, "highway") === "trailhead") return true;
  if (tag(tags, "harbour") === "yes" || tag(tags, "seamark:type")) return true;
  return false;
}

/** Items that must never be quality-filtered when matched. */
export function isProtectedFromQualityFilter(doc: PbfCopierPreviewDoc): boolean {
  if (isProtectedLocavaDestination(doc)) return true;

  const tags = doc.sourceTagSample ?? {};
  const named = hasMeaningfulPreviewName(doc);
  const display = (doc.displayName || "").trim();

  if (doc.warnings?.includes("v2_hiking_trail_merged")) return true;
  if (isTrainBridgeOverWaterDoc(doc)) return true;
  if (isUnnamedHikingTrailDoc(doc)) return true;
  if (tag(tags, "highway") === "trailhead") return true;
  if (tag(tags, "tourism") === "wilderness_hut" || tag(tags, "tourism") === "alpine_hut") return true;
  if (tag(tags, "tourism") === "viewpoint" || tag(tags, "tourism") === "picnic_site") return true;
  if (tag(tags, "building") === "hut" && named) return true;
  if (tag(tags, "leisure") === "nature_reserve" && named) return true;
  if (tag(tags, "leisure") === "park" && named) return true;
  if (tag(tags, "natural") === "peak" && named) return true;
  if (tag(tags, "natural") === "beach") return true;
  if (named && (tag(tags, "place") === "island" || tag(tags, "place") === "islet")) return true;
  if (tag(tags, "board_type") === "planet_walk") return true;
  if (/\b(planet walk|saturn)\b/i.test(display)) return true;
  if (named && /\btrail\b/i.test(display) && isHikingTrailPreviewDoc(doc)) return true;
  if (isNamedSkiRun(doc)) return true;
  if (tag(tags, "historic") && named) return true;
  if (tag(tags, "natural") === "spring" && named) return true;
  if (tag(tags, "natural") === "water" && named) return true;
  if (tag(tags, "place") === "pass" && named) return true;
  if (named && /\b(notch|pond|lake|spring|mount|mountain|head)\b/i.test(display)) return true;
  if (isLocavaCemeteryDestination(doc)) return true;

  return false;
}

function matchInfrastructure(doc: PbfCopierPreviewDoc): FilterMatch | null {
  const tags = doc.sourceTagSample ?? {};
  if (hasTag(tags, "power")) {
    return { key: "infrastructure", reason: "power infrastructure" };
  }
  const manMade = tag(tags, "man_made");
  if (manMade && UTILITY_MAN_MADE.has(manMade)) {
    return { key: "infrastructure", reason: `utility man_made=${manMade}` };
  }
  if (manMade === "tower" && tag(tags, "tower:type") === "communication") {
    return { key: "infrastructure", reason: "communication tower" };
  }
  if (manMade === "mast" || manMade === "pipeline") {
    return { key: "infrastructure", reason: `utility man_made=${manMade}` };
  }
  return null;
}

function matchServiceRoad(doc: PbfCopierPreviewDoc): FilterMatch | null {
  const tags = doc.sourceTagSample ?? {};
  const highway = tag(tags, "highway");
  if (!highway) return null;
  if (isTrailLikeTags(tags)) return null;

  if (MOTOR_HIGHWAYS.has(highway)) {
    return { key: "service_road", reason: `highway=${highway}` };
  }
  if (VEHICLE_HIGHWAYS.has(highway)) {
    return { key: "service_road", reason: `highway=${highway}` };
  }
  if (highway === "service") {
    if (tag(tags, "service") === "driveway") {
      return { key: "service_road", reason: "service=driveway" };
    }
    if (tag(tags, "access") === "private") {
      return { key: "service_road", reason: "private service road" };
    }
    return { key: "service_road", reason: "highway=service" };
  }
  if (highway === "track" && tag(tags, "access") === "private" && !isTrailLikeTags(tags)) {
    return { key: "service_road", reason: "private vehicle track" };
  }
  return null;
}

function matchAdministrative(doc: PbfCopierPreviewDoc): FilterMatch | null {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "boundary") === "administrative") {
    return { key: "administrative", reason: "administrative boundary" };
  }
  if (hasTag(tags, "admin_level")) {
    return { key: "administrative", reason: "admin boundary metadata" };
  }
  if (tag(tags, "border_type")) {
    return { key: "administrative", reason: "border metadata" };
  }
  return null;
}

function matchResidentialLand(doc: PbfCopierPreviewDoc): FilterMatch | null {
  const hit = matchResidentialNonDestination(doc);
  if (!hit) return null;
  return { key: "residential_land", reason: hit.reason };
}

function matchRailway(doc: PbfCopierPreviewDoc): FilterMatch | null {
  const tags = doc.sourceTagSample ?? {};
  if (isTrainBridgeCandidate(tags) || isTrainBridgeOverWaterDoc(doc) || doc.primaryActivity === "train_bridge") {
    return null;
  }
  const railway = tag(tags, "railway");
  if (!railway) return null;
  if (railway === "level_crossing") {
    return { key: "railway", reason: "railway=level_crossing" };
  }
  if (["abandoned", "disused", "razed", "proposed", "construction"].includes(railway)) return null;
  if (ACTIVE_RAILWAY.has(railway)) {
    return { key: "railway", reason: `railway=${railway}` };
  }
  return null;
}

function matchBroadGeography(doc: PbfCopierPreviewDoc): FilterMatch | null {
  const tags = doc.sourceTagSample ?? {};
  if (isRiverOrWaterAccessPoint(tags)) return null;

  const waterway = tag(tags, "waterway");
  if (waterway && ["river", "stream", "canal", "drain", "ditch"].includes(waterway)) {
    return { key: "broad_geography", reason: `broad ${waterway} geometry` };
  }
  if (tag(tags, "natural") === "water" && !hasMeaningfulPreviewName(doc)) {
    return { key: "broad_geography", reason: "unnamed broad water polygon" };
  }
  if (hasMeaningfulPreviewName(doc) && /\b(river|brook|creek)\b/i.test(doc.displayName || "")) {
    if (doc.kind === "unexplored_route" || (doc.geometryPointCount ?? 0) > 30) {
      return { key: "broad_geography", reason: "broad named river line" };
    }
  }
  return null;
}

function matchUnnamedLand(doc: PbfCopierPreviewDoc): FilterMatch | null {
  const tags = doc.sourceTagSample ?? {};
  if (hasOsmNameTag(tags)) return null;
  const natural = tag(tags, "natural");
  if (natural && ["wood", "scrub", "grassland", "heath", "wetland"].includes(natural)) {
    return { key: "unnamed_land", reason: `unnamed natural=${natural}` };
  }
  const landuse = tag(tags, "landuse");
  if (landuse && ["forest", "meadow", "grass", "farmland"].includes(landuse)) {
    return { key: "unnamed_land", reason: `unnamed landuse=${landuse}` };
  }
  return null;
}

/** Always-on walking-path filter (hideUnnamedPaths UI deprecated — product always hides walking junk). */
function matchWalkingPathJunk(
  doc: PbfCopierPreviewDoc,
  counters?: PbfDestinationQualityCounters
): FilterMatch | null {
  if (doc.warnings?.includes("v2_hiking_trail_merged")) return null;
  if (isUnnamedHikingTrailDoc(doc)) return null;
  if (isPrimaryHikingRoute(doc)) return null;
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "tourism") === "information" && tag(tags, "information") === "route_marker" && !hasOsmNameTag(tags)) {
    return { key: "unnamed_path", reason: "unnamed route marker" };
  }
  if (!isWalkingPathJunk(doc)) return null;
  if (counters) {
    counters.walkingPathsKeptHidden += 1;
    counters.unnamedPathsStillFiltered += 1;
  }
  return { key: "unnamed_path", reason: "walking path / sidewalk / paved connector" };
}

function evaluateQualityFilters(
  doc: PbfCopierPreviewDoc,
  settings: PbfQualityFilterSettings,
  counters?: PbfDestinationQualityCounters
): FilterMatch[] {
  if (isProtectedFromQualityFilter(doc)) return [];

  const matches: FilterMatch[] = [];
  const tryMatch = (enabled: boolean, fn: (d: PbfCopierPreviewDoc) => FilterMatch | null) => {
    if (!enabled) return;
    const hit = fn(doc);
    if (hit) matches.push(hit);
  };

  const residential = matchResidentialLand(doc);
  if (residential) matches.push(residential);

  tryMatch(settings.hideInfrastructure, matchInfrastructure);
  tryMatch(settings.hideServiceRoads, matchServiceRoad);
  tryMatch(settings.hideAdministrative, matchAdministrative);
  tryMatch(settings.hideRailway, matchRailway);
  tryMatch(settings.hideBroadGeography, matchBroadGeography);
  tryMatch(settings.hideUnnamedLand, matchUnnamedLand);
  const walkingJunk = matchWalkingPathJunk(doc, counters);
  if (walkingJunk) matches.push(walkingJunk);
  if (settings.hideMountainOutdoorQuality) {
    const mountain = matchMountainOutdoorQuality(doc);
    if (mountain) matches.push(mountain);
  }

  if (settings.hideNonDestinationAmenities) {
    const product = matchLocavaProductRules(doc);
    if (product) matches.push(product);
  }

  return matches;
}

function finalizeSupportObjectVisibility(
  doc: PbfCopierPreviewDoc & { attachedTo?: { displayName: string } },
  settings: PbfQualityFilterSettings
): FilterMatch[] {
  const matches: FilterMatch[] = [];

  if (doc.attachedTo && settings.attachSupportToDestinations) {
    if (!settings.showSupportObjectsAsMarkers) {
      matches.push({ key: "support_attached", reason: "attached as support metadata" });
    }
    return matches;
  }

  if (
    (isSupportParking(doc) || isSupportChargingStation(doc) || isSupportBicycleParking(doc)) &&
    settings.hideUnattachedParking
  ) {
    matches.push({
      key: "parking_support_unattached",
      reason: "parking/support infrastructure not attached to destination",
    });
  }

  if (isSupportBench(doc) && settings.hideUnattachedBenches) {
    matches.push({
      key: "tiny_non_destination_amenity",
      reason: "bench not attached to park/trail/viewpoint",
    });
  }

  if (isSupportShelter(doc) && settings.hideUnattachedBenches) {
    matches.push({
      key: "tiny_non_destination_amenity",
      reason: "shelter not attached to park/trail/viewpoint",
    });
  }

  if ((isSupportToilet(doc) || isSupportInfoMap(doc)) && settings.hideUnattachedBenches) {
    matches.push({
      key: "tiny_non_destination_amenity",
      reason: isSupportToilet(doc)
        ? "toilet not attached to destination/trail"
        : "information map not attached to destination/trail",
    });
  }

  return matches;
}

function matchNonDestinationAmenity(doc: PbfCopierPreviewDoc): FilterMatch | null {
  const hit = matchNonDestinationJunk(doc);
  if (hit) return { key: "non_destination_amenity", reason: hit.reason };
  return null;
}

function classifyDoc(doc: PbfCopierPreviewDoc): PbfCopierPreviewDoc {
  return enrichLocavaProductClassification(enrichOutdoorResortClassification(doc));
}

function normalizeQualityFilterSettings(settings: PbfQualityFilterSettings): PbfQualityFilterSettings {
  return { ...settings, hideUnnamedPaths: false };
}

export function applyPbfQualityFilters(
  items: PbfCopierPreviewDoc[],
  settings: PbfQualityFilterSettings = DEFAULT_PBF_QUALITY_FILTER_SETTINGS
): PbfQualityFilterResult {
  settings = normalizeQualityFilterSettings(settings);
  const countsByFilter: Partial<Record<PbfQualityFilterKey, number>> = {};
  const locavaProductSummary = emptyLocavaProductSummary();
  const destinationQualityCounters = emptyDestinationQualityCounters();
  let hiddenItems = 0;

  const withRailBridges = extractRailWaterBridges(items, destinationQualityCounters);

  const enriched = applyPbfSupportRelationships(withRailBridges, settings, (doc) => {
    if (evaluateQualityFilters(doc, settings, destinationQualityCounters).length > 0) return false;
    return isPrimaryDestination(doc);
  });

  const annotated: PbfQualityFilteredPreviewDoc[] = enriched.map((doc) => {
    const classified = classifyDoc(doc);
    const matches = [...evaluateQualityFilters(classified, settings, destinationQualityCounters)];

    if (isSupportObject(classified)) {
      matches.push(...finalizeSupportObjectVisibility(classified, settings));
    } else if (settings.hideNonDestinationAmenities) {
      const junk = matchNonDestinationAmenity(classified);
      if (junk) matches.push(junk);
    }

    const filteredOut = matches.length > 0;
    const filteredBy = [...new Set(matches.map((m) => m.key))];
    const filterReason = [...new Set(matches.map((m) => m.reason))].join("; ");

    trackLocavaProductVisibility(classified, filteredOut, locavaProductSummary);

    if (filteredOut) {
      hiddenItems += 1;
      for (const m of matches) {
        countsByFilter[m.key] = (countsByFilter[m.key] ?? 0) + 1;
      }
    }

    return {
      ...classified,
      filteredOut,
      filteredBy,
      filterReason,
    };
  });

  const summary = {
    rawItems: items.length,
    visibleItems: items.length - hiddenItems,
    hiddenItems,
    countsByFilter,
  };

  if (items.length > 0) {
    console.info("[pbf-copier-v2] quality filters", summary);
  }

  const grouped = buildOutdoorDestinationGroups(annotated, {
    showSupportObjectsAsMarkers: settings.showSupportObjectsAsMarkers,
    destinationQualityCounters,
  });

  const postSummary = emptyLocavaPostFilterSummary();
  const postFiltered = applyLocavaPostGroupingFilters(grouped.items, postSummary);
  locavaProductSummary.hiddenGeologicalLabels += postSummary.hiddenGeologicalLabels;
  locavaProductSummary.hiddenGenericFootways += postSummary.hiddenGenericFootways;
  destinationQualityCounters.unnamedPathsStillFiltered += postSummary.hiddenGenericFootways;

  const withActivities = finalizeDestinationQuality(postFiltered, destinationQualityCounters).map((doc) =>
    enrichActivities(doc, destinationQualityCounters)
  );

  const finalized = rescueFinalRenderableDestinations(withActivities, undefined, destinationQualityCounters);

  const countsByFilterFinal: Partial<Record<PbfQualityFilterKey, number>> = {};
  let finalVisibleItems = 0;
  let finalHiddenItems = 0;
  for (const item of finalized) {
    if (item.filteredOut) {
      finalHiddenItems += 1;
      for (const key of item.filteredBy ?? []) {
        countsByFilterFinal[key as PbfQualityFilterKey] = (countsByFilterFinal[key as PbfQualityFilterKey] ?? 0) + 1;
        if (key === "residential_land" || key === "non_destination_residential") {
          destinationQualityCounters.residentialNonDestinationsFiltered += 1;
        }
      }
    } else {
      finalVisibleItems += 1;
      if (isUnnamedHikingTrailDoc(item)) {
        destinationQualityCounters.unnamedHikingTrailsIncluded += 1;
      }
    }
  }

  const finalSummary = {
    rawItems: items.length,
    visibleItems: finalVisibleItems,
    hiddenItems: finalHiddenItems,
    countsByFilter: countsByFilterFinal,
  };

  if (items.length > 0) {
    console.info("[pbf-copier-v2] outdoor destination groups", grouped.summary);
    console.info("[pbf-copier-v2] destination quality counters", destinationQualityCounters);
  }

  return {
    items: finalized as PbfQualityFilteredPreviewDoc[],
    summary: finalSummary,
    groupingSummary: grouped.summary,
    locavaProductSummary,
    destinationQualityCounters,
  };
}
