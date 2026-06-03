/**
 * PBF Copier V2 — Locava product rules (what belongs on the map as a primary spot).
 */
import { normalizePreviewDisplayName } from "./pbfCopierPreviewQuality.js";
import { isHikingTrailPreviewDoc } from "./pbfCopierV2RawDisplay.js";
import { isSyntheticPreviewLabel, isNamedSkiRun } from "./pbfCopierV2MountainQuality.js";
import {
  isNearRecreationArea,
  minDistanceToNamedTrailMeters,
  type NamedTrailLine,
  type RecreationAreaPoint,
} from "./pbfCopierV2TrailProximity.js";
import type { PbfSupportMetadata, PbfSupportObjectRef } from "./pbfCopierV2SupportObjects.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export type LocavaProductFilterKey =
  | "place_label"
  | "school_campus"
  | "place_of_worship"
  | "generic_lodging"
  | "resort_lodge"
  | "lift_infrastructure"
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
  | "map_junk";

export type LocavaProductFilterMatch = { key: LocavaProductFilterKey; reason: string };

export type PbfLocavaProductSummary = {
  hiddenPlaceLabels: number;
  hiddenSchools: number;
  hiddenGenericLodging: number;
  hiddenLiftInfrastructure: number;
  hiddenGenericRetail: number;
  hiddenChurches: number;
  hiddenMapJunk: number;
  hiddenHealthcare: number;
  hiddenGolfMicroFeatures: number;
  hiddenSportsMicroFeatures: number;
  hiddenPools: number;
  hiddenPrivatePools: number;
  hiddenTreesLandscapeObjects: number;
  hiddenBanksAtms: number;
  hiddenSupportInfrastructure: number;
  hiddenUtilityLeaks: number;
  hiddenPublicServiceBuildings: number;
  hiddenProfessionalOffices: number;
  hiddenAgeRestrictedRetail: number;
  hiddenAddressOnlyLeaks: number;
  hiddenGeologicalLabels: number;
  hiddenGenericFootways: number;
  keptFoodDrink: number;
  keptLocalRetail: number;
  keptCemeteries: number;
  keptSkiRuns: number;
};

export type LocavaPostFilterSummary = {
  hiddenGeologicalLabels: number;
  hiddenGenericFootways: number;
  connectorsAttached: number;
  supportRefsPruned: number;
  hiddenSupportAmenities: number;
};

export function emptyLocavaProductSummary(): PbfLocavaProductSummary {
  return {
    hiddenPlaceLabels: 0,
    hiddenSchools: 0,
    hiddenGenericLodging: 0,
    hiddenLiftInfrastructure: 0,
    hiddenGenericRetail: 0,
    hiddenChurches: 0,
    hiddenMapJunk: 0,
    hiddenHealthcare: 0,
    hiddenGolfMicroFeatures: 0,
    hiddenSportsMicroFeatures: 0,
    hiddenPools: 0,
    hiddenPrivatePools: 0,
    hiddenTreesLandscapeObjects: 0,
    hiddenUtilityLeaks: 0,
    hiddenGeologicalLabels: 0,
    hiddenGenericFootways: 0,
    hiddenBanksAtms: 0,
    hiddenSupportInfrastructure: 0,
    hiddenPublicServiceBuildings: 0,
    hiddenProfessionalOffices: 0,
    hiddenAgeRestrictedRetail: 0,
    hiddenAddressOnlyLeaks: 0,
    keptFoodDrink: 0,
    keptLocalRetail: 0,
    keptCemeteries: 0,
    keptSkiRuns: 0,
  };
}

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function hasTag(tags: Record<string, string>, key: string): boolean {
  return Boolean(tags[key]?.trim());
}

const PLACE_AREA_LABELS = new Set([
  "hamlet",
  "village",
  "city",
  "town",
  "suburb",
  "neighbourhood",
  "neighborhood",
  "locality",
  "borough",
  "quarter",
]);

const LIFT_AERIALWAYS = new Set([
  "chair_lift",
  "gondola",
  "drag_lift",
  "t-bar",
  "j-bar",
  "platter",
  "rope_tow",
  "magic_carpet",
  "cable_car",
  "mixed_lift",
]);

function hasOsmNameTag(tags: Record<string, string>): boolean {
  const name = tags.name?.trim() || tags["name:en"]?.trim();
  return Boolean(name && name.length >= 1);
}

