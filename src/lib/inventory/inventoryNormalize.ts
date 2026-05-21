import type { InventoryBbox, InventoryRoute, InventorySpot } from "../../contracts/entities/inventory-entities.contract.js";
import { bboxFromCoordinates, isPointInBbox } from "./inventoryBbox.js";
import {
  buildInventoryRouteId,
  buildInventoryRouteSourceKey,
  buildInventorySpotId,
  buildInventorySpotSourceKey,
} from "./inventoryIds.js";
import { mapRouteCategoryFromTags, mapSpotCategoryFromTags } from "./inventoryCategories.js";
import { encodeGeohash, haversineMeters } from "./inventoryTileGrid.js";
import { meetsMinimumRouteQuality, meetsMinimumSpotQuality, scoreInventoryItem } from "./inventoryQuality.js";
import type { InventoryRawObject } from "./sources/inventorySource.types.js";
import {
  assertLikelyNotSwapped,
  centerOfCoordinates,
  isLatLngValid,
  roundInventoryCoordinate,
  roundInventoryLatLng,
  type CoordinateWarning,
} from "./inventoryCoordinates.js";

export type InventoryNormalizeIssue = {
  code: string;
  message: string;
  sample?: unknown;
};

export type InventoryNormalizeResult = {
  spots: InventorySpot[];
  routes: InventoryRoute[];
  rejected: InventoryNormalizeIssue[];
  duplicates: number;
  warnings: InventoryNormalizeIssue[];
  coordinateWarnings: CoordinateWarning[];
  stats: {
    likelySwappedCoordinates: number;
    missingGeometry: number;
    outsideBbox: number;
  };
};

const NEAR_DUPLICATE_METERS = 75;

export function normalizeInventoryName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ");
}

export { roundInventoryCoordinate, roundInventoryLatLng };

function routeDistanceMeters(coords: Array<{ lat: number; lng: number }>): number {
  if (coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += haversineMeters(coords[i - 1]!, coords[i]!);
  }
  return Math.round(total);
}

function encodePolyline(coords: Array<{ lat: number; lng: number }>): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = "";
  for (const c of coords) {
    const lat = Math.round(c.lat * 1e5);
    const lng = Math.round(c.lng * 1e5);
    result += encodeSigned(lat - lastLat);
    result += encodeSigned(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return result;
}

function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  out += String.fromCharCode(v + 63);
  return out;
}

