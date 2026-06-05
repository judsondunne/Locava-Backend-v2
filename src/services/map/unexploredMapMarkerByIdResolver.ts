import type { UnexploredTile } from "../../contracts/entities/osm-national-entities.contract.js";
import {
  DEFAULT_INVENTORY_TILE_ZOOM_RANGE,
  formatTileKey,
  latLngToTileXY,
  tilesForViewport,
} from "../../lib/inventory/inventoryTileGrid.js";
import {
  getUnexploredRouteById,
  getUnexploredSpotById,
  getUnexploredTilesByKeys,
  queryUnexploredRoutesByTileKey,
  queryUnexploredSpotsByTileKey,
} from "../../repositories/source-of-truth/unexplored-read-firestore.adapter.js";

export type ResolvedUnexploredItem = {
  id: string;
  sourceCollection: "unexploredSpots" | "unexploredRoutes";
  itemType: "unexploredSpot" | "unexploredRoute";
  doc: Record<string, unknown>;
  resolvedFrom: "firestore_doc" | "tile_doc" | "tile_index";
};

function tileKeysAroundLatLng(lat: number, lng: number): string[] {
  const keys = new Set<string>();
  for (
    let z: number = DEFAULT_INVENTORY_TILE_ZOOM_RANGE.minZ;
    z <= DEFAULT_INVENTORY_TILE_ZOOM_RANGE.maxZ;
    z += 1
  ) {
    const { x, y } = latLngToTileXY(lat, lng, z);
    keys.add(formatTileKey(z, x, y));
    if (z === 13 || z === 14) {
      for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1]) {
          const n = 2 ** z;
          keys.add(formatTileKey(z, Math.max(0, Math.min(n - 1, x + dx)), Math.max(0, Math.min(n - 1, y + dy))));
        }
      }
    }
  }
  const bbox = {
    minLat: lat - 0.02,
    maxLat: lat + 0.02,
    minLng: lng - 0.02,
    maxLng: lng + 0.02,
  };
  for (const tile of tilesForViewport(bbox, 13)) {
    keys.add(tile.tileKey);
  }
  return [...keys];
}

function itemKindMatches(
  item: UnexploredTile["items"][number],
  itemType?: "unexploredSpot" | "unexploredRoute",
): boolean {
  if (!itemType) return true;
  if (itemType === "unexploredRoute") return item.kind === "unexplored_route";
  return item.kind !== "unexplored_route";
}

function findItemInTiles(
  tiles: UnexploredTile[],
  id: string,
  itemType?: "unexploredSpot" | "unexploredRoute",
): UnexploredTile["items"][number] | null {
  for (const tile of tiles) {
    for (const item of tile.items ?? []) {
      if (item.id !== id) continue;
      if (!itemKindMatches(item, itemType)) continue;
      return item;
    }
  }
  return null;
}

function tileItemToSpotDoc(item: UnexploredTile["items"][number]): Record<string, unknown> {
  const lat = Number(item.lat ?? item.center?.lat);
  const lng = Number(item.lng ?? item.center?.lng);
  const displayName = item.displayName ?? item.id;
  const category = item.category ?? "place";
  const activities = Array.isArray(item.activities) ? item.activities : [];
  return {
    id: item.id,
    kind: "unexplored_spot",
    itemType: "undiscovered_spot",
    sourceCollection: "unexploredSpots",
    displayName,
    title: displayName,
    primaryActivity: item.primaryActivity ?? activities[0] ?? null,
    activities,
    lat,
    lng,
    location: { lat, lng },
    category,
    categories: category ? [category] : [],
    sourceFamily: item.sourceFamily ?? "openstreetmap",
    mapReadiness: item.mapReadiness ?? "ready",
    publicMapEligible: true,
    displayPriority: item.displayPriority ?? "standard",
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
  };
}