function hasMeaningfulPreviewName(doc: PbfCopierPreviewDoc): boolean {
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

const CHAIN_BRAND_PATTERNS = [
  /\bmcdonald'?s\b/i,
  /\bburger king\b/i,
  /\bwendy'?s\b/i,
  /\bsubway\b/i,
  /\bstarbucks\b/i,
  /\bdunkin\b/i,
  /\b7[\s-]?eleven\b/i,
  /\bcumberland farms\b/i,
  /\bshell\b/i,
  /\bexxon\b/i,
  /\bmobil\b/i,
  /\bcitgo\b/i,
  /\bsunoco\b/i,
  /\bwal[\s-]?mart\b/i,
  /\btarget\b/i,
  /\bcvs\b/i,
  /\bwalgreens\b/i,
  /\brite aid\b/i,
  /\bhome depot\b/i,
  /\blowe'?s\b/i,
  /\bbest buy\b/i,
  /\bdollar general\b/i,
  /\bdollar tree\b/i,
  /\bautozone\b/i,
  /\badvance auto\b/i,
  /\bhampton inn\b/i,
  /\bholiday inn\b/i,
  /\bmarriott\b/i,
  /\bhilton\b/i,
  /\bhyatt\b/i,
  /\bmotel 6\b/i,
  /\bsuper 8\b/i,
  /\bcomfort inn\b/i,
];

const FOOD_AMENITIES = new Set([
  "restaurant",
  "cafe",
  "bar",
  "pub",
  "fast_food",
  "ice_cream",
  "food_court",
  "biergarten",
  "brewery",
]);

const FOOD_SHOPS = new Set(["bakery", "farm", "coffee", "deli", "pastry", "confectionery", "cheese", "wine"]);

const LOCAL_RETAIL_SHOPS = new Set([
  "bicycle",
  "bike",
  "ski",
  "outdoor",
  "books",
  "book",
  "farm",
  "bakery",
  "coffee",
  "deli",
  "supermarket",
  "convenience",
  "greengrocer",
  "seafood",
  "butcher",
  "alcohol",
  "wine",
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

const HEALTHCARE_AMENITIES = new Set([
  "hospital",
  "clinic",
  "doctors",
  "dentist",
  "pharmacy",
  "veterinary",
  "nursing_home",
  "social_facility",
]);

const SERVICE_FACILITY_AMENITIES = new Set([
  "social_facility",
  "nursing_home",
  "post_office",
  "townhall",
  "courthouse",
  "public_building",
]);

const CHAIN_FITNESS_PATTERNS = [
  /\bplanet fitness\b/i,
  /\banytime fitness\b/i,
  /\bcrunch fitness\b/i,
  /\bgold'?s gym\b/i,
  /\bla fitness\b/i,
  /\borangetheory\b/i,
  /\bcrossfit\b/i,
  /\bymca\b/i,
];

const GOLF_MICRO = new Set([
  "green",
  "fairway",
  "tee",
  "bunker",
  "rough",
  "water_hazard",
  "hole",
  "cartpath",
  "lateral_water_hazard",
]);

const STRONG_DESTINATION_AMENITY = new Set([
  "restaurant",
  "cafe",
  "bar",
  "pub",
  "fast_food",
  "biergarten",
  "library",
  "theatre",
  "arts_centre",
  "marketplace",
]);

const STRONG_DESTINATION_TOURISM = new Set([
  "museum",
  "gallery",
  "attraction",
  "viewpoint",
  "picnic_site",
  "camp_site",
  "theme_park",
]);

const SUPPORT_AMENITY_LEISURE = new Set(["picnic_table", "bleachers"]);

const PROFESSIONAL_OFFICES = new Set([
  "company",
  "lawyer",
  "estate_agent",
  "accountant",
  "energy_supplier",
  "insurance",
  "financial",
  "employment_agency",
  "it",
  "consulting",
]);

const DESTINATION_TAG_KEYS = new Set([
  "amenity",
  "shop",
  "tourism",
  "leisure",
  "historic",
  "natural",
  "man_made",
  "place",
  "waterway",
  "highway",
  "piste:type",
  "aerialway",
  "route",
  "building",
  "sport",
]);

const HIDE_RETAIL_SHOPS = new Set([
  "car",
  "car_repair",
  "tyres",
  "tires",
  "storage_rental",
  "mobile_phone",
  "vacant",
  "mall",
  "department_store",
  "hardware",
  "paint",
  "electrical",
  "electronics",
  "furniture",
  "carpet",
  "houseware",
  "pet",
  "beauty",
  "hairdresser",
  "dry_cleaning",
  "laundry",
  "funeral_directors",
  "estate_agent",
  "travel_agency",
  "ticket",
  "money_lender",
  "pawnbroker",
]);

const SCHOOL_PUBLIC_ATTRACTION_AMENITIES = new Set([
  "museum",
  "theatre",
  "theater",
  "library",
  "arts_centre",
  "community_centre",
]);

const SCHOOL_PUBLIC_ATTRACTION_LEISURE = new Set(["sports_centre", "stadium", "pitch"]);

function displayName(doc: PbfCopierPreviewDoc): string {
  return (doc.displayName || "").trim();
}

function looksLikeChainBrand(name: string): boolean {
  return CHAIN_BRAND_PATTERNS.some((re) => re.test(name));
}

/** House number / unit labels like "35A", "5 1/2", "19 1/2". */
export function isHouseNumberOnlyName(name: string | undefined): boolean {
  const raw = (name || "").trim();
  if (!raw) return true;
  if (/^\d+$/.test(raw)) return true;
  if (/^\d+\s*[a-zA-Z]$/.test(raw)) return true;
  if (/^\d+\s+\d+\s*\/\s*\d+$/.test(raw)) return true;
  if (/^\d+\s*\/\s*\d+$/.test(raw)) return true;
  return false;
}

function hasTourismHistoricLandmarkException(tags: Record<string, string>): boolean {
  if (hasTag(tags, "historic")) return true;
  if (tag(tags, "tourism") === "museum" || tag(tags, "tourism") === "attraction") return true;
  if (hasTag(tags, "heritage") || hasTag(tags, "listed_status")) return true;
  return false;
}

function tagsArePrimarilyAddressOrRef(tags: Record<string, string>): boolean {
  let hasAddrOrRef = false;
  for (const [key, value] of Object.entries(tags)) {
    if (!value?.trim()) continue;
    if (key.startsWith("addr:") || key.startsWith("ref:") || key === "source") {
      hasAddrOrRef = true;
      continue;
    }
    if (key === "name" || key === "name:en") continue;
    if (DESTINATION_TAG_KEYS.has(key)) return false;
  }
  return hasAddrOrRef;
}

/** Stronger address-only detection for leaks like "35A" with addr:* tags. */
export function isAddressOnlyLeak(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const name = displayName(doc);

  if (isHouseNumberOnlyName(name)) {
    if (tagsArePrimarilyAddressOrRef(tags) || !hasMeaningfulPreviewName(doc)) {
      return true;
    }
  }

  if (isSyntheticPreviewLabel(doc) && isHouseNumberOnlyName(name)) return true;

  if (!hasOsmNameTag(tags) && isHouseNumberOnlyName(name) && tagsArePrimarilyAddressOrRef(tags)) {
    return true;
  }

  if (
    !hasOsmNameTag(tags) &&
    (hasTag(tags, "addr:housenumber") || hasTag(tags, "ref:vcgi:esiteid")) &&
    !hasMeaningfulPreviewName(doc)
  ) {
    for (const key of DESTINATION_TAG_KEYS) {
      if (hasTag(tags, key) && key !== "building") return false;
    }
    if (tag(tags, "building") === "yes" || tag(tags, "building") === "residential") {
      return true;
    }
    return true;
  }

  return false;
}

export function isHealthcareFacility(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (hasTourismHistoricLandmarkException(tags)) return false;

  const amenity = tag(tags, "amenity");
  if (amenity && HEALTHCARE_AMENITIES.has(amenity)) return true;
  if (amenity && SERVICE_FACILITY_AMENITIES.has(amenity)) return true;
  if (tag(tags, "social_facility") || tag(tags, "social_facility:for")) return true;
  if (tag(tags, "building") === "hospital") return true;

  for (const key of Object.keys(tags)) {
    if (key.startsWith("healthcare") && tags[key]?.trim()) return true;
  }

  const n = displayName(doc).toLowerCase();
  if (
    /\b(medical center|health center|health clinic|dental clinic|pharmacy|planned parenthood|drug store)\b/.test(
      n
    ) &&
    !hasTourismHistoricLandmarkException(tags)
  ) {
    return true;
  }

  return false;
}

export function isGolfMicroFeature(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const golf = tag(tags, "golf");
  if (golf && GOLF_MICRO.has(golf)) return true;
  if (tag(tags, "natural") === "sand" && (golf === "bunker" || tag(tags, "sport") === "baseball")) {
    return true;
  }
  if (tag(tags, "leisure") === "golf_course" && hasMeaningfulPreviewName(doc)) return false;
  if (tag(tags, "leisure") === "golf_course" && hasOsmNameTag(tags)) return false;
  return false;
}

function isDestinationLikeSportsName(name: string): boolean {
  return /\b(recreation center|recreation centre|sports complex|athletic complex|stadium|arena|field house)\b/i.test(
    name
  );
}

export function isGenericSportsPitch(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const leisure = tag(tags, "leisure");
  if (leisure === "sports_centre" || leisure === "stadium") {
    return !hasMeaningfulPreviewName(doc) && !hasOsmNameTag(tags);
  }
  if (leisure !== "pitch" && leisure !== "track") return false;
  if (hasTourismHistoricLandmarkException(tags)) return false;
  if (hasMeaningfulPreviewName(doc) && isDestinationLikeSportsName(displayName(doc))) return false;

  const sport = tag(tags, "sport");
  if (sport && ["baseball", "soccer", "football", "tennis", "basketball", "volleyball"].includes(sport)) {
    if (!hasOsmNameTag(tags) && !isDestinationLikeSportsName(displayName(doc))) return true;
    const n = displayName(doc).toLowerCase();
    if (/^(field|pitch|court|diamond|soccer field|baseball field)\b/.test(n)) return true;
  }

  if (!hasOsmNameTag(tags) && !hasMeaningfulPreviewName(doc)) return true;
  if (isSyntheticPreviewLabel(doc)) return true;

  return false;
}

function isPublicSwimmingDestination(tags: Record<string, string>, name: string): boolean {
  const access = tag(tags, "access");
  if (access === "public" || access === "yes" || access === "customers") return true;
  if (tag(tags, "leisure") === "swimming_area") return true;
  if (/\b(aquatic center|aquatic centre|public pool|community pool|municipal pool|swim center)\b/i.test(name)) {
    return true;
  }
  if (tag(tags, "sport") === "swimming" && hasOsmNameTag(tags)) return true;
  return false;
}

export function isPrivateOrGenericPool(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "leisure") !== "swimming_pool") return false;

  const n = displayName(doc).toLowerCase();
  if (isPublicSwimmingDestination(tags, n)) return false;

  if (tag(tags, "access") === "private" || tag(tags, "access") === "no") return true;
  if (!hasOsmNameTag(tags) && !hasMeaningfulPreviewName(doc)) return true;
  if (
    tag(tags, "tourism") === "hotel" ||
    tag(tags, "building") === "hotel" ||
    tag(tags, "building") === "apartments" ||
    tag(tags, "landuse") === "residential"
  ) {
    return true;
  }
  if (!isPublicSwimmingDestination(tags, n)) return true;

  return false;
}

export function isUtilityInfrastructure(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "emergency") === "fire_hydrant") return true;
  if (tag(tags, "man_made") === "manhole") return true;
  if (hasTag(tags, "manhole")) return true;
  if (hasTag(tags, "utility")) return true;
  if (hasTag(tags, "pipeline")) return true;
  if (tag(tags, "water_source") === "main" && (tag(tags, "emergency") === "fire_hydrant" || tag(tags, "man_made"))) {
    return true;
  }
  return false;
}

