/**
 * PBF Copier V2 — route-centric outdoor destination grouping (post quality-filter).
 */
import { normalizePreviewDisplayName } from "./pbfCopierPreviewQuality.js";
import { deriveDisplayName } from "./pbfCopierV2DeriveDisplayName.js";
import {
  isNamedSkiRun,
  isSyntheticPreviewLabel,
} from "./pbfCopierV2MountainQuality.js";
import type { PbfQualityFilteredPreviewDoc } from "./pbfCopierV2QualityFilters.js";
import type { PbfSupportObjectRef } from "./pbfCopierV2SupportObjects.js";
import {
  haversineMeters,
  isSupportBench,
  isSupportInfoMap,
  isSupportParking,
  isSupportShelter,
  isSupportToilet,
} from "./pbfCopierV2SupportObjects.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export type PbfOutdoorGroupingSummary = {
  routeGroupsBuilt: number;
  trailheadsAttached: number;
  parkingAttachedToRoutes: number;
  supportObjectsAttached: number;
  derivedNamesCreated: number;
  lowConfidenceNames: number;
  hiddenJunkAfterGrouping: number;
};

export type PbfOutdoorGroupingSettings = {
  showSupportObjectsAsMarkers: boolean;
};

export type PbfOutdoorGroupedPreviewDoc = PbfQualityFilteredPreviewDoc & {
  destinationGroupId?: string;
  routeMarkerCoordinate?: { lat: number; lng: number };
  routeCenterCoordinate?: { lat: number; lng: number };
  derivedName?: boolean;
  nameSource?: string;
  nameConfidence?: string;
  attachedToRouteId?: string;
  supportMetadata?: PbfCopierPreviewDoc["supportMetadata"] & {
    trailheads?: PbfSupportObjectRef[];
    viewpoints?: PbfSupportObjectRef[];
    waterfalls?: PbfSupportObjectRef[];
  };
};

const TRAILHEAD_ENDPOINT_RADIUS_M = 200;
const TRAILHEAD_LINE_RADIUS_M = 75;
const ROUTE_SUPPORT_RADIUS_M = 200;
const ROUTE_PARKING_RADIUS_M = 250;

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function hasOsmNameTag(tags: Record<string, string>): boolean {
  return Boolean(tags.name?.trim() || tags["name:en"]?.trim());
}

function hasMeaningfulPreviewName(doc: PbfCopierPreviewDoc): boolean {
  const raw = (doc.displayName || "").trim().toLowerCase();
  if (!raw || isSyntheticPreviewLabel(doc)) return false;
  const key = normalizePreviewDisplayName(doc.displayName);
  if (!key) return false;
  if (/^(highway|amenity|natural|landuse|man made|shop|tourism|building|waterway|railway) /.test(key)) {
    return false;
  }
  return true;
}

function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && t !== "trail" && t !== "trailhead");
}

function namesShareToken(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  return ta.some((t) => tb.includes(t));
}

export function routeDestinationGroupId(doc: PbfCopierPreviewDoc): string {
  return `route:${doc.osmType}:${doc.osmId}`;
}

export function isNamedOutdoorRoute(doc: PbfCopierPreviewDoc): boolean {
  if (doc.kind !== "unexplored_route") return false;
  if (doc.warnings?.includes("v2_hiking_trail_merged")) return true;
  if (isNamedSkiRun(doc)) return true;
  const tags = doc.sourceTagSample ?? {};
  if (hasOsmNameTag(tags)) return true;
  return hasMeaningfulPreviewName(doc);
}

export function isTrailheadDoc(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "highway") === "trailhead") return true;
  if (/\btrailhead\b/i.test(doc.displayName || "")) return true;
  return false;
}

function getRouteCoords(doc: PbfCopierPreviewDoc): Array<{ lat: number; lng: number }> {
  if (doc.routeLineCoordinates && doc.routeLineCoordinates.length >= 2) return doc.routeLineCoordinates;
  if (doc.routeLineSegments) {
    for (const seg of doc.routeLineSegments) {
      if (seg && seg.length >= 2) return seg;
    }
  }
  if (doc.lat != null && doc.lng != null) return [{ lat: doc.lat, lng: doc.lng }];
  return [];
}

