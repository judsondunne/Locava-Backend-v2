import type { UnexploredRoute, UnexploredTile } from "../../contracts/entities/osm-national-entities.contract.js";
import { buildInventoryTileVersion } from "../../lib/inventory/inventoryIds.js";
import {
  DEFAULT_INVENTORY_TILE_ZOOM_RANGE,
  DEFAULT_MAX_ITEMS_PER_TILE,
  formatTileKey,
  latLngToTileXY,
  tilesForBboxAtZoom,
} from "../../lib/inventory/inventoryTileGrid.js";
import { attachRouteMapTileIndex } from "../../lib/map/unexploredRouteTileIndex.js";
import { rankRouteForTile } from "../../lib/map/unexploredRouteTileZoom.js";
import { bulkWriteUnexploredRoutes } from "../../repositories/source-of-truth/unexplored-routes-firestore.adapter.js";
import { bulkWriteUnexploredTiles } from "../../repositories/source-of-truth/unexplored-tiles-firestore.adapter.js";
import { getUnexploredTilesByKeys } from "../../repositories/source-of-truth/unexplored-read-firestore.adapter.js";
import type { OsmNationalWriteOptions } from "../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";

const TILE_POLYLINE_CAP = 500;

function toTileItemFromRoute(route: UnexploredRoute): UnexploredTile["items"][number] {
  const encoded =
    typeof route.encodedPolyline === "string" && route.encodedPolyline.trim()
      ? route.encodedPolyline.trim().slice(0, TILE_POLYLINE_CAP)
      : typeof route.geometry?.encodedPolyline === "string"
        ? route.geometry.encodedPolyline.trim().slice(0, TILE_POLYLINE_CAP)
        : undefined;
  return {
    id: route.id,
    kind: "unexplored_route",
    displayName: route.displayName,
    primaryActivity: route.primaryActivity,
    activities: route.activities,
    center: route.center,
    bbox: route.bbox,
    encodedPolyline: encoded,
    category: route.category,
    displayPriority: route.displayPriority,
    sourceFamily: route.sourceFamily,
    mapReadiness: route.mapReadiness,
  };
}

function routeTileKeysForRoute(route: UnexploredRoute): string[] {
  if (Array.isArray(route.mapTileKeys) && route.mapTileKeys.length > 0) {
    return route.mapTileKeys.filter((k): k is string => typeof k === "string" && k.includes("/"));
  }
  const keys = new Set<string>();
  const bbox = route.bbox;
  if (
    bbox &&
    Number.isFinite(bbox.minLat) &&
    Number.isFinite(bbox.minLng) &&
    Number.isFinite(bbox.maxLat) &&
    Number.isFinite(bbox.maxLng)
  ) {
    for (
      let z = DEFAULT_INVENTORY_TILE_ZOOM_RANGE.minZ;
      z <= DEFAULT_INVENTORY_TILE_ZOOM_RANGE.maxZ;
      z += 1
    ) {
      for (const tile of tilesForBboxAtZoom(bbox, z)) keys.add(tile.tileKey);
    }
  } else {
    for (
      let z = DEFAULT_INVENTORY_TILE_ZOOM_RANGE.minZ;
      z <= DEFAULT_INVENTORY_TILE_ZOOM_RANGE.maxZ;
      z += 1
    ) {
      const { x, y } = latLngToTileXY(route.center.lat, route.center.lng, z);
      keys.add(formatTileKey(z, x, y));
    }
  }
  return [...keys];
}

export function indexUnexploredRoutesForTiles(routes: UnexploredRoute[]): UnexploredRoute[] {
  return routes.map((route) => attachRouteMapTileIndex(route));
}

export async function upsertUnexploredRoutesIntoTileDocs(input: {
  routes: UnexploredRoute[];
  runId: string;
  writeOptions: OsmNationalWriteOptions;
}): Promise<number> {
  if (input.routes.length === 0) return 0;
  const indexed = indexUnexploredRoutesForTiles(input.routes);
  const tileKeys = [...new Set(indexed.flatMap((r) => routeTileKeysForRoute(r)))];
  const existing = await getUnexploredTilesByKeys(tileKeys);
  const existingByKey = new Map(existing.map((t) => [t.tileKey, t]));
  const generatedAt = new Date().toISOString();
  const version = buildInventoryTileVersion(input.runId, generatedAt);
  const out: UnexploredTile[] = [];

  for (const tileKey of tileKeys) {
    const parts = tileKey.split("/").map(Number);
    const z = parts[0];
    const x = parts[1];
    const y = parts[2];
    if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const tileZ = z as number;
    const tileX = x as number;
    const tileY = y as number;
    const current =
      existingByKey.get(tileKey) ??
      ({
        tileKey,
        z: tileZ,
        x: tileX,
        y: tileY,
        version,
        generatedAt,
        runId: input.runId,
        items: [],
      } satisfies UnexploredTile);

    const byId = new Map(current.items.map((item) => [item.id, item]));
    for (const route of indexed) {
      if (!routeTileKeysForRoute(route).includes(tileKey)) continue;
      byId.set(route.id, toTileItemFromRoute(route));
    }
    const mergedItems = [...byId.values()].sort(
      (a, b) =>
        rankRouteForTile({
          displayPriority: b.displayPriority ?? null,
          displayName: b.displayName,
          id: b.id,
        }) -
          rankRouteForTile({
            displayPriority: a.displayPriority ?? null,
            displayName: a.displayName,
            id: a.id,
          }) ||
        a.displayName.localeCompare(b.displayName),
    );
    out.push({
      ...current,
      version,
      generatedAt,
      runId: input.runId,
      items: mergedItems.slice(0, DEFAULT_MAX_ITEMS_PER_TILE),
    });
  }

  if (out.length === 0) return 0;
  return bulkWriteUnexploredTiles(out, {
    ...input.writeOptions,
    operation: input.writeOptions.operation ?? "upsertUnexploredRoutesIntoTileDocs",
  });
}

export async function writeUnexploredRoutesWithTileIndex(input: {
  routes: UnexploredRoute[];
  runId: string;
  writeOptions: OsmNationalWriteOptions;
}): Promise<{ routesWritten: number; tilesWritten: number }> {
  const indexed = indexUnexploredRoutesForTiles(input.routes);
  const routesWritten = await bulkWriteUnexploredRoutes(indexed, input.writeOptions);
  const tilesWritten = await upsertUnexploredRoutesIntoTileDocs({
    routes: indexed,
    runId: input.runId,
    writeOptions: input.writeOptions,
  });
  return { routesWritten, tilesWritten };
}
