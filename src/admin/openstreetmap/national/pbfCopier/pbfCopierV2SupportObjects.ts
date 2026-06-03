/**
 * PBF Copier V2 — context-aware support object attachment (parking, benches, shelters).
 * Runs on enriched copies; never mutates raw scan items.
 */
import { isSyntheticPreviewLabel } from "./pbfCopierV2MountainQuality.js";
import {
  isLocavaCemeteryDestination,
  isLocavaFoodDrinkDestination,
  isLocavaLocalRetailDestination,
  matchLocavaMapJunk,
} from "./pbfCopierV2LocavaProductRules.js";
import { normalizePreviewDisplayName } from "./pbfCopierPreviewQuality.js";
import { isHikingTrailPreviewDoc } from "./pbfCopierV2RawDisplay.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export type PbfSupportObjectRef = {
  displayName: string;
  lat: number;
  lng: number;
  osmType: string;
  osmId: number;
  distanceMeters: number;
  tags: Record<string, string>;
  attachReason: string;
};

export type PbfSupportMetadata = {
  parking?: PbfSupportObjectRef[];
  benches?: PbfSupportObjectRef[];
  shelters?: PbfSupportObjectRef[];
  toilets?: PbfSupportObjectRef[];
  informationMaps?: PbfSupportObjectRef[];
  connectors?: PbfSupportObjectRef[];
};

export type PbfSupportAttachmentTarget = {
  osmType: string;
  osmId: number;
  displayName: string;
};

export type PbfSupportObjectSettings = {
  attachSupportToDestinations: boolean;
  hideUnattachedParking: boolean;
  hideUnattachedBenches: boolean;
  showSupportObjectsAsMarkers: boolean;
  parkingAttachRadiusMeters: number;
  benchNearDestinationRadiusMeters: number;
  benchNearTrailRadiusMeters: number;
  shelterAttachRadiusMeters: number;
  toiletAttachRadiusMeters: number;
  infoMapAttachRadiusMeters: number;
};

export const DEFAULT_PBF_SUPPORT_OBJECT_SETTINGS: PbfSupportObjectSettings = {
  attachSupportToDestinations: true,
  hideUnattachedParking: true,
  hideUnattachedBenches: true,
  showSupportObjectsAsMarkers: false,
  parkingAttachRadiusMeters: 200,
  benchNearDestinationRadiusMeters: 100,
  benchNearTrailRadiusMeters: 100,
  shelterAttachRadiusMeters: 250,
  toiletAttachRadiusMeters: 150,
  infoMapAttachRadiusMeters: 100,
};

const MAX_PARK_BBOX_ATTACHMENT_METERS = 1200;

export function bboxDiagonalMeters(bbox: NonNullable<PbfCopierPreviewDoc["bbox"]>): number {
  return haversineMeters(bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng);
}

export type PbfSupportEnrichedDoc = PbfCopierPreviewDoc & {
  supportMetadata?: PbfSupportMetadata;
  attachedTo?: PbfSupportAttachmentTarget;
  attachReason?: string;
};

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

