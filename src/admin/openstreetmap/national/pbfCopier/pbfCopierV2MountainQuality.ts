/**
 * PBF Copier V2 — mountain/outdoor quality filters + ski/lift classification enrichment.
 */
import { normalizePreviewDisplayName } from "./pbfCopierPreviewQuality.js";
import { isAddressOnlyLeak } from "./pbfCopierV2LocavaProductRules.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export type MountainQualityFilterKey =
  | "aerialway_pylon"
  | "address_only"
  | "unnamed_terrain"
  | "generic_track"
  | "unnamed_piste"
  | "unnamed_aerialway_station"
  | "lift_infrastructure";

export type MountainQualityFilterMatch = { key: MountainQualityFilterKey; reason: string };

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

const ADDRESS_ONLY_KEYS = ["addr:housenumber", "addr:street", "addr:state", "ref:vcgi:esiteid"] as const;

const DESTINATION_CATEGORY_KEYS = new Set([
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
]);

function hasDestinationCategoryBeyondAddress(tags: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(tags)) {
    if (!value?.trim()) continue;
    if (key.startsWith("addr:") && key !== "addr:state") continue;
    if (key === "ref:vcgi:esiteid") continue;
    if (DESTINATION_CATEGORY_KEYS.has(key)) return true;
    if (key === "name" || key === "name:en") continue;
  }
  return false;
}

/** Numeric-only display names like "2567" from address nodes. */
export function isNumericOnlyDisplayName(displayName: string | undefined): boolean {
  const raw = (displayName || "").trim();
  return /^\d+$/.test(raw);
}

export function isSyntheticPreviewLabel(doc: PbfCopierPreviewDoc): boolean {
  const raw = (doc.displayName || "").trim().toLowerCase();
  if (!raw) return true;
  if (isNumericOnlyDisplayName(doc.displayName)) return true;
  if (raw.includes("=")) return true;
  if (/^(natural|highway|amenity|piste|aerialway|information|tourism) /.test(raw)) return true;
  if (/^(natural|highway|amenity|piste|aerialway|information)=/.test(raw)) return true;
  return false;
}

export function isAddressOnlyRecord(doc: PbfCopierPreviewDoc): boolean {
  if (hasOsmNameTag(doc.sourceTagSample ?? {})) return false;
  if (hasMeaningfulPreviewName(doc) && !isNumericOnlyDisplayName(doc.displayName)) return false;
  const tags = doc.sourceTagSample ?? {};
  const hasAddressTag = ADDRESS_ONLY_KEYS.some((k) => hasTag(tags, k));
  if (!hasAddressTag && !isNumericOnlyDisplayName(doc.displayName)) return false;
  if (hasDestinationCategoryBeyondAddress(tags)) return false;
  return true;
}

function isNamedMountainDestination(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const named = hasOsmNameTag(tags) || hasMeaningfulPreviewName(doc);
  if (!named) return false;

  const natural = tag(tags, "natural");
  if (natural && ["peak", "saddle", "spring", "water", "cliff", "bare_rock", "ridge", "rock"].includes(natural)) {
    return true;
  }
  const place = tag(tags, "place");
  if (place && ["peak", "pass", "locality", "hamlet", "isolated_dwelling"].includes(place)) return true;
  if (tag(tags, "tourism") === "viewpoint") return true;
  if (tag(tags, "historic")) return true;
  if (tag(tags, "waterway") === "waterfall") return true;
  if (tag(tags, "leisure") === "swimming_area") return true;
  if (named && /\b(pond|lake|spring|notch|pass|peak|head)\b/i.test(doc.displayName || "")) return true;
  return false;
}

function isFootAccessibleTrack(tags: Record<string, string>): boolean {
  const foot = tag(tags, "foot");
  return foot === "designated" || foot === "yes" || foot === "permissive" || tag(tags, "hiking") === "yes";
}