function minDistanceToRouteMeters(lat: number, lng: number, route: PbfCopierPreviewDoc): number {
  const coords = getRouteCoords(route);
  if (coords.length < 2) {
    if (coords.length === 1) return haversineMeters(lat, lng, coords[0]!.lat, coords[0]!.lng);
    return Infinity;
  }
  let min = Infinity;
  for (const p of coords) min = Math.min(min, haversineMeters(lat, lng, p.lat, p.lng));
  return min;
}

function routeEndpoints(route: PbfCopierPreviewDoc): Array<{ lat: number; lng: number }> {
  const coords = getRouteCoords(route);
  if (coords.length < 2) return coords;
  return [coords[0]!, coords[coords.length - 1]!];
}

function minDistanceToEndpointsMeters(lat: number, lng: number, route: PbfCopierPreviewDoc): number {
  const ends = routeEndpoints(route);
  if (!ends.length) return Infinity;
  return Math.min(...ends.map((p) => haversineMeters(lat, lng, p.lat, p.lng)));
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

function appendMeta(
  route: PbfOutdoorGroupedPreviewDoc,
  key: keyof NonNullable<PbfOutdoorGroupedPreviewDoc["supportMetadata"]>,
  ref: PbfSupportObjectRef
): void {
  if (!route.supportMetadata) route.supportMetadata = {};
  const list = route.supportMetadata[key] ?? [];
  if (list.some((x) => x.osmType === ref.osmType && x.osmId === ref.osmId)) return;
  list.push(ref);
  route.supportMetadata[key] = list;
}

function markAttachedToRoute(
  item: PbfOutdoorGroupedPreviewDoc,
  route: PbfOutdoorGroupedPreviewDoc,
  reason: string,
  settings: PbfOutdoorGroupingSettings
): void {
  item.attachedTo = {
    osmType: route.osmType,
    osmId: route.osmId,
    displayName: route.displayName || "(unnamed)",
  };
  item.attachedToRouteId = route.destinationGroupId;
  item.attachReason = reason;
  item.filteredBy = ["support_attached"];
  item.filterReason = reason;
  item.filteredOut = !settings.showSupportObjectsAsMarkers;
}

type RouteCandidate = { index: number; doc: PbfOutdoorGroupedPreviewDoc };

function scoreTrailheadToRoute(
  trailhead: PbfCopierPreviewDoc,
  route: PbfCopierPreviewDoc
): { score: number; distanceMeters: number; reason: string } | null {
  if (trailhead.lat == null || trailhead.lng == null) return null;
  const thName = trailhead.displayName || "";
  const routeName = route.displayName || "";
  let score = 0;
  let reason = "";
  let distanceMeters = minDistanceToRouteMeters(trailhead.lat, trailhead.lng, route);

  if (namesShareToken(thName, routeName)) {
    score += 120;
    reason = "trailhead name matches route";
    distanceMeters = Math.min(distanceMeters, minDistanceToEndpointsMeters(trailhead.lat, trailhead.lng, route));
  }

  const endpointDist = minDistanceToEndpointsMeters(trailhead.lat, trailhead.lng, route);
  if (endpointDist <= TRAILHEAD_ENDPOINT_RADIUS_M) {
    score += 100 - endpointDist / 2;
    reason = reason || `within ${Math.round(endpointDist)}m of route endpoint`;
    distanceMeters = Math.min(distanceMeters, endpointDist);
  }

  if (distanceMeters <= TRAILHEAD_LINE_RADIUS_M) {
    score += 90 - distanceMeters;
    reason = reason || `within ${Math.round(distanceMeters)}m of route line`;
  }

  const thTags = trailhead.sourceTagSample ?? {};
  if (tag(thTags, "tourism") === "information" && namesShareToken(thName, routeName)) {
    score += 40;
    reason = reason || "trailhead information board matches route";
  }

  if (score <= 0) return null;
  return { score, distanceMeters, reason };
}

function scoreSupportToRoute(
  support: PbfCopierPreviewDoc,
  route: PbfCopierPreviewDoc,
  routeHasTrailhead: boolean
): { score: number; distanceMeters: number; reason: string } | null {
  if (support.lat == null || support.lng == null) return null;
  const lineDist = minDistanceToRouteMeters(support.lat, support.lng, route);
  const endpointDist = minDistanceToEndpointsMeters(support.lat, support.lng, route);
  const radius = isSupportParking(support) ? ROUTE_PARKING_RADIUS_M : ROUTE_SUPPORT_RADIUS_M;
  const nearest = Math.min(lineDist, endpointDist);
  if (nearest > radius) return null;

  let score = radius - nearest;
  let reason = `within ${Math.round(nearest)}m of route`;
  if (namesShareToken(support.displayName || "", route.displayName || "")) {
    score += 60;
    reason = "name matches route";
  }
  if (routeHasTrailhead && nearest <= ROUTE_PARKING_RADIUS_M) {
    score += 40;
    reason = reason + "; near route trailhead cluster";
  }
  return { score, distanceMeters: nearest, reason };
}

function isWaterfallDoc(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  return tag(tags, "waterway") === "waterfall" || tag(tags, "natural") === "waterfall";
}

function isViewpointDoc(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  return tag(tags, "tourism") === "viewpoint" || tag(tags, "scenic") === "yes";
}

function isUnnamedConnectorPath(doc: PbfCopierPreviewDoc): boolean {
  if (doc.kind !== "unexplored_route") return false;
  const tags = doc.sourceTagSample ?? {};
  if (hasOsmNameTag(tags) || hasMeaningfulPreviewName(doc)) return false;
  const highway = tag(tags, "highway");
  return highway === "path" || highway === "footway";
}

function isForestGnisWithoutRecreation(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "landuse") !== "forest" && tag(tags, "natural") !== "wood") return false;
  if (!hasMeaningfulPreviewName(doc) && !hasOsmNameTag(tags)) return false;
  if (tag(tags, "leisure") === "park" || tag(tags, "leisure") === "nature_reserve") return false;
  if (tag(tags, "boundary") === "protected_area") return false;
  if (tag(tags, "highway") === "trailhead") return false;
  if (tag(tags, "tourism")) return false;
  if (/\b(recreation|trail|park|camp)\b/i.test(doc.displayName || "")) return false;
  if (/\bmunicipal forest\b/i.test(doc.displayName || "")) return true;
  if (tags["gnis:feature_id"]) return true;
  return tag(tags, "landuse") === "forest" && hasOsmNameTag(tags);
}