function isProtectedFromQualityFilter(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  const named = hasMeaningfulPreviewName(doc);
  const display = (doc.displayName || "").trim();

  if (doc.warnings?.includes("v2_hiking_trail_merged")) return true;
  if (tag(tags, "highway") === "trailhead") return true;
  if (tag(tags, "tourism") === "wilderness_hut" || tag(tags, "tourism") === "alpine_hut") return true;
  if (tag(tags, "tourism") === "viewpoint" || tag(tags, "tourism") === "picnic_site") return true;
  if (tag(tags, "tourism") === "camp_site") return true;
  if (tag(tags, "building") === "hut" && named) return true;
  if (tag(tags, "leisure") === "nature_reserve" && named) return true;
  if (tag(tags, "leisure") === "park" && named) return true;
  if (tag(tags, "natural") === "peak" && named) return true;
  if (tag(tags, "natural") === "beach") return true;
  if (named && (tag(tags, "place") === "island" || tag(tags, "place") === "islet")) return true;
  if (tag(tags, "board_type") === "planet_walk") return true;
  if (/\b(planet walk|saturn)\b/i.test(display)) return true;
  if (named && /\btrail\b/i.test(display) && isHikingTrailPreviewDoc(doc)) return true;
  return false;
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function namesShareToken(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  return ta.some((t) => tb.includes(t));
}

function docPoint(doc: PbfCopierPreviewDoc): { lat: number; lng: number } | null {
  if (doc.lat == null || doc.lng == null) return null;
  return { lat: doc.lat, lng: doc.lng };
}

function supportRef(doc: PbfCopierPreviewDoc, distanceMeters: number, attachReason: string): PbfSupportObjectRef {
  return {
    displayName: doc.displayName || "(unnamed)",
    lat: doc.lat!,
    lng: doc.lng!,
    osmType: doc.osmType,
    osmId: doc.osmId,
    distanceMeters: Math.round(distanceMeters),
    tags: { ...(doc.sourceTagSample ?? {}) },
    attachReason,
  };
}

export function isSupportParking(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "highway") === "trailhead") return false;
  if (tag(tags, "amenity") === "parking") return true;
  const parking = tag(tags, "parking");
  if (parking && ["surface", "multi-storey", "underground", "lane"].includes(parking)) return true;
  if (/\bparking\b/i.test(doc.displayName || "")) return true;
  return false;
}

export function isSupportBench(doc: PbfCopierPreviewDoc): boolean {
  return tag(doc.sourceTagSample ?? {}, "amenity") === "bench";
}

export function isSupportShelter(doc: PbfCopierPreviewDoc): boolean {
  const amenity = tag(doc.sourceTagSample ?? {}, "amenity");
  return amenity === "shelter" || amenity === "picnic_shelter";
}

export function isSupportToilet(doc: PbfCopierPreviewDoc): boolean {
  return tag(doc.sourceTagSample ?? {}, "amenity") === "toilets";
}

export function isSupportInfoMap(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "tourism") !== "information") return false;
  if (tag(tags, "information") !== "map") return false;
  if (hasOsmNameTag(tags)) return false;
  if (hasMeaningfulPreviewName(doc) && !isSyntheticPreviewLabel(doc)) return false;
  return true;
}

export function isSupportChargingStation(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  return tag(tags, "amenity") === "charging_station" || tag(tags, "man_made") === "charge_point";
}

export function isSupportBicycleParking(doc: PbfCopierPreviewDoc): boolean {
  return tag(doc.sourceTagSample ?? {}, "amenity") === "bicycle_parking";
}

export function isSupportObject(doc: PbfCopierPreviewDoc): boolean {
  return (
    isSupportParking(doc) ||
    isSupportBench(doc) ||
    isSupportShelter(doc) ||
    isSupportToilet(doc) ||
    isSupportInfoMap(doc) ||
    isSupportChargingStation(doc) ||
    isSupportBicycleParking(doc)
  );
}

