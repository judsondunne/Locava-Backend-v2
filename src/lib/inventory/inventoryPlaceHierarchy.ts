import { haversineMeters } from "./inventoryTileGrid.js";
import type { LocavaInventoryRoute, LocavaInventorySpot, PlaceKind } from "./inventoryLocavaTypes.js";
import type { OsmFeatureListItem } from "../openstreetmap/osmFeatureParse.js";

export type PlaceHierarchyDiagnostics = {
  parentPlaces: number;
  childFeatures: number;
  standalonePlaces: number;
  supportFeatures: number;
  parentPlacesWithChildRoutes: number;
  parentPlacesWithChildSpots: number;
  parentPlacesWithParking: number;
  parentPlacesMissingParking: number;
  sampleParentPlaces: Array<Record<string, unknown>>;
  sampleChildFeatures: Array<Record<string, unknown>>;
  samplePlaceWithTrails: Array<Record<string, unknown>>;
  samplePlaceWithWaterfalls: Array<Record<string, unknown>>;
  samplePlaceWithParking: Array<Record<string, unknown>>;
  suspiciousParentChildCollapses: Array<Record<string, unknown>>;
  orphanChildFeatures: Array<Record<string, unknown>>;
};

const PARENT_CATEGORIES = new Set([
  "park",
  "nature_reserve",
  "protected_area",
  "recreation_area",
  "camp_site",
  "campground",
  "beach",
  "historic_site",
  "museum",
  "attraction",
  "national_park",
  "historical_park",
]);

const CHILD_CATEGORIES = new Set([
  "viewpoint",
  "waterfall",
  "swimming",
  "swimming_hole",
  "beach",
  "picnic_site",
  "trailhead",
  "peak",
  "hiking",
]);

const SUPPORT_CATEGORIES = new Set(["bench", "toilet", "information", "parking"]);

function tag(tags: Record<string, string>, key: string): string | undefined {
  return tags[key]?.trim().toLowerCase();
}

function isParentPlace(spot: LocavaInventorySpot): boolean {
  if (PARENT_CATEGORIES.has(spot.category)) return true;
  if (tag(spot.tags, "boundary") === "national_park") return true;
  if (tag(spot.tags, "leisure") === "park" && spot.displayName && spot.displayName.length > 8) return true;
  if (tag(spot.tags, "historic") === "yes" && tag(spot.tags, "tourism") === "museum") return true;
  const name = (spot.displayName ?? spot.name).toLowerCase();
  if (/national (historical )?park|historical park|nature reserve|recreation area/i.test(name)) return true;
  return false;
}

function pointInBbox(lat: number, lng: number, bbox: LocavaInventorySpot["bbox"], bufferMeters = 200): boolean {
  const latPad = bufferMeters / 111320;
  const lngPad = bufferMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return (
    lat >= bbox.minLat - latPad &&
    lat <= bbox.maxLat + latPad &&
    lng >= bbox.minLng - lngPad &&
    lng <= bbox.maxLng + lngPad
  );
}

function findVisitorOrEntrance(features: OsmFeatureListItem[], parent: LocavaInventorySpot): { lat: number; lng: number; kind: string } | null {
  for (const f of features) {
    if (f.geometryKind !== "point") continue;
    if (!pointInBbox(f.lat, f.lng, parent.bbox, 400)) continue;
    if (tag(f.tags, "entrance") === "main") return { lat: f.lat, lng: f.lng, kind: "entrance" };
    if (tag(f.tags, "tourism") === "information" && (tag(f.tags, "information") === "office" || /visitor/i.test(f.name ?? ""))) {
      return { lat: f.lat, lng: f.lng, kind: "visitor_center" };
    }
    if (tag(f.tags, "tourism") === "museum" || tag(f.tags, "building") === "museum") {
      return { lat: f.lat, lng: f.lng, kind: "museum" };
    }
  }
  for (const f of features) {
    if (f.geometryKind !== "point") continue;
    if (!pointInBbox(f.lat, f.lng, parent.bbox, 600)) continue;
    if (tag(f.tags, "amenity") === "parking" && tag(f.tags, "access") !== "private") {
      return { lat: f.lat, lng: f.lng, kind: "parking" };
    }
  }
  return null;
}