function isOutdoorJunkAfterGrouping(doc: PbfCopierPreviewDoc): string | null {
  const tags = doc.sourceTagSample ?? {};
  if (tag(tags, "man_made") === "snow_cannon") return "snow making equipment";
  if (tag(tags, "golf") === "tee") return "golf tee";
  if (tag(tags, "golf") === "bunker" || (tag(tags, "natural") === "sand" && tag(tags, "golf") === "bunker")) {
    return "golf bunker";
  }
  if (tag(tags, "traffic_sign") || tag(tags, "hazard") || tag(tags, "curves") === "extended") {
    return "hazard/traffic sign";
  }
  if (
    (tag(tags, "public_transport") === "station" || tag(tags, "aerialway") === "station") &&
    !hasOsmNameTag(tags) &&
    !hasMeaningfulPreviewName(doc)
  ) {
    return "unnamed transit/lift station";
  }
  if (isForestGnisWithoutRecreation(doc)) return "named land area without clear visitor destination";
  return null;
}

function computeRouteLengthMeters(route: PbfCopierPreviewDoc): number | null {
  const coords = getRouteCoords(route);
  if (coords.length < 2) return null;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += haversineMeters(coords[i]!.lat, coords[i]!.lng, coords[i + 1]!.lat, coords[i + 1]!.lng);
  }
  return Math.round(total);
}