export function isPrimaryDestination(doc: PbfCopierPreviewDoc): boolean {
  if (doc.lat == null || doc.lng == null) return false;
  if (isSupportObject(doc)) return false;

  if (isProtectedFromQualityFilter(doc)) return true;

  const tags = doc.sourceTagSample ?? {};
  const named = hasMeaningfulPreviewName(doc);
  const display = (doc.displayName || "").trim();

  if (tag(tags, "tourism") === "museum") return true;
  if (tag(tags, "tourism") === "information") {
    if (tag(tags, "information") === "map" && !hasOsmNameTag(tags)) return false;
    if (named && !isSyntheticPreviewLabel(doc)) return true;
    if (tag(tags, "board_type") === "planet_walk") return true;
  }

  if (tag(tags, "amenity") === "marketplace") return true;
  if (tag(tags, "shop") === "farm" && named) return true;
  if (named && /\b(farm stand|farmers market|farmers' market|crossroad farm)\b/i.test(display)) return true;

  if (tag(tags, "amenity") === "cafe" && named) return true;
  if (tag(tags, "amenity") === "restaurant" && named) return true;
  if (tag(tags, "shop") === "bakery" && named) return true;

  if (tag(tags, "waterway") === "waterfall" || tag(tags, "natural") === "waterfall") return true;
  if (named && /\b(falls|waterfall)\b/i.test(display)) return true;

  if (tag(tags, "leisure") === "swimming_area") return true;
  if (named && /\b(swimming area|swimming)\b/i.test(display)) return true;

  if (tag(tags, "historic") && named) return true;
  if (tag(tags, "man_made") === "bridge" && named) return true;
  if (tag(tags, "amenity") === "grave_yard") return true;
  if (isLocavaCemeteryDestination(doc)) return true;

  if (isLocavaFoodDrinkDestination(doc)) return true;
  if (isLocavaLocalRetailDestination(doc)) return true;

  if (tag(tags, "leisure") === "playground" && named) return true;
  if (named && /\b(play grove|playground|timber tumble)\b/i.test(display)) return true;
  if (tag(tags, "leisure") === "recreation_ground" && named) return true;

  if (tag(tags, "natural") === "peak" && named) return true;
  if (tag(tags, "natural") === "spring" && named) return true;
  if (tag(tags, "natural") === "water" && named) return true;
  if (tag(tags, "place") === "pass" && named) return true;
  if (tag(tags, "place") === "peak" && named) return true;
  if (named && /\b(notch|pond|lake|spring|pass|head|mount|mountain)\b/i.test(display)) return true;

  return false;
}

function isScenicDestination(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "tourism") === "viewpoint") return true;
  if (/\b(overlook|lookout|scenic|viewpoint)\b/i.test(doc.displayName || "")) return true;
  return false;
}

function isBenchFriendlyDestination(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (isScenicDestination(doc)) return true;
  if (tag(tags, "leisure") === "park" && hasMeaningfulPreviewName(doc)) return true;
  if (tag(tags, "leisure") === "nature_reserve" && hasMeaningfulPreviewName(doc)) return true;
  if (tag(tags, "natural") === "beach") return true;
  if (tag(tags, "leisure") === "swimming_area") return true;
  if (tag(tags, "highway") === "trailhead") return true;
  if (tag(tags, "tourism") === "information") return true;
  if (doc.warnings?.includes("v2_hiking_trail_merged")) return true;
  return false;
}

function isParkingFriendlyDestination(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "highway") === "trailhead") return true;
  if (tag(tags, "leisure") === "park" && hasMeaningfulPreviewName(doc)) return true;
  if (tag(tags, "leisure") === "nature_reserve" && hasMeaningfulPreviewName(doc)) return true;
  if (tag(tags, "tourism") === "museum") return true;
  if (tag(tags, "amenity") === "marketplace") return true;
  if (tag(tags, "shop") === "farm" && hasMeaningfulPreviewName(doc)) return true;
  if (doc.warnings?.includes("v2_hiking_trail_merged")) return true;
  if (hasMeaningfulPreviewName(doc) && /\b(farm stand|farmers market|market|museum|park)\b/i.test(doc.displayName || "")) {
    return true;
  }
  return false;
}

function pointInDocBbox(doc: PbfCopierPreviewDoc, lat: number, lng: number): boolean {
  const bbox = doc.bbox;
  if (!bbox) return false;
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

function minDistanceToPolylineMeters(
  lat: number,
  lng: number,
  coords: Array<{ lat: number; lng: number }> | undefined
): number {
  if (!coords || coords.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]!;
    const b = coords[i + 1]!;
    min = Math.min(min, haversineMeters(lat, lng, a.lat, a.lng));
    min = Math.min(min, haversineMeters(lat, lng, b.lat, b.lng));
  }
  return min;
}

