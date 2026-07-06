/**
 * Strict terrain/peak qualification for Locava Undiscovered — destination evidence required.
 */
import { hasMeaningfulPreviewName, hasOsmNameTag } from "./pbfCopierV2PreviewName.js";
import {
  minDistanceToPublicTrailMeters,
  type NamedTrailLine,
  type RecreationAreaPoint,
} from "./pbfCopierV2TrailProximity.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import type { PbfSupportMetadata } from "./pbfCopierV2SupportObjects.js";

export const TERRAIN_TRAIL_PROXIMITY_METERS = 250;

export type TerrainQualificationContext = {
  trails: NamedTrailLine[];
  recreationAreas?: RecreationAreaPoint[];
  maxTrailMeters?: number;
};

const TERRAIN_NATURAL_VALUES = new Set([
  "peak",
  "hill",
  "ridge",
  "saddle",
  "cliff",
  "rock",
  "bare_rock",
  "sand",
  "tree_row",
  "shrub",
  "scrub",
]);

const TERRAIN_PRIMARY_CATEGORIES = new Set(["peak", "hiking", "cliff", "rock", "saddle", "terrain", "landscape"]);

const DESTINATION_SUMMIT_NAME_RE =
  /\b(rock|pinnacle|peak|mountain|mount|summit|ledge|ledges|knob|point|lookout|overlook|pass|notch)\b/i;

const VIEWPOINT_NAME_RE = /\b(overlook|lookout|viewpoint|scenic view|vista)\b/i;

const PUBLIC_SUMMIT_LANDMARK_RE =
  /\b(mount|mountain|summit|peak|pinnacle|rock|overlook|lookout|pass|notch|falls|waterfall)\b/i;

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function hasTag(tags: Record<string, string>, key: string): boolean {
  return Boolean(tags[key]?.trim());
}

function displayName(doc: PbfCopierPreviewDoc): string {
  return (doc.displayName || doc.sourceTagSample?.name || doc.sourceTagSample?.["name:en"] || "").trim();
}

function hasOnlyGnisElevationWikidata(tags: Record<string, string>): boolean {
  const hasGnis = hasTag(tags, "gnis:feature_id") || hasTag(tags, "gnis");
  const hasEle = hasTag(tags, "ele");
  const hasWikidata = hasTag(tags, "wikidata");
  if (!hasGnis && !hasEle && !hasWikidata) return false;
  if (hasTag(tags, "wikipedia") || tag(tags, "tourism") === "viewpoint" || tag(tags, "tourism") === "attraction") {
    return false;
  }
  if (tag(tags, "route") === "hiking" || tag(tags, "hiking") === "yes" || hasTag(tags, "sac_scale")) return false;
  return true;
}

function hasTrailDestinationSupport(doc: PbfCopierPreviewDoc): boolean {
  const meta: PbfSupportMetadata | undefined = doc.supportMetadata;
  if (!meta) return false;
  return Boolean(
    meta.trailheads?.length ||
      meta.viewpoints?.length ||
      meta.parking?.length ||
      meta.shelters?.length ||
      meta.informationMaps?.length
  );
}

function isExplicitViewpoint(tags: Record<string, string>, name: string): boolean {
  if (tag(tags, "tourism") === "viewpoint") return true;
  for (const [key, value] of Object.entries(tags)) {
    if (value && key.toLowerCase().includes("viewpoint")) return true;
  }
  return VIEWPOINT_NAME_RE.test(name);
}

function isRealNamedPublicSummitLandmark(name: string, tags: Record<string, string>): boolean {
  if (!name.trim()) return false;
  if (!PUBLIC_SUMMIT_LANDMARK_RE.test(name)) return false;
  if (/\bhill\b/i.test(name) && !/\b(mount|mountain|summit|peak|pinnacle)\b/i.test(name)) return false;
  if (tag(tags, "place") === "peak" || tag(tags, "natural") === "peak" || tag(tags, "natural") === "hill") {
    return true;
  }
  return DESTINATION_SUMMIT_NAME_RE.test(name);
}