function isTrailLikeTrack(tags: Record<string, string>): boolean {
  if (hasTag(tags, "sac_scale") || hasTag(tags, "trail_visibility")) return true;
  const route = tag(tags, "route");
  if (route && ["hiking", "foot", "walking"].includes(route)) return true;
  if (isFootAccessibleTrack(tags)) return true;
  if (tag(tags, "highway") === "path" || tag(tags, "highway") === "footway") return true;
  return false;
}

export function isNamedSkiRun(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const pisteType = tag(tags, "piste:type");
  if (!pisteType) return false;
  if (hasOsmNameTag(tags)) return true;
  return hasMeaningfulPreviewName(doc) && !isSyntheticPreviewLabel(doc);
}

export function isNamedChairLift(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "aerialway") !== "chair_lift") return false;
  if (hasOsmNameTag(tags)) return true;
  return hasMeaningfulPreviewName(doc) && !isSyntheticPreviewLabel(doc);
}

export function enrichOutdoorResortClassification(doc: PbfCopierPreviewDoc): PbfCopierPreviewDoc {
  if (isNamedSkiRun(doc)) {
    return {
      ...doc,
      primaryActivity: "skiing",
      primaryCategory: "ski_run",
      activities: ["skiing"],
    };
  }
  return doc;
}

export function matchMountainOutdoorQuality(doc: PbfCopierPreviewDoc): MountainQualityFilterMatch | null {
  const tags = doc.sourceTagSample ?? {};

  const aerial = tag(tags, "aerialway");
  if (aerial === "pylon") {
    return { key: "aerialway_pylon", reason: "aerialway support pylon, not destination" };
  }
  if (aerial && ["chair_lift", "gondola", "drag_lift", "t-bar", "j-bar", "platter", "rope_tow", "magic_carpet", "cable_car", "mixed_lift"].includes(aerial)) {
    return { key: "lift_infrastructure", reason: "lift infrastructure, not primary destination" };
  }

  if (tag(tags, "aerialway") === "station" && !hasOsmNameTag(tags) && !hasMeaningfulPreviewName(doc)) {
    return { key: "unnamed_aerialway_station", reason: "unnamed aerialway station" };
  }
  if (tag(tags, "aerialway") === "station" && hasMeaningfulPreviewName(doc)) {
    const n = (doc.displayName || "").toLowerCase();
    if (/\b(lift|quad|gondola|chair|base station|mid station)\b/.test(n) && !tag(tags, "tourism")) {
      return { key: "lift_infrastructure", reason: "lift station infrastructure" };
    }
  }

  if (isAddressOnlyLeak(doc) || isAddressOnlyRecord(doc)) {
    return { key: "address_only", reason: "address-only record" };
  }

  if (!hasOsmNameTag(tags) && !hasMeaningfulPreviewName(doc) && !isNamedMountainDestination(doc)) {
    const natural = tag(tags, "natural");
    if (natural && ["bare_rock", "cliff", "ridge", "scrub", "wood"].includes(natural)) {
      return { key: "unnamed_terrain", reason: "unnamed terrain geometry" };
    }
  }
  if (!hasOsmNameTag(tags) && isSyntheticPreviewLabel(doc)) {
    const natural = tag(tags, "natural");
    if (natural && ["bare_rock", "cliff", "ridge", "scrub", "wood"].includes(natural)) {
      return { key: "unnamed_terrain", reason: "unnamed terrain geometry" };
    }
  }

  const pisteType = tag(tags, "piste:type");
  if (pisteType && ["downhill", "connection", "nordic"].includes(pisteType)) {
    if (!hasOsmNameTag(tags) && (isSyntheticPreviewLabel(doc) || !hasMeaningfulPreviewName(doc))) {
      if (isFootAccessibleTrack(tags)) return null;
      return { key: "unnamed_piste", reason: "unnamed piste fragment" };
    }
  }

  if (tag(tags, "highway") === "track") {
    if (doc.warnings?.includes("v2_hiking_trail_merged")) return null;
    if (hasOsmNameTag(tags) || hasMeaningfulPreviewName(doc)) return null;
    if (isTrailLikeTrack(tags)) return null;
    return { key: "generic_track", reason: "generic track/private access" };
  }

  return null;
}