function benchHasStandaloneInterest(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (hasOsmNameTag(tags) || hasMeaningfulPreviewName(doc)) return true;
  if (hasTag(tags, "memorial") || hasTag(tags, "historic")) return true;
  return false;
}

type DestinationCandidate = {
  doc: PbfCopierPreviewDoc;
  index: number;
};

type AttachmentCandidate = {
  destinationIndex: number;
  distanceMeters: number;
  attachReason: string;
  score: number;
};

function scoreParkingAttachment(
  parking: PbfCopierPreviewDoc,
  destination: PbfCopierPreviewDoc,
  distanceMeters: number,
  settings: PbfSupportObjectSettings
): AttachmentCandidate | null {
  if (distanceMeters > settings.parkingAttachRadiusMeters) return null;

  let score = settings.parkingAttachRadiusMeters - distanceMeters;
  let attachReason = `within ${Math.round(distanceMeters)}m`;

  if (namesShareToken(parking.displayName || "", destination.displayName || "")) {
    score += 80;
    attachReason = "name matches destination";
  }
  if (isParkingFriendlyDestination(destination)) {
    score += 40;
    attachReason = attachReason + "; near trailhead/park/museum/market/trail";
  }

  return {
    destinationIndex: -1,
    distanceMeters,
    attachReason,
    score,
  };
}

function scoreBenchAttachment(
  bench: PbfCopierPreviewDoc,
  destination: PbfCopierPreviewDoc,
  settings: PbfSupportObjectSettings
): AttachmentCandidate | null {
  const point = docPoint(bench);
  if (!point) return null;

  const tags = bench.sourceTagSample ?? {};
  const destTags = destination.sourceTagSample ?? {};
  let distanceMeters = haversineMeters(point.lat, point.lng, destination.lat!, destination.lng!);
  let attachReason = "";
  let score = 0;

  if (benchHasStandaloneInterest(bench)) {
    score += 30;
    attachReason = "named/memorial/historic bench";
  }

  if (isScenicDestination(destination) && distanceMeters <= settings.benchNearDestinationRadiusMeters) {
    score += 100 - distanceMeters;
    attachReason = attachReason || `within ${Math.round(distanceMeters)}m of viewpoint/scenic feature`;
  }

  if (isBenchFriendlyDestination(destination) && distanceMeters <= settings.benchNearDestinationRadiusMeters) {
    score += 80 - distanceMeters;
    attachReason = attachReason || `within ${Math.round(distanceMeters)}m of park/beach/trailhead/trail board`;
  }

  if (destination.warnings?.includes("v2_hiking_trail_merged")) {
    const trailDist = minDistanceToPolylineMeters(point.lat, point.lng, destination.routeLineCoordinates);
    if (trailDist <= settings.benchNearTrailRadiusMeters) {
      score += 90 - trailDist;
      distanceMeters = Math.min(distanceMeters, trailDist);
      attachReason = attachReason || `within ${Math.round(trailDist)}m of named trail line`;
    }
  }

  if (tag(destTags, "leisure") === "park" || tag(destTags, "leisure") === "nature_reserve") {
    const bbox = destination.bbox;
    const diag = bbox ? bboxDiagonalMeters(bbox) : Infinity;
    if (
      diag <= MAX_PARK_BBOX_ATTACHMENT_METERS &&
      pointInDocBbox(destination, point.lat, point.lng) &&
      distanceMeters <= settings.benchNearDestinationRadiusMeters
    ) {
      score += 70;
      attachReason = attachReason || "inside park/nature reserve area";
    }
  }

  if (score <= 0) return null;
  return { destinationIndex: -1, distanceMeters, attachReason, score };
}

function isToiletFriendlyDestination(doc: PbfCopierPreviewDoc): boolean {
  if (isParkingFriendlyDestination(doc)) return true;
  if (isBenchFriendlyDestination(doc)) return true;
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "natural") === "peak" && (hasMeaningfulPreviewName(doc) || hasOsmNameTag(tags))) return true;
  if (tag(tags, "tourism") === "viewpoint") return true;
  if (isPrimaryDestination(doc)) return true;
  return false;
}