function nearestPublicTrailMeters(doc: PbfCopierPreviewDoc, ctx: TerrainQualificationContext): number {
  if (doc.lat == null || doc.lng == null) return Infinity;
  return minDistanceToPublicTrailMeters(doc.lat, doc.lng, ctx.trails, ctx.maxTrailMeters ?? TERRAIN_TRAIL_PROXIMITY_METERS);
}

export function isTerrainDestinationCandidate(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const natural = tag(tags, "natural");
  if (natural && TERRAIN_NATURAL_VALUES.has(natural)) return true;
  if (tag(tags, "place") === "peak" || tag(tags, "place") === "pass") return true;
  const category = (doc.primaryCategory || "").toLowerCase();
  if (category && TERRAIN_PRIMARY_CATEGORIES.has(category)) return true;
  return false;
}

/** True when a terrain-like OSM item has enough visitor/trail/destination evidence for Undiscovered. */
export function isQualifiedTerrainDestination(
  doc: PbfCopierPreviewDoc,
  context: TerrainQualificationContext
): boolean {
  if (!isTerrainDestinationCandidate(doc)) return true;

  const tags = doc.sourceTagSample ?? {};
  const natural = tag(tags, "natural");
  const name = displayName(doc);
  const named = hasOsmNameTag(tags) || hasMeaningfulPreviewName(doc);

  if (isExplicitViewpoint(tags, name)) return true;

  if (tag(tags, "tourism") === "attraction") return true;
  if (tag(tags, "historic") && named) return true;
  if (tag(tags, "waterway") === "waterfall" || natural === "waterfall") return true;
  if (doc.warnings?.includes("v2_hiking_trail_merged")) return true;

  const trailDist = nearestPublicTrailMeters(doc, context);
  const nearTrail = trailDist <= (context.maxTrailMeters ?? TERRAIN_TRAIL_PROXIMITY_METERS);

  if (named && DESTINATION_SUMMIT_NAME_RE.test(name) && nearTrail) return true;
  if (nearTrail && (doc.destinationGroupId || doc.attachedToRouteId)) return true;
  if (nearTrail && hasTrailDestinationSupport(doc)) return true;

  if (hasTag(tags, "wikipedia") && isRealNamedPublicSummitLandmark(name, tags)) return true;

  if (tag(tags, "piste:type") && named) return true;
  if (tag(tags, "route") === "hiking" || tag(tags, "route") === "ski") return true;
  if (tag(tags, "summit") === "yes" || tag(tags, "mountain_pass") === "yes") return true;

  if (!named) {
    if (natural && ["rock", "sand", "tree_row", "shrub", "scrub", "bare_rock"].includes(natural)) return false;
    if (natural === "cliff" || natural === "ridge") return false;
    return false;
  }

  if (/\bhill\b/i.test(name) && /\bhill$/i.test(name.trim()) && hasOnlyGnisElevationWikidata(tags) && !nearTrail) {
    return false;
  }

  if ((natural === "cliff" || natural === "rock" || natural === "bare_rock") && !nearTrail && !isExplicitViewpoint(tags, name)) {
    return false;
  }

  if (natural === "ridge" || natural === "saddle") {
    if (nearTrail || isExplicitViewpoint(tags, name) || DESTINATION_SUMMIT_NAME_RE.test(name)) return true;
    return false;
  }

  if (natural === "sand" || natural === "tree_row") return false;

  if (named && /\b(mount|mountain)\b/i.test(name)) return true;

  return false;
}

export function terrainFilterKey(doc: PbfCopierPreviewDoc): "unqualified_terrain_peak" | "unqualified_terrain_feature" {
  const tags = doc.sourceTagSample ?? {};
  const natural = tag(tags, "natural");
  if (natural === "peak" || natural === "hill" || tag(tags, "place") === "peak") {
    return "unqualified_terrain_peak";
  }
  return "unqualified_terrain_feature";
}

export const UNQUALIFIED_TERRAIN_FILTER_REASON =
  "terrain label without public trail, viewpoint, summit, or destination evidence";