export function applyPlaceHierarchy(input: {
  spots: LocavaInventorySpot[];
  routes: LocavaInventoryRoute[];
  rawFeatures: OsmFeatureListItem[];
}): { spots: LocavaInventorySpot[]; routes: LocavaInventoryRoute[]; diagnostics: PlaceHierarchyDiagnostics } {
  const parents = input.spots.filter(isParentPlace);
  const parentByKey = new Map(parents.map((p) => [p.sourceKey, p]));

  const spots = input.spots.map((spot) => {
    if (isParentPlace(spot)) {
      const access = findVisitorOrEntrance(input.rawFeatures, spot);
      const displayCenter = access ?? spot.displayCenter ?? spot.primaryAnchor ?? { lat: spot.lat, lng: spot.lng };
      return {
        ...spot,
        placeKind: "parent_place" as PlaceKind,
        displayCenter: { lat: displayCenter.lat, lng: displayCenter.lng },
        areaCenter: spot.areaCenter ?? { lat: spot.lat, lng: spot.lng },
        entranceCenter: access?.kind === "entrance" ? { lat: access.lat, lng: access.lng } : spot.entranceCenter,
        visitorCenter: access?.kind === "visitor_center" || access?.kind === "museum" ? { lat: access.lat, lng: access.lng } : spot.visitorCenter,
        childSpotIds: [] as string[],
        childRouteIds: [] as string[],
        childFeatureTypes: [] as string[],
      };
    }

    for (const parent of parents) {
      if (pointInBbox(spot.lat, spot.lng, parent.bbox, 300)) {
        const isChild = CHILD_CATEGORIES.has(spot.category) || spot.category === "natural_feature";
        if (isChild && spot.sourceKey !== parent.sourceKey) {
          return {
            ...spot,
            placeKind: "child_feature" as PlaceKind,
            parentPlaceId: parent.id,
            parentPlaceName: parent.displayName ?? parent.name,
            parentSourceKey: parent.sourceKey,
          };
        }
      }
    }

    if (SUPPORT_CATEGORIES.has(spot.category)) {
      return { ...spot, placeKind: "support_feature" as PlaceKind };
    }
    return { ...spot, placeKind: "standalone_place" as PlaceKind };
  });

  const routes = input.routes.map((route) => {
    const center = route.center;
    for (const parent of parents) {
      if (pointInBbox(center.lat, center.lng, parent.bbox, 500)) {
        return {
          ...route,
          placeKind: route.activity === "offroading" ? undefined : ("child_feature" as PlaceKind),
          parentPlaceId: parent.id,
          parentPlaceName: parent.displayName ?? parent.name,
          parentSourceKey: parent.sourceKey,
        };
      }
    }
    return route;
  });

  for (const parent of parents) {
    const enriched = spots.find((s) => s.sourceKey === parent.sourceKey);
    if (!enriched || enriched.placeKind !== "parent_place") continue;
    enriched.childSpotIds = spots.filter((s) => s.parentPlaceId === parent.id).map((s) => s.id);
    enriched.childRouteIds = routes.filter((r) => r.parentPlaceId === parent.id).map((r) => r.id);
    enriched.childFeatureTypes = [...new Set(spots.filter((s) => s.parentPlaceId === parent.id).map((s) => s.category))];
  }

  const parentPlaces = spots.filter((s) => s.placeKind === "parent_place");
  const childFeatures = spots.filter((s) => s.placeKind === "child_feature");

  const diagnostics: PlaceHierarchyDiagnostics = {
    parentPlaces: parentPlaces.length,
    childFeatures: childFeatures.length,
    standalonePlaces: spots.filter((s) => s.placeKind === "standalone_place").length,
    supportFeatures: spots.filter((s) => s.placeKind === "support_feature").length,
    parentPlacesWithChildRoutes: parentPlaces.filter((p) => (p.childRouteIds?.length ?? 0) > 0).length,
    parentPlacesWithChildSpots: parentPlaces.filter((p) => (p.childSpotIds?.length ?? 0) > 0).length,
    parentPlacesWithParking: parentPlaces.filter((p) => p.parking?.hasParking).length,
    parentPlacesMissingParking: parentPlaces.filter((p) => !p.parking?.hasParking).length,
    sampleParentPlaces: parentPlaces.slice(0, 10).map((p) => ({ name: p.displayName ?? p.name, sourceKey: p.sourceKey, childSpots: p.childSpotIds?.length ?? 0 })),
    sampleChildFeatures: childFeatures.slice(0, 10).map((s) => ({ name: s.displayName ?? s.name, parent: s.parentPlaceName, category: s.category })),
    samplePlaceWithTrails: parentPlaces.filter((p) => (p.childRouteIds?.length ?? 0) > 0).slice(0, 5).map((p) => ({ name: p.name, routes: p.childRouteIds?.length })),
    samplePlaceWithWaterfalls: childFeatures.filter((s) => s.category === "waterfall").slice(0, 5).map((s) => ({ name: s.name, parent: s.parentPlaceName })),
    samplePlaceWithParking: parentPlaces.filter((p) => p.parking?.hasParking).slice(0, 5).map((p) => ({ name: p.name })),
    suspiciousParentChildCollapses: [],
    orphanChildFeatures: childFeatures.filter((s) => !s.parentPlaceName).slice(0, 10).map((s) => ({ name: s.name, sourceKey: s.sourceKey })),
  };

  return { spots, routes, diagnostics };
}

export function buildPlaceHierarchyDiagnosticsFromSpots(spots: LocavaInventorySpot[], routes: LocavaInventoryRoute[]): PlaceHierarchyDiagnostics {
  return applyPlaceHierarchy({ spots, routes, rawFeatures: [] }).diagnostics;
}