export function isResidentialRoadGeometry(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const highway = tag(tags, "highway");
  if (highway === "residential") return true;
  if (tag(tags, "landuse") === "residential" && !hasTourismHistoricLandmarkException(tags)) {
    if (!hasMeaningfulPreviewName(doc) || isSyntheticPreviewLabel(doc)) return true;
    const n = displayName(doc).toLowerCase();
    if (/\b(apartments|condos|subdivision|residential)\b/.test(n)) return true;
  }
  if (highway === "track") {
    const sac = tag(tags, "sac_scale");
    const route = tag(tags, "route");
    if (sac || route === "hiking" || route === "foot" || route === "mtb") return false;
    if (tag(tags, "foot") === "yes" || tag(tags, "hiking") === "yes" || tag(tags, "bicycle") === "yes") return false;
    if (!hasOsmNameTag(tags) && !hasMeaningfulPreviewName(doc)) return true;
  }
  if (tag(tags, "access") === "private" && highway && ["residential", "service", "track", "unclassified"].includes(highway)) {
    return true;
  }
  return false;
}

export function isSupportAmenityPrimary(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "amenity") === "bench" || tag(tags, "amenity") === "bbq") return true;
  if (SUPPORT_AMENITY_LEISURE.has(tag(tags, "leisure") || "")) return true;
  return false;
}

export function isNameOnlyBuilding(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (isLocavaFoodDrinkDestination(doc) || isLocavaLocalRetailDestination(doc)) return false;
  if (hasTourismHistoricLandmarkException(tags)) return false;

  const building = tag(tags, "building");
  if (building !== "yes" && building !== "commercial" && building !== "retail") return false;
  if (!hasOsmNameTag(tags) && !hasMeaningfulPreviewName(doc)) return false;

  const amenity = tag(tags, "amenity");
  if (amenity && STRONG_DESTINATION_AMENITY.has(amenity)) return false;
  const tourism = tag(tags, "tourism");
  if (tourism && STRONG_DESTINATION_TOURISM.has(tourism)) return false;
  const shop = tag(tags, "shop");
  if (shop && (LOCAL_RETAIL_SHOPS.has(shop) || FOOD_SHOPS.has(shop))) return false;
  if (tag(tags, "historic")) return false;
  if (tag(tags, "leisure") === "park" || tag(tags, "leisure") === "sports_centre") return false;

  const office = tag(tags, "office");
  if (office && !PROFESSIONAL_OFFICES.has(office)) return false;
  if (office && PROFESSIONAL_OFFICES.has(office)) return true;

  if (hasTag(tags, "addr:housenumber") || hasTag(tags, "addr:street")) {
    if (!amenity && !tourism && !shop) return true;
  }

  return false;
}

export function isRailMetadata(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const railway = tag(tags, "railway");
  if (!railway) return false;
  if (["switch", "level_crossing", "crossing", "signal"].includes(railway)) return true;
  if (railway === "abandoned" || railway === "demolished") {
    if (tag(tags, "highway") === "cycleway" && tag(tags, "name")) return false;
    if (/\b(rail trail|rail-trail|bike trail)\b/i.test(displayName(doc))) return false;
    return true;
  }
  return false;
}