function effectiveDistanceToDestinationMeters(
  point: { lat: number; lng: number },
  destination: PbfCopierPreviewDoc
): number {
  let distanceMeters = haversineMeters(point.lat, point.lng, destination.lat!, destination.lng!);
  if (destination.warnings?.includes("v2_hiking_trail_merged")) {
    const trailDist = minDistanceToPolylineMeters(
      point.lat,
      point.lng,
      destination.routeLineCoordinates
    );
    distanceMeters = Math.min(distanceMeters, trailDist);
  }
  return distanceMeters;
}

function scoreGenericSupportAttachment(
  support: PbfCopierPreviewDoc,
  destination: PbfCopierPreviewDoc,
  settings: PbfSupportObjectSettings,
  friendly: (d: PbfCopierPreviewDoc) => boolean,
  maxRadiusMeters: number
): AttachmentCandidate | null {
  const point = docPoint(support);
  if (!point) return null;
  const distanceMeters = effectiveDistanceToDestinationMeters(point, destination);
  if (distanceMeters > maxRadiusMeters) return null;
  if (!friendly(destination) && !destination.warnings?.includes("v2_hiking_trail_merged")) return null;

  let score = maxRadiusMeters - distanceMeters;
  let attachReason = `within ${Math.round(distanceMeters)}m of destination/trail`;
  if (destination.warnings?.includes("v2_hiking_trail_merged")) {
    score += 50;
    attachReason = `within ${Math.round(distanceMeters)}m of named trail/trailhead`;
  }
  if (namesShareToken(support.displayName || "", destination.displayName || "")) {
    score += 40;
  }
  return { destinationIndex: -1, distanceMeters, attachReason, score };
}

function scoreShelterAttachment(
  shelter: PbfCopierPreviewDoc,
  destination: PbfCopierPreviewDoc,
  settings: PbfSupportObjectSettings
): AttachmentCandidate | null {
  const point = docPoint(shelter);
  if (!point) return null;

  const tags = shelter.sourceTagSample ?? {};
  const named = hasOsmNameTag(tags) || hasMeaningfulPreviewName(shelter);
  let distanceMeters = effectiveDistanceToDestinationMeters(point, destination);
  let attachReason = "";
  let score = 0;

  if (distanceMeters > settings.shelterAttachRadiusMeters) return null;

  if (destination.warnings?.includes("v2_hiking_trail_merged")) {
    score += 90 - distanceMeters;
    attachReason = named
      ? `named shelter on route (${Math.round(distanceMeters)}m)`
      : `support shelter near trail (${Math.round(distanceMeters)}m)`;
  } else if (isBenchFriendlyDestination(destination)) {
    score += 80 - distanceMeters;
    attachReason = named
      ? `named shelter near ${destination.displayName || "destination"}`
      : `support shelter near park/trail destination`;
  } else if (named && isPrimaryDestination(destination)) {
    score += 50 - distanceMeters;
    attachReason = "named shelter near destination";
  } else {
    return null;
  }

  if (score <= 0) return null;
  return { destinationIndex: -1, distanceMeters, attachReason, score };
}

function pickBestShelterAttachment(
  supportDoc: PbfCopierPreviewDoc,
  destinations: DestinationCandidate[],
  settings: PbfSupportObjectSettings
): AttachmentCandidate | null {
  let best: AttachmentCandidate | null = null;
  for (const candidate of destinations) {
    const scored = scoreShelterAttachment(supportDoc, candidate.doc, settings);
    if (!scored) continue;
    scored.destinationIndex = candidate.index;
    if (!best || scored.score > best.score) best = scored;
  }
  return best;
}