export function normalizeInventoryRawObjects(input: {
  rawObjects: InventoryRawObject[];
  regionKey: string;
  regionBbox: InventoryBbox;
  importRunId: string;
  nowIso?: string;
  preclassifiedCoordinateWarnings?: CoordinateWarning[];
}): InventoryNormalizeResult {
  const now = input.nowIso ?? new Date().toISOString();
  const rejected: InventoryNormalizeIssue[] = [];
  const warnings: InventoryNormalizeIssue[] = [];
  const coordinateWarnings: CoordinateWarning[] = [...(input.preclassifiedCoordinateWarnings ?? [])];
  const spotsBySourceKey = new Map<string, InventorySpot>();
  const routesBySourceKey = new Map<string, InventoryRoute>();
  let duplicates = 0;
  let likelySwappedCoordinates = 0;
  let missingGeometry = 0;
  let outsideBbox = 0;

  for (const raw of input.rawObjects) {
    if (raw.kind === "spot") {
      if (String(raw.tags.building ?? "") === "yes") {
        rejected.push({
          code: "building_polygon",
          message: "Building polygon is not an inventory spot",
          sample: { sourceId: raw.sourceId, name: raw.name },
        });
        continue;
      }
      const lat = roundInventoryCoordinate(raw.lat);
      const lng = roundInventoryCoordinate(raw.lng);
      const swapWarning = assertLikelyNotSwapped({ lat, lng }, raw.sourceId);
      if (swapWarning) {
        coordinateWarnings.push(swapWarning);
        likelySwappedCoordinates += 1;
        rejected.push({
          code: "likely_swapped_coordinates",
          message: "Spot coordinates appear swapped for Vermont/Upper Valley",
          sample: { id: raw.sourceId, name: raw.name ?? raw.sourceId, lat, lng },
        });
        continue;
      }
      if (!isLatLngValid({ lat, lng })) {
        missingGeometry += 1;
        rejected.push({ code: "invalid_coordinates", message: "Spot has invalid coordinates", sample: raw });
        continue;
      }
      if (!isPointInBbox(lat, lng, input.regionBbox)) {
        outsideBbox += 1;
        rejected.push({
          code: "outside_bbox",
          message: "Spot outside import bbox",
          sample: { id: raw.sourceId, name: raw.name ?? raw.sourceId, lat, lng },
        });
        continue;
      }

      const name = (raw.name ?? "").trim();
      const normalizedName = normalizeInventoryName(name || "unnamed");
      const mapped = mapSpotCategoryFromTags(raw.tags);
      const qualityScore = scoreInventoryItem({
        kind: "spot",
        name,
        category: mapped.category,
        categories: mapped.categories,
        lat,
        lng,
        tags: raw.tags,
      });

      if (!meetsMinimumSpotQuality({ name, category: mapped.category, qualityScore })) {
        rejected.push({
          code: "low_quality_spot",
          message: "Spot rejected for low quality or weak category",
          sample: { sourceId: raw.sourceId, name, category: mapped.category, qualityScore },
        });
        continue;
      }

      const sourceKey = buildInventorySpotSourceKey({
        source: raw.source,
        sourceType: raw.sourceType,
        sourceId: raw.sourceId,
      });
      if (spotsBySourceKey.has(sourceKey)) {
        duplicates += 1;
        continue;
      }

      const spot: InventorySpot = {
        id: buildInventorySpotId({
          source: raw.source,
          sourceType: raw.sourceType,
          sourceId: raw.sourceId,
          normalizedName,
          lat,
          lng,
        }),
        kind: "inventory_spot",
        source: raw.source,
        sourceType: raw.sourceType,
        sourceId: raw.sourceId,
        sourceKey,
        name: name || mapped.category.replace(/_/g, " "),
        normalizedName,
        category: mapped.category,
        categories: mapped.categories,
        activities: mapped.activities,
        lat,
        lng,
        geohash: encodeGeohash(lat, lng),
        bbox: raw.bbox,
        regionKey: input.regionKey,
        hasMedia: false,
        linkedPostCount: 0,
        qualityScore,
        status: "staged",
        tags: raw.tags,
        attribution: raw.attribution,
        importRunId: input.importRunId,
        createdAt: now,
        updatedAt: now,
      };
      spotsBySourceKey.set(sourceKey, spot);
    } else {
      const highway = String(raw.tags.highway ?? "").toLowerCase();
      if (["residential", "service", "living_street", "unclassified"].includes(highway) && !(raw.name ?? "").trim()) {
        rejected.push({
          code: "generic_road",
          message: "Unnamed generic road rejected",
          sample: { sourceId: raw.sourceId, highway },
        });
        continue;
      }
      const coords = raw.coordinates
        .map((c) => roundInventoryLatLng(c))
        .filter((c) => isLatLngValid(c));
      if (coords.length < 2) {
        missingGeometry += 1;
        rejected.push({ code: "missing_route_geometry", message: "Route needs at least 2 valid coordinates", sample: raw });
        continue;
      }

      const swapWarnings: CoordinateWarning[] = [];
      for (const c of coords) {
        const warning = assertLikelyNotSwapped(c, raw.sourceId);
        if (warning) swapWarnings.push(warning);
      }
      if (swapWarnings.length > 0) {
        likelySwappedCoordinates += 1;
        coordinateWarnings.push(...swapWarnings);
        rejected.push({
          code: "likely_swapped_coordinates",
          message: "Route coordinates appear swapped",
          sample: { id: raw.sourceId, name: raw.name ?? raw.sourceId, coordinates: coords.slice(0, 3) },
        });
        continue;
      }

      const bbox = bboxFromCoordinates(coords);
      if (!bbox) {
        missingGeometry += 1;
        rejected.push({ code: "invalid_route_bbox", message: "Route bbox could not be computed", sample: raw });
        continue;
      }
      if (
        bbox.maxLat < input.regionBbox.minLat ||
        bbox.minLat > input.regionBbox.maxLat ||
        bbox.maxLng < input.regionBbox.minLng ||
        bbox.minLng > input.regionBbox.maxLng
      ) {
        outsideBbox += 1;
        rejected.push({ code: "outside_bbox", message: "Route outside import bbox", sample: { id: raw.sourceId, bbox } });
        continue;
      }

      const name = (raw.name ?? "").trim();
      const normalizedName = normalizeInventoryName(name || "unnamed route");
      const mapped = mapRouteCategoryFromTags(raw.tags);
      const distanceMeters = routeDistanceMeters(coords);
      const qualityScore = scoreInventoryItem({
        kind: "route",
        name,
        category: mapped.categories[0] ?? "hiking",
        categories: mapped.categories,
        hasGeometry: true,
        distanceMeters,
        tags: raw.tags,
      });

      if (
        !meetsMinimumRouteQuality({
          name,
          category: mapped.categories[0] ?? "hiking",
          qualityScore,
          hasGeometry: true,
        })
      ) {
        rejected.push({
          code: "low_quality_route",
          message: "Route rejected for low quality",
          sample: { sourceId: raw.sourceId, name, qualityScore },
        });
        continue;
      }

      const sourceKey = buildInventoryRouteSourceKey({
        source: raw.source,
        sourceType: raw.sourceType,
        sourceId: raw.sourceId,
      });
      if (routesBySourceKey.has(sourceKey)) {
        duplicates += 1;
        continue;
      }

      const center = centerOfCoordinates(coords) ?? {
        lat: roundInventoryCoordinate((bbox.minLat + bbox.maxLat) / 2),
        lng: roundInventoryCoordinate((bbox.minLng + bbox.maxLng) / 2),
      };

      const route: InventoryRoute = {
        id: buildInventoryRouteId({
          source: raw.source,
          sourceType: raw.sourceType,
          sourceId: raw.sourceId,
          normalizedName,
          bbox,
        }),
        kind: "inventory_route",
        source: raw.source,
        sourceType: raw.sourceType,
        sourceId: raw.sourceId,
        sourceKey,
        name: name || "Unnamed route",
        normalizedName,
        activity: mapped.activity,
        categories: mapped.categories,
        activities: mapped.activities,
        center: {
          lat: roundInventoryCoordinate(center.lat),
          lng: roundInventoryCoordinate(center.lng),
        },
        bbox,
        distanceMeters,
        encodedPolyline: encodePolyline(coords),
        coordinates: coords,
        regionKey: input.regionKey,
        hasMedia: false,
        linkedPostCount: 0,
        qualityScore,
        status: "staged",
        tags: raw.tags,
        attribution: raw.attribution,
        importRunId: input.importRunId,
        createdAt: now,
        updatedAt: now,
      };
      routesBySourceKey.set(sourceKey, route);
    }
  }

  let spots = [...spotsBySourceKey.values()];
  const routes = [...routesBySourceKey.values()];

  const dedupedSpots: InventorySpot[] = [];
  for (const spot of spots.sort((a, b) => b.qualityScore - a.qualityScore)) {
    const near = dedupedSpots.find(
      (existing) =>
        existing.normalizedName === spot.normalizedName &&
        existing.category === spot.category &&
        haversineMeters(existing, spot) <= NEAR_DUPLICATE_METERS
    );
    if (near) {
      duplicates += 1;
      warnings.push({
        code: "near_duplicate_spot",
        message: "Dropped near-duplicate spot",
        sample: { kept: near.id, dropped: spot.id },
      });
      continue;
    }
    dedupedSpots.push(spot);
  }

  spots = dedupedSpots;

  return {
    spots,
    routes,
    rejected,
    duplicates,
    warnings,
    coordinateWarnings,
    stats: {
      likelySwappedCoordinates,
      missingGeometry,
      outsideBbox,
    },
  };
}