export function isDamWeirWithoutVisitorContext(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const waterway = tag(tags, "waterway");
  if (waterway !== "dam" && waterway !== "weir") return false;
  if (tag(tags, "tourism") === "viewpoint" || tag(tags, "tourism") === "attraction") return false;
  if (hasTag(tags, "historic")) return false;
  if (tag(tags, "leisure") === "park" && hasMeaningfulPreviewName(doc)) return false;
  if (hasOsmNameTag(tags) && /\b(scenic|recreation|park)\b/i.test(displayName(doc))) return false;
  return true;
}

export function isGeographicIslandCapeWithoutContext(
  doc: PbfCopierPreviewDoc,
  trails: NamedTrailLine[],
  recreationAreas: RecreationAreaPoint[]
): boolean {
  const tags = doc.sourceTagSample ?? {};
  const place = tag(tags, "place");
  const natural = tag(tags, "natural");
  const isGeo =
    place === "islet" ||
    place === "island" ||
    natural === "cape" ||
    (natural === "coastline" && !tag(tags, "tourism"));
  if (!isGeo) return false;

  if (doc.destinationGroupId || doc.attachedToRouteId) return false;
  if (tag(tags, "tourism") === "viewpoint" || tag(tags, "tourism") === "attraction") return false;
  if (!hasOsmNameTag(tags) && !hasMeaningfulPreviewName(doc)) return true;

  if (doc.lat != null && doc.lng != null) {
    if (minDistanceToNamedTrailMeters(doc.lat, doc.lng, trails) <= 250) return false;
    if (isNearRecreationArea(doc.lat, doc.lng, recreationAreas, 250)) return false;
  }

  if (natural === "cape" || place === "islet") return true;
  return false;
}

export function isPrivateGarden(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "leisure") !== "garden") return false;
  if (tag(tags, "garden:type") === "residential") return true;
  if (tag(tags, "access") === "private") return true;
  if (!hasOsmNameTag(tags) && !hasMeaningfulPreviewName(doc)) return true;
  if (tag(tags, "garden:type") === "community" || tag(tags, "garden:type") === "public") return false;
  if (tag(tags, "access") === "public" || tag(tags, "access") === "yes") return false;
  return true;
}

export function isChainFitnessCenter(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const leisure = tag(tags, "leisure");
  if (leisure !== "fitness_centre" && leisure !== "sports_centre" && tag(tags, "sport") !== "fitness") {
    return false;
  }
  const n = displayName(doc);
  if (!n.trim()) return false;
  if (CHAIN_FITNESS_PATTERNS.some((p) => p.test(n))) return true;
  if (looksLikeChainBrand(n) && /\b(gym|fitness)\b/i.test(n)) return true;
  return false;
}

function parseElevationMeters(tags: Record<string, string>): number | null {
  const ele = tags.ele?.trim();
  if (!ele) return null;
  const n = Number.parseFloat(ele.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function isMajorTrailLinkedPeak(doc: PbfCopierPreviewDoc, trails: NamedTrailLine[]): boolean {
  const tags = doc.sourceTagSample ?? {};
  const natural = tag(tags, "natural");
  if (natural !== "peak" && natural !== "hill" && tag(tags, "place") !== "peak") return false;
  if (!hasMeaningfulPreviewName(doc) && !hasOsmNameTag(tags)) return false;

  const ele = parseElevationMeters(tags);
  if (ele != null && ele >= 1200) return true;
  const n = displayName(doc);
  if (/\b(mount|mountain|summit)\b/i.test(n) && (hasTag(tags, "wikidata") || hasTag(tags, "wikipedia"))) {
    return true;
  }
  if (doc.lat == null || doc.lng == null) return false;
  return minDistanceToNamedTrailMeters(doc.lat, doc.lng, trails) <= 250;
}

export function isGeologicalLabelWithoutVisitorContext(
  doc: PbfCopierPreviewDoc,
  trails: NamedTrailLine[],
  recreationAreas: RecreationAreaPoint[]
): boolean {
  const tags = doc.sourceTagSample ?? {};
  const natural = tag(tags, "natural");
  const isGeo =
    natural === "peak" ||
    natural === "hill" ||
    natural === "saddle" ||
    natural === "cape" ||
    tag(tags, "place") === "peak";
  if (!isGeo) return false;

  if (doc.destinationGroupId || doc.attachedToRouteId) return false;
  if (tag(tags, "tourism") === "viewpoint") return false;
  if (tag(tags, "tourism") === "attraction" || tag(tags, "historic")) return false;
  if (/\b(overlook|lookout|viewpoint|scenic)\b/i.test(displayName(doc))) return false;

  if (isMajorTrailLinkedPeak(doc, trails)) return false;

  if (doc.lat != null && doc.lng != null) {
    if (minDistanceToNamedTrailMeters(doc.lat, doc.lng, trails) <= 250) return false;
    if (isNearRecreationArea(doc.lat, doc.lng, recreationAreas, 250)) return false;
    if (hasTag(tags, "wikidata") && minDistanceToNamedTrailMeters(doc.lat, doc.lng, trails) <= 500) {
      return false;
    }
  }

  return true;
}

function isTrailLikeFootway(tags: Record<string, string>): boolean {
  if (tag(tags, "route") === "hiking" || tag(tags, "route") === "foot" || tag(tags, "route") === "mtb") {
    return true;
  }
  if (tag(tags, "sac_scale") || tag(tags, "trail_visibility")) return true;
  const surface = tag(tags, "surface");
  if (surface && ["ground", "dirt", "earth", "grass", "unpaved", "gravel", "rock"].includes(surface)) {
    return true;
  }
  if (tag(tags, "foot") === "yes" || tag(tags, "hiking") === "yes" || tag(tags, "bicycle") === "yes") {
    return true;
  }
  return false;
}

export function isGenericFootwayWithoutTrailContext(
  doc: PbfCopierPreviewDoc,
  trails: NamedTrailLine[],
  recreationAreas: RecreationAreaPoint[]
): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "highway") !== "footway" && tag(tags, "highway") !== "path") return false;
  if (doc.warnings?.includes("v2_hiking_trail_merged")) return false;
  if (isHikingTrailPreviewDoc(doc)) return false;
  if (doc.destinationGroupId) return false;
  if (tag(tags, "footway") === "sidewalk") return true;
  if (hasOsmNameTag(tags) || hasMeaningfulPreviewName(doc)) {
    if (isTrailLikeFootway(tags)) return false;
    return false;
  }
  if (isTrailLikeFootway(tags)) return false;
  if (doc.lat != null && doc.lng != null) {
    if (minDistanceToNamedTrailMeters(doc.lat, doc.lng, trails) <= 80) return false;
    if (isNearRecreationArea(doc.lat, doc.lng, recreationAreas, 150) && isTrailLikeFootway(tags)) return false;
  }
  return true;
}