function pickBestGenericSupportAttachment(
  supportDoc: PbfCopierPreviewDoc,
  destinations: DestinationCandidate[],
  settings: PbfSupportObjectSettings,
  friendly: (d: PbfCopierPreviewDoc) => boolean,
  maxRadiusMeters: number
): AttachmentCandidate | null {
  let best: AttachmentCandidate | null = null;
  for (const candidate of destinations) {
    const scored = scoreGenericSupportAttachment(
      supportDoc,
      candidate.doc,
      settings,
      friendly,
      maxRadiusMeters
    );
    if (!scored) continue;
    scored.destinationIndex = candidate.index;
    if (!best || scored.score > best.score) best = scored;
  }
  return best;
}

function pickBestParkingAttachment(
  supportDoc: PbfCopierPreviewDoc,
  destinations: DestinationCandidate[],
  settings: PbfSupportObjectSettings
): AttachmentCandidate | null {
  let best: AttachmentCandidate | null = null;
  for (const candidate of destinations) {
    const point = docPoint(supportDoc);
    if (!point) continue;
    const baseDistance = effectiveDistanceToDestinationMeters(point, candidate.doc);
    const scored = scoreParkingAttachment(supportDoc, candidate.doc, baseDistance, settings);
    if (!scored) continue;
    scored.destinationIndex = candidate.index;
    if (!best || scored.score > best.score) best = scored;
  }
  return best;
}

function pickBestBenchLikeAttachment(
  supportDoc: PbfCopierPreviewDoc,
  destinations: DestinationCandidate[],
  settings: PbfSupportObjectSettings
): AttachmentCandidate | null {
  let best: AttachmentCandidate | null = null;
  for (const candidate of destinations) {
    const scored = scoreBenchAttachment(supportDoc, candidate.doc, settings);
    if (!scored) continue;
    scored.destinationIndex = candidate.index;
    if (!best || scored.score > best.score) best = scored;
  }
  return best;
}

function appendSupportMetadata(
  target: PbfSupportEnrichedDoc,
  kind: keyof PbfSupportMetadata,
  ref: PbfSupportObjectRef
): void {
  if (!target.supportMetadata) target.supportMetadata = {};
  const list = target.supportMetadata[kind] ?? [];
  list.push(ref);
  target.supportMetadata[kind] = list;
}