function tileItemToRouteDoc(item: UnexploredTile["items"][number]): Record<string, unknown> {
  const lat = Number(item.lat ?? item.center?.lat);
  const lng = Number(item.lng ?? item.center?.lng);
  const displayName = item.displayName ?? item.id;
  const category = item.category ?? "trail";
  const activities = Array.isArray(item.activities) ? item.activities : [];
  return {
    id: item.id,
    kind: "unexplored_route",
    itemType: "undiscovered_route",
    sourceCollection: "unexploredRoutes",
    displayName,
    title: displayName,
    primaryActivity: item.primaryActivity ?? activities[0] ?? null,
    activities,
    lat,
    lng,
    center: { lat, lng },
    location: { lat, lng },
    category,
    categories: category ? [category] : [],
    sourceFamily: item.sourceFamily ?? "openstreetmap",
    mapReadiness: item.mapReadiness ?? "ready",
    publicMapEligible: true,
    displayPriority: item.displayPriority ?? "standard",
    encodedPolyline: item.encodedPolyline ?? null,
    bbox: item.bbox ?? null,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    isRoute: true,
  };
}

function tileItemToDoc(
  item: UnexploredTile["items"][number],
  itemType: "unexploredSpot" | "unexploredRoute",
): Record<string, unknown> {
  return itemType === "unexploredRoute" ? tileItemToRouteDoc(item) : tileItemToSpotDoc(item);
}

/**
 * Resolve a claimable unexplored item by id using the same sources as map markers:
 * direct Firestore doc → unexploredTiles → tile-index spot/route queries.
 */
export async function resolveUnexploredItemById(input: {
  id: string;
  lat?: number;
  lng?: number;
  sourceCollection?: "unexploredSpots" | "unexploredRoutes";
  itemType?: "unexploredSpot" | "unexploredRoute";
}): Promise<ResolvedUnexploredItem | null> {
  const id = String(input.id ?? "").trim();
  if (!id) return null;

  let itemType = input.itemType;
  let sourceCollection = input.sourceCollection;
  if (!itemType || !sourceCollection) {
    if (id.startsWith("unx_route_")) {
      itemType = "unexploredRoute";
      sourceCollection = "unexploredRoutes";
    } else {
      itemType = itemType ?? "unexploredSpot";
      sourceCollection = sourceCollection ?? "unexploredSpots";
    }
  }

  if (itemType === "unexploredRoute" || sourceCollection === "unexploredRoutes") {
    const doc = await getUnexploredRouteById(id);
    if (doc) {
      return {
        id,
        sourceCollection: "unexploredRoutes",
        itemType: "unexploredRoute",
        doc,
        resolvedFrom: "firestore_doc",
      };
    }
  } else {
    const doc = await getUnexploredSpotById(id);
    if (doc) {
      return {
        id,
        sourceCollection: "unexploredSpots",
        itemType: "unexploredSpot",
        doc,
        resolvedFrom: "firestore_doc",
      };
    }
  }

  if (input.lat == null || input.lng == null || !Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    return null;
  }

  const tileKeys = tileKeysAroundLatLng(input.lat, input.lng);
  const tiles = await getUnexploredTilesByKeys(tileKeys);
  const tileItem = findItemInTiles(tiles, id, itemType);
  if (tileItem) {
    return {
      id,
      sourceCollection: itemType === "unexploredRoute" ? "unexploredRoutes" : "unexploredSpots",
      itemType: itemType ?? "unexploredSpot",
      doc: tileItemToDoc(tileItem, itemType ?? "unexploredSpot"),
      resolvedFrom: "tile_doc",
    };
  }

  for (const tileKey of tileKeys.slice(0, 24)) {
    if (itemType === "unexploredRoute") {
      const routes = await queryUnexploredRoutesByTileKey(tileKey, 200);
      const match = routes.find((row) => String(row.id ?? "") === id);
      if (match) {
        return {
          id,
          sourceCollection: "unexploredRoutes",
          itemType: "unexploredRoute",
          doc: match,
          resolvedFrom: "tile_index",
        };
      }
    } else {
      const spots = await queryUnexploredSpotsByTileKey(tileKey, 200);
      const match = spots.find((row) => String(row.id ?? "") === id);
      if (match) {
        return {
          id,
          sourceCollection: "unexploredSpots",
          itemType: "unexploredSpot",
          doc: match,
          resolvedFrom: "tile_index",
        };
      }
    }
  }

  return null;
}

export function buildMaterializedUnexploredDoc(resolved: ResolvedUnexploredItem): Record<string, unknown> {
  if (resolved.resolvedFrom === "firestore_doc") return resolved.doc;
  return resolved.doc;
}