const SUPPORT_METADATA_MAX_METERS: Record<string, number> = {
  parking: 200,
  benches: 100,
  shelters: 250,
  toilets: 150,
  informationMaps: 100,
  connectors: 120,
  trailheads: 250,
  viewpoints: 200,
  waterfalls: 200,
};

export function mergeLocavaFilterMatch<T extends PbfCopierPreviewDoc & { filteredBy?: string[] }>(
  doc: T,
  match: { reason: string; filterKey?: string }
): T & { filteredOut: true; filteredBy: string[]; filterReason: string } {
  const filterKey = match.filterKey ?? "non_destination_amenity";
  const existingKeys = [...new Set([...(doc.filteredBy ?? []), filterKey])];
  const existingReasons = (doc.filterReason || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const filterReason = [...new Set([...existingReasons, match.reason])].join("; ");
  return {
    ...doc,
    filteredOut: true,
    filteredBy: existingKeys,
    filterReason,
  };
}

export function pruneDistantSupportMetadata<T extends PbfCopierPreviewDoc & { supportMetadata?: PbfSupportMetadata }>(
  doc: T
): { doc: T; pruned: number } {
  const meta = doc.supportMetadata;
  if (!meta) return { doc, pruned: 0 };

  let pruned = 0;
  const next: PbfSupportMetadata = { ...meta };

  for (const key of Object.keys(meta)) {
    const max = SUPPORT_METADATA_MAX_METERS[key];
    const list = (meta as Record<string, PbfSupportObjectRef[] | undefined>)[key];
    if (!list || max == null) continue;
    const kept = list.filter((ref) => {
      if (ref.distanceMeters <= max) return true;
      pruned += 1;
      return false;
    });
    if (kept.length) next[key] = kept;
    else delete next[key];
  }

  return {
    doc: { ...doc, supportMetadata: Object.keys(next).length ? next : undefined },
    pruned,
  };
}

export function isLandscapeStreetObject(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const natural = tag(tags, "natural");
  if (natural === "tree") {
    if (hasTourismHistoricLandmarkException(tags)) return false;
    if (hasTag(tags, "memorial") || tag(tags, "denotation") === "natural_monument") return false;
    if (hasOsmNameTag(tags) || hasMeaningfulPreviewName(doc)) return false;
    return true;
  }

  const manMade = tag(tags, "man_made");
  if (manMade === "planter") return true;
  if (manMade === "flagpole") {
    if (hasTourismHistoricLandmarkException(tags) || hasTag(tags, "memorial")) return false;
    return true;
  }

  const amenity = tag(tags, "amenity");
  if (amenity && ["waste_basket", "post_box", "recycling", "grit_bin"].includes(amenity)) return true;

  const barrier = tag(tags, "barrier");
  if (barrier && ["wall", "block", "fence", "gate", "chain", "guard_rail", "kerb", "bollard"].includes(barrier)) {
    if (tag(tags, "sac_scale") || tag(tags, "trail_visibility") || tag(tags, "highway") === "trailhead") return false;
    return true;
  }

  return false;
}

export function isBankOrFinancial(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const amenity = tag(tags, "amenity");
  if (amenity === "bank" || amenity === "atm") return true;
  const office = tag(tags, "office");
  if (office && ["financial", "insurance"].includes(office)) return true;
  return false;
}

export function isSupportInfrastructurePrimary(doc: PbfCopierPreviewDoc): boolean {
  if (isUtilityInfrastructure(doc)) return true;
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "amenity") === "charging_station") return true;
  if (tag(tags, "amenity") === "bicycle_parking") return true;
  if (tag(tags, "man_made") === "charge_point") return true;
  return false;
}

export function isPublicServiceBuilding(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (hasTourismHistoricLandmarkException(tags)) return false;

  const amenity = tag(tags, "amenity");
  if (amenity === "fire_station" || amenity === "police") return true;

  const office = tag(tags, "office");
  if (office === "government") return true;

  const n = displayName(doc).toLowerCase();
  if (/\b(dmv|department of motor|town hall|municipal office)\b/.test(n) && !hasTag(tags, "historic")) {
    return true;
  }
  if (/\btown hall\b/.test(n) && !hasTourismHistoricLandmarkException(tags)) return true;

  return false;
}

export function isProfessionalOffice(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (hasTourismHistoricLandmarkException(tags)) return false;
  if (tag(tags, "tourism") === "gallery" || tag(tags, "amenity") === "arts_centre") return false;

  const office = tag(tags, "office");
  if (office && PROFESSIONAL_OFFICES.has(office)) return true;

  const n = displayName(doc).toLowerCase();
  if (/\b(law firm|attorney|cpa|accounting firm|real estate office)\b/.test(n)) return true;

  return false;
}

export function isAgeRestrictedRetail(doc: PbfCopierPreviewDoc): boolean {
  return tag(doc.sourceTagSample ?? {}, "shop") === "cannabis";
}

export function isLocavaFoodDrinkDestination(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const named = hasOsmNameTag(tags) || hasMeaningfulPreviewName(doc);
  if (!named || isSyntheticPreviewLabel(doc)) return false;

  const amenity = tag(tags, "amenity");
  if (amenity && FOOD_AMENITIES.has(amenity)) return true;

  const shop = tag(tags, "shop");
  if (shop && FOOD_SHOPS.has(shop)) return true;

  if (amenity === "marketplace") return true;
  const n = displayName(doc);
  if (/\b(farmers market|farmers' market|farm stand|farmers stand)\b/i.test(n)) return true;
  if (/\b(brewery|brewpub|tavern|inn & tavern)\b/i.test(n) && !/\b(motel|hotel)\b/i.test(n)) return true;

  return false;
}

export function isLocavaCemeteryDestination(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "amenity") === "grave_yard") return true;
  if (tag(tags, "landuse") === "cemetery") return true;
  if (tag(tags, "historic") === "cemetery") return true;
  if (/\bcemetery\b/i.test(displayName(doc)) || /\bgraveyard\b/i.test(displayName(doc))) return true;
  return false;
}