export function applyPbfSupportRelationships(
  items: PbfCopierPreviewDoc[],
  settings: PbfSupportObjectSettings,
  eligiblePrimary: (doc: PbfCopierPreviewDoc) => boolean = isPrimaryDestination
): PbfSupportEnrichedDoc[] {
  const enriched: PbfSupportEnrichedDoc[] = items.map((doc) => ({ ...doc }));

  if (!settings.attachSupportToDestinations) {
    return enriched;
  }

  const destinations: DestinationCandidate[] = enriched
    .map((doc, index) => ({ doc, index }))
    .filter(({ doc }) => eligiblePrimary(doc));

  for (let i = 0; i < enriched.length; i++) {
    const doc = enriched[i]!;
    if (isSupportParking(doc)) {
      const match = pickBestParkingAttachment(doc, destinations, settings);
      if (match) {
        const dest = enriched[match.destinationIndex]!;
        appendSupportMetadata(dest, "parking", supportRef(doc, match.distanceMeters, match.attachReason));
        doc.attachedTo = {
          osmType: dest.osmType,
          osmId: dest.osmId,
          displayName: dest.displayName || "(unnamed)",
        };
        doc.attachReason = match.attachReason;
      }
    } else if (isSupportBench(doc)) {
      const match = pickBestBenchLikeAttachment(doc, destinations, settings);
      if (match) {
        const dest = enriched[match.destinationIndex]!;
        appendSupportMetadata(dest, "benches", supportRef(doc, match.distanceMeters, match.attachReason));
        doc.attachedTo = {
          osmType: dest.osmType,
          osmId: dest.osmId,
          displayName: dest.displayName || "(unnamed)",
        };
        doc.attachReason = match.attachReason;
      }
    } else if (isSupportShelter(doc)) {
      const match = pickBestShelterAttachment(doc, destinations, settings);
      if (match) {
        const dest = enriched[match.destinationIndex]!;
        appendSupportMetadata(dest, "shelters", supportRef(doc, match.distanceMeters, match.attachReason));
        doc.attachedTo = {
          osmType: dest.osmType,
          osmId: dest.osmId,
          displayName: dest.displayName || "(unnamed)",
        };
        doc.attachReason = match.attachReason;
      }
    } else if (isSupportToilet(doc)) {
      const match = pickBestGenericSupportAttachment(doc, destinations, settings, isToiletFriendlyDestination);
      if (match) {
        const dest = enriched[match.destinationIndex]!;
        appendSupportMetadata(dest, "toilets", supportRef(doc, match.distanceMeters, match.attachReason));
        doc.attachedTo = {
          osmType: dest.osmType,
          osmId: dest.osmId,
          displayName: dest.displayName || "(unnamed)",
        };
        doc.attachReason = match.attachReason;
      }
    } else if (isSupportInfoMap(doc)) {
      const match = pickBestGenericSupportAttachment(
        doc,
        destinations,
        settings,
        isToiletFriendlyDestination,
        settings.infoMapAttachRadiusMeters
      );
      if (match) {
        const dest = enriched[match.destinationIndex]!;
        appendSupportMetadata(dest, "informationMaps", supportRef(doc, match.distanceMeters, match.attachReason));
        doc.attachedTo = {
          osmType: dest.osmType,
          osmId: dest.osmId,
          displayName: dest.displayName || "(unnamed)",
        };
        doc.attachReason = match.attachReason;
      }
    } else if (isSupportChargingStation(doc) || isSupportBicycleParking(doc)) {
      const match = pickBestGenericSupportAttachment(
        doc,
        destinations,
        settings,
        isToiletFriendlyDestination,
        settings.parkingAttachRadiusMeters
      );
      if (match) {
        const dest = enriched[match.destinationIndex]!;
        appendSupportMetadata(dest, "parking", supportRef(doc, match.distanceMeters, match.attachReason));
        doc.attachedTo = {
          osmType: dest.osmType,
          osmId: dest.osmId,
          displayName: dest.displayName || "(unnamed)",
        };
        doc.attachReason = match.attachReason;
      }
    }
  }

  return enriched;
}

export function matchNonDestinationJunk(doc: PbfCopierPreviewDoc): { reason: string } | null {
  if (isPrimaryDestination(doc) || isSupportObject(doc)) return null;

  const locavaJunk = matchLocavaMapJunk(doc);
  if (locavaJunk) return { reason: locavaJunk.reason };

  const tags = doc.sourceTagSample ?? {};
  const highway = tag(tags, "highway");
  if (
    highway &&
    ["traffic_signals", "stop", "give_way", "crossing", "turning_circle", "mini_roundabout", "motorway_junction"].includes(
      highway
    )
  ) {
    return { reason: "road sign/signal/crossing" };
  }
  if (tag(tags, "amenity") === "fire_hydrant") return { reason: "fire hydrant" };
  if (highway === "bus_stop" || tag(tags, "public_transport") === "platform") return { reason: "transit stop" };
  if (tag(tags, "amenity") === "bench") return null;
  if (tag(tags, "amenity") === "parking") return null;
  if (tag(tags, "amenity") === "toilets") return null;
  if (tag(tags, "tourism") === "information" && tag(tags, "information") === "map") return null;

  const building = tag(tags, "building");
  if (building && ["garage", "roof", "greenhouse", "shed", "barn"].includes(building)) {
    return { reason: `generic building=${building}` };
  }
  if (building === "yes" && !hasMeaningfulPreviewName(doc) && !hasOsmNameTag(tags)) {
    return { reason: "unnamed generic building" };
  }

  if (hasTag(tags, "addr:housenumber") && !hasMeaningfulPreviewName(doc) && !hasOsmNameTag(tags)) {
    return { reason: "address-only record" };
  }

  return null;
}