export function computeRouteMarkerCoordinate(route: PbfOutdoorGroupedPreviewDoc): { lat: number; lng: number } {
  const meta = route.supportMetadata;
  if (meta?.trailheads?.[0]) return { lat: meta.trailheads[0].lat, lng: meta.trailheads[0].lng };
  if (meta?.parking?.[0]) return { lat: meta.parking[0].lat, lng: meta.parking[0].lng };

  const coords = getRouteCoords(route);
  if (coords.length >= 2) return coords[0]!;
  if (coords.length === 1) return coords[0]!;
  return { lat: route.lat, lng: route.lng };
}

function computeRouteCenterCoordinate(route: PbfCopierPreviewDoc): { lat: number; lng: number } {
  const coords = getRouteCoords(route);
  if (!coords.length) return { lat: route.lat, lng: route.lng };
  const mid = coords[Math.floor(coords.length / 2)]!;
  return { lat: mid.lat, lng: mid.lng };
}

function findNearestRoute(
  item: PbfCopierPreviewDoc,
  routes: RouteCandidate[]
): { route: PbfOutdoorGroupedPreviewDoc; distanceMeters: number } | null {
  if (item.lat == null || item.lng == null) return null;
  let best: { route: PbfOutdoorGroupedPreviewDoc; distanceMeters: number } | null = null;
  for (const r of routes) {
    const d = minDistanceToRouteMeters(item.lat, item.lng, r.doc);
    if (!best || d < best.distanceMeters) best = { route: r.doc, distanceMeters: d };
  }
  return best;
}