export function isLocavaLocalRetailDestination(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const named = hasOsmNameTag(tags) || hasMeaningfulPreviewName(doc);
  if (!named || isSyntheticPreviewLabel(doc)) return false;

  const shop = tag(tags, "shop");
  if (!shop) return false;
  if (HIDE_RETAIL_SHOPS.has(shop)) return false;
  if (!LOCAL_RETAIL_SHOPS.has(shop)) return false;
  if (looksLikeChainBrand(displayName(doc))) return false;
  if (shop === "convenience" && looksLikeChainBrand(displayName(doc))) return false;
  return true;
}

export function isLiftInfrastructure(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const aerial = tag(tags, "aerialway");
  if (aerial === "pylon") return true;
  if (aerial && LIFT_AERIALWAYS.has(aerial)) return true;
  if (aerial === "station") {
    if (!hasOsmNameTag(tags) && !hasMeaningfulPreviewName(doc)) return true;
    const n = displayName(doc).toLowerCase();
    if (/\b(lift|quad|gondola|chair|base|mid)\b/.test(n) && !tag(tags, "tourism")) return true;
  }
  return false;
}

export function isPlaceAreaLabel(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const place = tag(tags, "place");
  if (place && PLACE_AREA_LABELS.has(place)) return true;
  return false;
}

function hasSchoolPublicAttractionException(tags: Record<string, string>): boolean {
  if (hasTag(tags, "historic")) return true;
  if (tag(tags, "tourism") === "museum" || tag(tags, "tourism") === "attraction") return true;
  const amenity = tag(tags, "amenity");
  if (amenity && SCHOOL_PUBLIC_ATTRACTION_AMENITIES.has(amenity)) return true;
  const leisure = tag(tags, "leisure");
  if (leisure && SCHOOL_PUBLIC_ATTRACTION_LEISURE.has(leisure)) return true;
  return false;
}

export function isSchoolCampus(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (hasSchoolPublicAttractionException(tags)) return false;

  const amenity = tag(tags, "amenity");
  if (amenity === "school" || amenity === "college" || amenity === "university") return true;

  const building = tag(tags, "building");
  if (building === "school" || building === "university" || building === "college") return true;

  const n = displayName(doc);
  if (/\b(high school|elementary school|middle school|academy|campus)\b/i.test(n) && !hasTag(tags, "historic")) {
    return true;
  }
  return false;
}

export function isGenericLodging(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (hasTag(tags, "historic") || tag(tags, "tourism") === "attraction") return false;

  const tourism = tag(tags, "tourism");
  if (tourism === "camp_site" && (hasMeaningfulPreviewName(doc) || hasOsmNameTag(tags))) return false;

  if (
    tourism &&
    ["hotel", "motel", "guest_house", "apartment", "chalet", "hostel"].includes(tourism)
  ) {
    const n = displayName(doc);
    if (/\b(inn|historic|landmark)\b/i.test(n) && (hasTag(tags, "historic") || hasTag(tags, "heritage"))) {
      return false;
    }
    if (looksLikeChainBrand(n)) return true;
    return true;
  }

  if (tag(tags, "building") === "hotel") return true;
  if (tag(tags, "amenity") === "love_hotel") return true;

  return false;
}

export function isGenericResortLodge(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (hasTag(tags, "historic") || tag(tags, "tourism") === "attraction") return false;

  const tourism = tag(tags, "tourism");
  if (tourism === "hotel" && /\b(lodge|resort)\b/i.test(displayName(doc))) {
    if (!hasTag(tags, "historic") && !hasTag(tags, "heritage")) return true;
  }
  if (tourism === "alpine_hut" || tourism === "wilderness_hut") {
    const n = displayName(doc).toLowerCase();
    if (/\b(ski|resort|base lodge|mountain lodge)\b/.test(n) && !hasTag(tags, "historic")) return true;
  }
  return false;
}

export function isPlaceOfWorshipHidden(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const amenity = tag(tags, "amenity");
  const building = tag(tags, "building");
  const isWorship =
    amenity === "place_of_worship" || building === "church" || building === "chapel" || building === "cathedral";
  if (!isWorship) return false;

  if (hasTag(tags, "historic")) return false;
  if (tag(tags, "tourism") === "attraction") return false;

  const n = displayName(doc);
  if (/\bchapel\b/i.test(n) && (hasTag(tags, "historic") || hasTag(tags, "heritage") || hasTag(tags, "listed_status"))) {
    return false;
  }
  if (hasTag(tags, "wikidata") || hasTag(tags, "wikipedia")) {
    if (/\b(chapel|historic|memorial)\b/i.test(n)) return false;
  }

  return true;
}

export function enrichLocavaProductClassification(doc: PbfCopierPreviewDoc): PbfCopierPreviewDoc {
  if (isNamedSkiRun(doc)) {
    return { ...doc, primaryActivity: "skiing", primaryCategory: "ski_run", activities: ["skiing"] };
  }
  if (isLocavaCemeteryDestination(doc)) {
    return { ...doc, primaryActivity: "historic", primaryCategory: "cemetery", activities: ["historic"] };
  }
  if (isLocavaFoodDrinkDestination(doc)) {
    const tags = doc.sourceTagSample ?? {};
    const amenity = tag(tags, "amenity");
    const shop = tag(tags, "shop");
    let category = "restaurant";
    if (amenity === "cafe" || shop === "coffee") category = "cafe";
    else if (amenity === "bar" || amenity === "pub" || amenity === "biergarten") category = "bar";
    else if (shop === "bakery") category = "bakery";
    else if (amenity === "marketplace" || shop === "farm") category = "marketplace";
    else if (amenity === "fast_food") category = "fast_food";
    return { ...doc, primaryActivity: "food", primaryCategory: category, activities: ["food"] };
  }
  if (isLocavaLocalRetailDestination(doc)) {
    const shop = tag(doc.sourceTagSample ?? {}, "shop") || "shop";
    return { ...doc, primaryActivity: "shopping", primaryCategory: shop, activities: ["shopping"] };
  }
  return doc;
}

