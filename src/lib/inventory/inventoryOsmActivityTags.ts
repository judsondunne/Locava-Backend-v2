import {
  dedupeActivities,
  normalizeActivity,
  type LocavaActivity,
} from "./activities/locavaActivities.js";

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function isBridgeFromTags(tags: Record<string, string>): boolean {
  if (tag(tags, "man_made") === "bridge") return true;
  const bridge = tag(tags, "bridge");
  if (bridge && bridge !== "no") return true;
  if (tag(tags, "railway") && bridge) return true;
  return false;
}

function isCoveredBridge(tags: Record<string, string>): boolean {
  if (tag(tags, "bridge") === "covered") return true;
  const name = tag(tags, "name") ?? "";
  return /\bcovered\s+bridge\b/i.test(name);
}

function addAct(acts: Set<LocavaActivity>, activity: string): void {
  const norm = normalizeActivity(activity);
  if (norm) acts.add(norm);
}

/** OSM keys we surface in diagnostics when hunting for activity/category metadata. */
const ACTIVITY_METADATA_KEY_PREFIXES = [
  "natural",
  "waterway",
  "leisure",
  "tourism",
  "amenity",
  "sport",
  "route",
  "highway",
  "historic",
  "landuse",
  "water",
  "beach",
  "swimming",
  "bathing",
  "hiking",
  "foot",
  "bicycle",
  "sac_scale",
  "trail_visibility",
  "man_made",
  "place",
  "gnis:",
  "wikidata",
  "wikipedia",
];

export function listActivityRelevantTags(tags: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    const kl = k.toLowerCase();
    if (
      ACTIVITY_METADATA_KEY_PREFIXES.some((p) => (p.endsWith(":") ? kl.startsWith(p) : kl === p || kl.startsWith(`${p}:`)))
    ) {
      out[k] = v;
    }
  }
  return out;
}

/** Which Locava nature/destination checks pass on raw tags (no name). */
export function describeLocavaNatureSignals(tags: Record<string, string>): string[] {
  const signals: string[] = [];
  if (tag(tags, "natural")) signals.push(`natural=${tag(tags, "natural")}`);
  const leisure = tag(tags, "leisure");
  if (leisure === "park" || leisure === "nature_reserve" || leisure === "swimming_area") {
    signals.push(`leisure=${leisure}`);
  }
  if (tag(tags, "boundary") === "protected_area") signals.push("boundary=protected_area");
  if (tag(tags, "waterway")) signals.push(`waterway=${tag(tags, "waterway")}`);
  const tourism = tag(tags, "tourism");
  if (tourism && ["viewpoint", "picnic_site", "camp_site", "attraction", "museum"].includes(tourism)) {
    signals.push(`tourism=${tourism}`);
  }
  if (tag(tags, "historic") || tag(tags, "heritage")) signals.push("historic/heritage");
  const landuse = tag(tags, "landuse");
  if (landuse === "forest" || landuse === "meadow" || landuse === "recreation_ground") {
    signals.push(`landuse=${landuse}`);
  }
  if (tag(tags, "swimming") || tag(tags, "bathing") || tag(tags, "beach") === "yes") {
    signals.push("swim/beach access tags");
  }
  if (tag(tags, "sport")) signals.push(`sport=${tag(tags, "sport")}`);
  return signals;
}

/**
 * Activities inferred strictly from OSM tags — never from the display name.
 * Every returned value is a canonical Locava activity slug.
 */