export function buildOutdoorDestinationGroups(
  items: PbfQualityFilteredPreviewDoc[],
  settings: PbfOutdoorGroupingSettings
): { items: PbfOutdoorGroupedPreviewDoc[]; summary: PbfOutdoorGroupingSummary } {
  const working: PbfOutdoorGroupedPreviewDoc[] = items.map((d) => ({
    ...d,
    supportMetadata: d.supportMetadata ? { ...d.supportMetadata } : undefined,
  }));

  const summary: PbfOutdoorGroupingSummary = {
    routeGroupsBuilt: 0,
    trailheadsAttached: 0,
    parkingAttachedToRoutes: 0,
    supportObjectsAttached: 0,
    derivedNamesCreated: 0,
    lowConfidenceNames: 0,
    hiddenJunkAfterGrouping: 0,
  };

  const routes: RouteCandidate[] = working
    .map((doc, index) => ({ doc, index }))
    .filter(({ doc }) => isNamedOutdoorRoute(doc) && !doc.filteredOut);

  for (const r of routes) {
    r.doc.destinationGroupId = routeDestinationGroupId(r.doc);
    summary.routeGroupsBuilt += 1;
  }

  for (let i = 0; i < working.length; i++) {
    const th = working[i]!;
    if (!isTrailheadDoc(th) || th.lat == null || th.lng == null) continue;
    if (isNamedOutdoorRoute(th)) continue;

    let best: { routeIndex: number; score: number; distanceMeters: number; reason: string } | null = null;
    for (const r of routes) {
      const scored = scoreTrailheadToRoute(th, r.doc);
      if (!scored) continue;
      if (!best || scored.score > best.score) {
        best = { routeIndex: r.index, score: scored.score, distanceMeters: scored.distanceMeters, reason: scored.reason };
      }
    }
    if (!best) continue;

    const route = working[best.routeIndex]!;
    appendMeta(route, "trailheads", supportRef(th, best.distanceMeters, best.reason));
    markAttachedToRoute(th, route, "trailhead attached to route", settings);
    summary.trailheadsAttached += 1;
    summary.supportObjectsAttached += 1;
  }

  for (let i = 0; i < working.length; i++) {
    const support = working[i]!;
    if (support.lat == null || support.lng == null) continue;
    if (isNamedOutdoorRoute(support)) continue;
    if (isTrailheadDoc(support) && support.filteredOut) continue;

    const isSupport =
      isSupportParking(support) ||
      isSupportBench(support) ||
      isSupportShelter(support) ||
      isSupportToilet(support) ||
      isSupportInfoMap(support);

    if (!isSupport) continue;

    let best: { routeIndex: number; score: number; distanceMeters: number; reason: string } | null = null;
    for (const r of routes) {
      const hasTrailhead = Boolean(r.doc.supportMetadata?.trailheads?.length);
      const scored = scoreSupportToRoute(support, r.doc, hasTrailhead);
      if (!scored) continue;
      if (!best || scored.score > best.score) {
        best = { routeIndex: r.index, score: scored.score, distanceMeters: scored.distanceMeters, reason: scored.reason };
      }
    }
    if (!best) continue;

    const route = working[best.routeIndex]!;
    let metaKey: keyof NonNullable<PbfOutdoorGroupedPreviewDoc["supportMetadata"]> = "parking";
    if (isSupportBench(support)) metaKey = "benches";
    else if (isSupportShelter(support)) metaKey = "shelters";
    else if (isSupportToilet(support)) metaKey = "toilets";
    else if (isSupportInfoMap(support)) {
      metaKey = "informationMaps";
    }

    appendMeta(route, metaKey, supportRef(support, best.distanceMeters, best.reason));
    markAttachedToRoute(support, route, `${String(metaKey)} attached to route`, settings);
    summary.supportObjectsAttached += 1;
    if (isSupportParking(support)) summary.parkingAttachedToRoutes += 1;
  }

  for (let i = 0; i < working.length; i++) {
    const item = working[i]!;
    if (item.filteredOut && item.attachedToRouteId) continue;

    const nearestRouteMatch = findNearestRoute(item, routes);
    const nearestRoute = nearestRouteMatch?.route ?? null;

    if (isWaterfallDoc(item) || isViewpointDoc(item)) {
      const derived = deriveDisplayName(item, {
        nearestRoute,
        routeDistanceMeters: nearestRouteMatch?.distanceMeters,
      });
      if (derived.derivedName || !hasOsmNameTag(item.sourceTagSample ?? {})) {
        item.displayName = derived.displayName;
        item.derivedName = derived.derivedName;
        item.nameSource = derived.nameSource;
        item.nameConfidence = derived.nameConfidence;
        if (derived.derivedName) {
          summary.derivedNamesCreated += 1;
          if (derived.nameConfidence === "low") summary.lowConfidenceNames += 1;
        }
      }

      if (nearestRoute && nearestRouteMatch && nearestRouteMatch.distanceMeters <= 200) {
        const key = isWaterfallDoc(item) ? "waterfalls" : "viewpoints";
        appendMeta(
          nearestRoute,
          key,
          supportRef(item, nearestRouteMatch.distanceMeters, `nearby ${key.slice(0, -1)} on route corridor`)
        );
      }
      continue;
    }

    if (isUnnamedConnectorPath(item) && nearestRoute && nearestRouteMatch) {
      const derived = deriveDisplayName(item, {
        nearestRoute,
        routeDistanceMeters: nearestRouteMatch.distanceMeters,
      });
      if (nearestRouteMatch.distanceMeters <= 80) {
        item.displayName = derived.displayName;
        item.derivedName = true;
        item.nameSource = derived.nameSource;
        item.nameConfidence = derived.nameConfidence;
        summary.derivedNamesCreated += 1;
        if (derived.nameConfidence === "low") summary.lowConfidenceNames += 1;
        markAttachedToRoute(item, nearestRoute, "connector path attached to route", settings);
        summary.supportObjectsAttached += 1;
      }
    }
  }

  for (const r of routes) {
    const route = working[r.index]!;
    route.routeCenterCoordinate = computeRouteCenterCoordinate(route);
    route.routeMarkerCoordinate = computeRouteMarkerCoordinate(route);
    route.lat = route.routeMarkerCoordinate.lat;
    route.lng = route.routeMarkerCoordinate.lng;
    const len = computeRouteLengthMeters(route);
    if (len != null) route.distanceMeters = len;
  }

  for (const item of working) {
    if (item.filteredOut) continue;
    if (isNamedOutdoorRoute(item)) continue;
    if (isTrailheadDoc(item) && item.attachedToRouteId) continue;

    const junk = isOutdoorJunkAfterGrouping(item);
    if (!junk) continue;
    item.filteredOut = true;
    item.filteredBy = [...(item.filteredBy ?? []), "non_destination_amenity"];
    item.filterReason = junk;
    summary.hiddenJunkAfterGrouping += 1;
  }

  return { items: working, summary };
}