/** Never hide these via Locava product rules (quality filters may still apply). */
export function isProtectedLocavaDestination(doc: PbfCopierPreviewDoc): boolean {
  if (isLocavaFoodDrinkDestination(doc)) return true;
  if (isLocavaCemeteryDestination(doc)) return true;
  if (isLocavaLocalRetailDestination(doc)) return true;
  if (isNamedSkiRun(doc)) return true;

  const tags = doc.sourceTagSample ?? {};
  if (doc.warnings?.includes("v2_hiking_trail_merged")) return true;
  if (tag(tags, "highway") === "trailhead") return true;
  if (tag(tags, "tourism") === "viewpoint" || tag(tags, "tourism") === "picnic_site") return true;
  if (tag(tags, "tourism") === "museum" || tag(tags, "tourism") === "gallery") return true;
  if (tag(tags, "tourism") === "camp_site" && (hasOsmNameTag(tags) || hasMeaningfulPreviewName(doc))) return true;
  if (tag(tags, "amenity") === "theatre" || tag(tags, "amenity") === "library") return true;
  if (tag(tags, "amenity") === "arts_centre" && hasMeaningfulPreviewName(doc)) return true;
  if (tag(tags, "leisure") === "park" && hasMeaningfulPreviewName(doc)) return true;
  if (tag(tags, "leisure") === "nature_reserve" && hasMeaningfulPreviewName(doc)) return true;
  if (
    (tag(tags, "leisure") === "sports_centre" || tag(tags, "leisure") === "stadium") &&
    hasMeaningfulPreviewName(doc)
  ) {
    return true;
  }
  if (tag(tags, "natural") === "beach") return true;
  if (tag(tags, "leisure") === "swimming_area") return true;
  if (tag(tags, "waterway") === "waterfall" || tag(tags, "natural") === "waterfall") return true;
  if (tag(tags, "historic") && hasMeaningfulPreviewName(doc)) return true;
  if (tag(tags, "man_made") === "bridge" && hasMeaningfulPreviewName(doc)) return true;
  if (tag(tags, "place") === "pass" && hasMeaningfulPreviewName(doc)) return true;
  if (namedOutdoorFeature(doc)) return true;
  if (tag(tags, "board_type") === "planet_walk") return true;
  if (/\b(planet walk|saturn)\b/i.test(displayName(doc))) return true;
  if (/\bcovered bridge\b/i.test(displayName(doc)) && hasTag(tags, "historic")) return true;

  return false;
}

function namedOutdoorFeature(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const named = hasOsmNameTag(tags) || hasMeaningfulPreviewName(doc);
  if (!named) return false;
  if (isHikingTrailPreviewDoc(doc) || doc.warnings?.includes("v2_hiking_trail_merged")) return true;
  const n = displayName(doc);
  if (/\b(notch|pond|lake|spring|mount|mountain|head|falls|waterfall)\b/i.test(n)) return true;
  if (tag(tags, "natural") === "spring" || tag(tags, "natural") === "water") return true;
  if (named && tag(tags, "place") === "island" && tag(tags, "tourism")) return true;
  return false;
}

export function matchLocavaProductRules(doc: PbfCopierPreviewDoc): LocavaProductFilterMatch | null {
  if (isProtectedLocavaDestination(doc)) return null;

  if (isAddressOnlyLeak(doc)) {
    return { key: "address_only", reason: "address-only record" };
  }
  if (isPlaceAreaLabel(doc)) {
    return { key: "place_label", reason: "area label, not primary destination" };
  }
  if (isHealthcareFacility(doc)) {
    return { key: "healthcare", reason: "healthcare/medical service, not discovery spot" };
  }
  if (isSchoolCampus(doc)) {
    return { key: "school_campus", reason: "school/campus building, not primary discovery spot" };
  }
  if (isPlaceOfWorshipHidden(doc)) {
    return { key: "place_of_worship", reason: "place of worship, not primary Locava spot" };
  }
  if (isGenericLodging(doc)) {
    return { key: "generic_lodging", reason: "generic lodging, not primary destination" };
  }
  if (isGenericResortLodge(doc)) {
    return { key: "resort_lodge", reason: "generic resort lodge/support facility" };
  }
  if (isLiftInfrastructure(doc)) {
    return { key: "lift_infrastructure", reason: "lift infrastructure, not primary destination" };
  }
  if (isGolfMicroFeature(doc)) {
    return { key: "golf_micro", reason: "golf course micro-feature, not primary spot" };
  }
  if (isGenericSportsPitch(doc)) {
    return { key: "sports_micro", reason: "sports field micro-feature, not primary spot" };
  }
  if (isPrivateOrGenericPool(doc)) {
    return { key: "private_pool", reason: "private/generic pool, not swimming spot" };
  }
  if (isUtilityInfrastructure(doc)) {
    return { key: "support_infrastructure", reason: "utility infrastructure, not destination" };
  }
  if (isResidentialRoadGeometry(doc)) {
    return { key: "map_junk", reason: "residential/road geometry, not destination" };
  }
  if (isNameOnlyBuilding(doc)) {
    return { key: "professional_office", reason: "name-only building/business without destination tag" };
  }
  if (isRailMetadata(doc)) {
    return { key: "road_furniture", reason: "rail metadata, not destination" };
  }
  if (isDamWeirWithoutVisitorContext(doc)) {
    return { key: "map_junk", reason: "utility water control structure, not default destination" };
  }
  if (isPrivateGarden(doc)) {
    return { key: "map_junk", reason: "private/generic garden" };
  }
  if (isChainFitnessCenter(doc)) {
    return { key: "generic_retail", reason: "chain fitness/service business, not Locava discovery" };
  }
  if (isLandscapeStreetObject(doc)) {
    return { key: "landscape_object", reason: "small map/streetscape object, not destination" };
  }
  if (isBankOrFinancial(doc)) {
    return { key: "bank_atm", reason: "financial service, not discovery spot" };
  }
  if (isSupportInfrastructurePrimary(doc)) {
    return { key: "support_infrastructure", reason: "support infrastructure, not primary destination" };
  }
  if (isPublicServiceBuilding(doc)) {
    return { key: "public_service", reason: "public service building, not primary discovery spot" };
  }
  if (isProfessionalOffice(doc)) {
    return { key: "professional_office", reason: "office/professional service, not destination" };
  }
  if (isAgeRestrictedRetail(doc)) {
    return { key: "age_restricted_retail", reason: "age-restricted retail, not default Locava spot" };
  }

  const tags = doc.sourceTagSample ?? {};
  const shop = tag(tags, "shop");
  if (shop === "cannabis") {
    return { key: "age_restricted_retail", reason: "age-restricted retail, not default Locava spot" };
  }
  if (shop && HIDE_RETAIL_SHOPS.has(shop)) {
    return { key: "generic_retail", reason: "generic/chain utility retail, not Locava destination" };
  }
  if (tag(tags, "amenity") === "fuel") {
    return { key: "generic_retail", reason: "gas station, not Locava destination" };
  }
  if (shop === "convenience" && looksLikeChainBrand(displayName(doc))) {
    return { key: "generic_retail", reason: "chain convenience store, not Locava destination" };
  }
  if (shop && !LOCAL_RETAIL_SHOPS.has(shop) && hasMeaningfulPreviewName(doc) && !isLocavaFoodDrinkDestination(doc)) {
    if (["mall", "department_store", "hardware", "electronics", "furniture", "car", "tyres"].includes(shop)) {
      return { key: "generic_retail", reason: "generic commercial retail, not Locava destination" };
    }
  }

  return null;
}