export function inferActivitiesFromOsmTags(tags: Record<string, string>): LocavaActivity[] {
  const acts = new Set<LocavaActivity>();

  const waterway = tag(tags, "waterway");
  const natural = tag(tags, "natural");
  const leisure = tag(tags, "leisure");
  const tourism = tag(tags, "tourism");
  const amenity = tag(tags, "amenity");
  const historic = tag(tags, "historic");

  if (waterway === "waterfall" || natural === "waterfall") {
    addAct(acts, "waterfall");
    addAct(acts, "hiking");
    addAct(acts, "view");
  }
  if (natural === "beach" || leisure === "beach" || tag(tags, "beach") === "yes") {
    addAct(acts, "beach");
    addAct(acts, "swimming");
    addAct(acts, "hiking");
  }
  if (leisure === "swimming_area" || tag(tags, "swimming") === "yes" || tag(tags, "swimming") === "designated") {
    addAct(acts, "swimming");
    addAct(acts, "swimminghole");
  }
  if (tag(tags, "sport") === "swimming" || tag(tags, "bathing") === "yes") addAct(acts, "swimming");
  if (leisure === "beach_resort") {
    addAct(acts, "beach");
    addAct(acts, "swimming");
  }
  if (natural === "peak" || natural === "hill") {
    addAct(acts, natural === "peak" ? "peak" : "hill");
    addAct(acts, "hiking");
    addAct(acts, "view");
    addAct(acts, "mountain");
  }
  if (natural === "water" || tag(tags, "water")) {
    const waterType = tag(tags, "water");
    if (waterType === "pond") {
      addAct(acts, "pond");
      addAct(acts, "fishing");
    } else if (waterType === "lake") {
      addAct(acts, "lake");
      addAct(acts, "fishing");
      addAct(acts, "kayaking");
    } else {
      addAct(acts, "water");
    }
  }
  if (leisure === "park") {
    addAct(acts, "park");
    addAct(acts, "walking");
    addAct(acts, "picnic");
  }
  if (leisure === "nature_reserve" || tag(tags, "boundary") === "protected_area") {
    addAct(acts, "conservation");
    addAct(acts, "nature");
    addAct(acts, "hiking");
  }
  if (natural === "wetland") {
    addAct(acts, "nature");
    addAct(acts, "conservation");
    addAct(acts, "birdwatching");
    addAct(acts, "walking");
  }
  if (natural === "wood" || tag(tags, "landuse") === "forest") {
    addAct(acts, "forest");
    addAct(acts, "hiking");
    addAct(acts, "walking");
  }
  if (tourism === "viewpoint") {
    addAct(acts, "view");
    addAct(acts, "overlook");
    addAct(acts, "hiking");
  }
  if (tourism === "camp_site") {
    addAct(acts, "camping");
    addAct(acts, "campground");
    addAct(acts, "hiking");
  }
  if (tourism === "picnic_site") {
    addAct(acts, "picnic");
    addAct(acts, "hiking");
  }
  if (tourism === "museum" || amenity === "museum") {
    addAct(acts, "museum");
    addAct(acts, "historical");
  }
  if (tourism === "attraction") addAct(acts, "things");
  if (amenity === "theatre" || amenity === "cinema" || amenity === "arts_centre") addAct(acts, "theater");
  if (amenity === "cafe") {
    addAct(acts, "cafe");
    addAct(acts, "coffee");
  }
  if (amenity === "restaurant" || amenity === "fast_food" || amenity === "pub" || amenity === "bar") {
    addAct(acts, "restaurants");
    if (amenity === "pub" || amenity === "bar") addAct(acts, "bar");
    if (amenity === "pub") addAct(acts, "brewery");
  }
  if (amenity === "ice_cream") addAct(acts, "icecream");
  if (amenity === "marketplace") {
    addAct(acts, "farmersmarket");
    addAct(acts, "market");
  }
  if (tag(tags, "route") === "hiking" || tag(tags, "route") === "foot") addAct(acts, "hiking");
  if (tag(tags, "route") === "bicycle" || tag(tags, "highway") === "cycleway") addAct(acts, "biking");
  const highway = tag(tags, "highway");
  if (highway === "path" || highway === "footway" || highway === "track") {
    if (
      tag(tags, "hiking") === "yes" ||
      tag(tags, "foot") === "designated" ||
      tag(tags, "sac_scale") ||
      tag(tags, "trail_visibility")
    ) {
      addAct(acts, "hiking");
      addAct(acts, "trail");
    }
  }
  if (highway === "trailhead" || tag(tags, "parking") === "trailhead") {
    addAct(acts, "trailhead");
    addAct(acts, "hiking");
  }
  if (isBridgeFromTags(tags)) {
    if (isCoveredBridge(tags)) {
      addAct(acts, "coveredbridge");
      addAct(acts, "historical");
    }
    addAct(acts, "bridge");
    if (tag(tags, "foot") === "yes" || tag(tags, "hiking") === "yes") addAct(acts, "hiking");
    if (historic) addAct(acts, "historical");
  }
  if (tag(tags, "man_made") === "lighthouse" || tourism === "lighthouse") {
    addAct(acts, "lighthouse");
    addAct(acts, "view");
  }
  if (leisure === "marina" || tag(tags, "man_made") === "pier" || highway === "pier") {
    addAct(acts, "pier");
    addAct(acts, "boating");
    addAct(acts, "sailing");
  }
  if (leisure === "golf_course") addAct(acts, "golfing");
  if (leisure === "playground") addAct(acts, "playground");
  if (leisure === "garden") addAct(acts, "garden");
  if (natural === "cave_entrance") addAct(acts, "cave");
  if (tag(tags, "landuse") === "quarry" || natural === "bare_rock") {
    addAct(acts, "quarries");
    addAct(acts, "rockformations");
  }
  if (historic === "castle") addAct(acts, "castle");
  if (historic === "ruins" || tag(tags, "ruins") === "yes") addAct(acts, "ruins");
  if (historic === "monument" || tourism === "monument") addAct(acts, "monuments");

  return dedupeActivities([...acts]);
}

export function hasOsmActivityMetadata(tags: Record<string, string>): boolean {
  return inferActivitiesFromOsmTags(tags).length > 0;
}