export function matchLocavaMapJunk(doc: PbfCopierPreviewDoc): LocavaProductFilterMatch | null {
  if (isProtectedLocavaDestination(doc) || isLocavaFoodDrinkDestination(doc) || isLocavaLocalRetailDestination(doc)) {
    return null;
  }

  const tags = doc.sourceTagSample ?? {};
  const highway = tag(tags, "highway");

  if (tag(tags, "man_made") === "snow_cannon") {
    return { key: "map_junk", reason: "snow making equipment" };
  }
  if (highway === "street_lamp") {
    return { key: "road_furniture", reason: "road/rail furniture, not destination" };
  }
  if (hasTag(tags, "traffic_sign")) {
    return { key: "road_furniture", reason: "road/rail furniture, not destination" };
  }
  if (tag(tags, "amenity") === "parking_space") {
    return { key: "map_junk", reason: "parking space" };
  }
  if (tag(tags, "entrance") === "main" || tag(tags, "entrance") === "yes") {
    return { key: "map_junk", reason: "building entrance" };
  }
  if (tag(tags, "noexit") === "yes") {
    return { key: "map_junk", reason: "noexit road" };
  }
  if (
    highway &&
    [
      "turning_circle",
      "turning_loop",
      "traffic_signals",
      "stop",
      "give_way",
      "crossing",
      "mini_roundabout",
      "motorway_junction",
      "speed_camera",
    ].includes(highway)
  ) {
    return { key: "road_furniture", reason: "road/rail furniture, not destination" };
  }
  const railMeta = isRailMetadata(doc);
  if (railMeta) {
    return { key: "road_furniture", reason: "rail metadata, not destination" };
  }
  if (tag(tags, "junction") === "yes" && /^\d+$/.test(displayName(doc))) {
    return { key: "map_junk", reason: "numeric junction label" };
  }
  if (tag(tags, "power") && ["tower", "pole", "line", "minor_line", "cable"].includes(tag(tags, "power")!)) {
    return { key: "map_junk", reason: "power infrastructure" };
  }
  if (tag(tags, "amenity") === "fire_hydrant") {
    return { key: "map_junk", reason: "fire hydrant" };
  }

  const landuse = tag(tags, "landuse");
  if (landuse && ["residential", "commercial", "industrial", "retail", "garages"].includes(landuse)) {
    if (!hasMeaningfulPreviewName(doc) || isSyntheticPreviewLabel(doc)) {
      return { key: "map_junk", reason: "generic landuse area" };
    }
  }

  const building = tag(tags, "building");
  if (
    building &&
    ["apartments", "commercial", "industrial", "residential", "garage", "shed", "barn", "greenhouse", "roof"].includes(
      building
    ) &&
    !hasTag(tags, "historic") &&
    !isLocavaFoodDrinkDestination(doc)
  ) {
    if (building !== "yes" || !hasMeaningfulPreviewName(doc)) {
      return { key: "map_junk", reason: `generic building=${building}` };
    }
  }

  return null;
}

function incrementLocavaHideSummary(
  key: LocavaProductFilterKey,
  summary: PbfLocavaProductSummary,
  doc?: PbfCopierPreviewDoc
): void {
  switch (key) {
    case "place_label":
      summary.hiddenPlaceLabels += 1;
      break;
    case "school_campus":
      summary.hiddenSchools += 1;
      break;
    case "generic_lodging":
    case "resort_lodge":
      summary.hiddenGenericLodging += 1;
      break;
    case "lift_infrastructure":
      summary.hiddenLiftInfrastructure += 1;
      break;
    case "generic_retail":
      summary.hiddenGenericRetail += 1;
      break;
    case "place_of_worship":
      summary.hiddenChurches += 1;
      break;
    case "healthcare":
      summary.hiddenHealthcare += 1;
      break;
    case "golf_micro":
      summary.hiddenGolfMicroFeatures += 1;
      break;
    case "sports_micro":
      summary.hiddenSportsMicroFeatures += 1;
      break;
    case "private_pool":
      summary.hiddenPools += 1;
      summary.hiddenPrivatePools += 1;
      break;
    case "landscape_object":
      summary.hiddenTreesLandscapeObjects += 1;
      break;
    case "road_furniture":
      summary.hiddenMapJunk += 1;
      break;
    case "bank_atm":
      summary.hiddenBanksAtms += 1;
      break;
    case "support_infrastructure":
      summary.hiddenSupportInfrastructure += 1;
      if (doc && isUtilityInfrastructure(doc)) summary.hiddenUtilityLeaks += 1;
      break;
    case "public_service":
      summary.hiddenPublicServiceBuildings += 1;
      break;
    case "professional_office":
      summary.hiddenProfessionalOffices += 1;
      break;
    case "age_restricted_retail":
      summary.hiddenAgeRestrictedRetail += 1;
      break;
    case "address_only":
      summary.hiddenAddressOnlyLeaks += 1;
      break;
    case "map_junk":
      summary.hiddenMapJunk += 1;
      break;
    default:
      break;
  }
}

export function trackLocavaProductVisibility(
  doc: PbfCopierPreviewDoc,
  filteredOut: boolean,
  summary: PbfLocavaProductSummary
): void {
  if (!filteredOut) {
    if (isLocavaFoodDrinkDestination(doc)) summary.keptFoodDrink += 1;
    if (isLocavaLocalRetailDestination(doc)) summary.keptLocalRetail += 1;
    if (isLocavaCemeteryDestination(doc)) summary.keptCemeteries += 1;
    if (isNamedSkiRun(doc)) summary.keptSkiRuns += 1;
    return;
  }

  const product = matchLocavaProductRules(doc);
  if (product) {
    incrementLocavaHideSummary(product.key, summary, doc);
    return;
  }

  const junk = matchLocavaMapJunk(doc);
  if (junk) incrementLocavaHideSummary(junk.key, summary, doc);
  else if (isAddressOnlyLeak(doc)) summary.hiddenAddressOnlyLeaks += 1;
}
