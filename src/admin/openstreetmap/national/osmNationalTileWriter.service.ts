import type {
  OsmNationalRun,
  UnexploredRoute,
  UnexploredSpot,
  UnexploredTile,
} from "../../../contracts/entities/osm-national-entities.contract.js";
import { bboxIntersects } from "../../../lib/inventory/inventoryBbox.js";
import {
  DEFAULT_INVENTORY_TILE_ZOOM_RANGE,
  DEFAULT_MAX_ITEMS_PER_TILE,
  formatTileKey,
  latLngToTileXY,
  tilesForBboxAtZoom,
} from "../../../lib/inventory/inventoryTileGrid.js";
import { buildInventoryTileVersion } from "../../../lib/inventory/inventoryIds.js";
import { bulkWriteUnexploredTiles } from "../../../repositories/source-of-truth/unexplored-tiles-firestore.adapter.js";
import type { OsmNationalWriteOptions } from "../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";

function toTileItemFromSpot(spot: UnexploredSpot): UnexploredTile["items"][number] {
  return {
    id: spot.id,
    kind: "unexplored_spot",
    displayName: spot.displayName,
    primaryActivity: spot.primaryActivity,
    activities: spot.activities,
    lat: spot.lat,
    lng: spot.lng,
    category: spot.category,
    displayPriority: spot.displayPriority,
    sourceFamily: spot.sourceFamily,
    hasParking: Boolean((spot.parking as { hasParking?: boolean } | undefined)?.hasParking),
    mapReadiness: spot.mapReadiness,
  };
}

function toTileItemFromRoute(route: UnexploredRoute): UnexploredTile["items"][number] {
  return {
    id: route.id,
    kind: "unexplored_route",
    displayName: route.displayName,
    primaryActivity: route.primaryActivity,
    activities: route.activities,
    center: route.center,
    bbox: route.bbox,
    encodedPolyline: route.encodedPolyline?.slice(0, 500),
    category: route.category,
    displayPriority: route.displayPriority,
    sourceFamily: route.sourceFamily,
    mapReadiness: route.mapReadiness,
  };
}

export function buildUnexploredTilesFromDocs(input: {
  runId: string;
  spots: UnexploredSpot[];
  routes: UnexploredRoute[];
  regionBbox: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  publicOnly: boolean;
  includeReviewItems: boolean;
  minZoom?: number;
  maxZoom?: number;
}): UnexploredTile[] {
  const minZ = input.minZoom ?? DEFAULT_INVENTORY_TILE_ZOOM_RANGE.minZ;
  const maxZ = input.maxZoom ?? DEFAULT_INVENTORY_TILE_ZOOM_RANGE.maxZ;
  const generatedAt = new Date().toISOString();
  const version = buildInventoryTileVersion(input.runId, generatedAt);
  const tileMap = new Map<string, UnexploredTile>();

  for (let z = minZ; z <= maxZ; z += 1) {
    for (const tile of tilesForBboxAtZoom(input.regionBbox, z)) {
      tileMap.set(tile.tileKey, {
        tileKey: tile.tileKey,
        z: tile.z,
        x: tile.x,
        y: tile.y,
        version,
        generatedAt,
        runId: input.runId,
        items: [],
      });
    }
  }

  const eligibleSpots = input.spots.filter((s) => {
    if (input.publicOnly && !s.publicMapEligible) return false;
    if (input.publicOnly && !input.includeReviewItems && s.mapReadiness === "review") return false;
    return true;
  });
  const eligibleRoutes = input.routes.filter((r) => {
    if (input.publicOnly && !r.publicMapEligible) return false;
    if (input.publicOnly && !input.includeReviewItems && r.mapReadiness === "review") return false;
    return true;
  });

  for (const spot of eligibleSpots) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const { x, y } = latLngToTileXY(spot.lat, spot.lng, z);
      const tileKey = formatTileKey(z, x, y);
      const tile = tileMap.get(tileKey);
      if (!tile) continue;
      tile.items.push(toTileItemFromSpot(spot));
    }
  }

  for (const route of eligibleRoutes) {
    if (!bboxIntersects(route.bbox, input.regionBbox)) continue;
    for (let z = minZ; z <= maxZ; z += 1) {
      for (const tile of tilesForBboxAtZoom(route.bbox, z)) {
        const payload = tileMap.get(tile.tileKey);
        if (!payload) continue;
        payload.items.push(toTileItemFromRoute(route));
      }
    }
  }

  return [...tileMap.values()].map((tile) => ({
    ...tile,
    items: [...tile.items]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, DEFAULT_MAX_ITEMS_PER_TILE),
  }));
}

export async function writeUnexploredTilesForChunk(input: {
  run: OsmNationalRun;
  spots: UnexploredSpot[];
  routes: UnexploredRoute[];
  chunkBbox: { minLat: number; minLng: number; maxLat: number; maxLng: number };
}): Promise<number> {
  if (input.run.config.tileBuildMode === "none") return 0;
  if (!input.run.writeMode || input.run.config.dryRunOnly) return 0;
  if (input.run.config.tileBuildMode === "after_run") return 0;

  const tiles = buildUnexploredTilesFromDocs({
    runId: input.run.runId,
    spots: input.spots,
    routes: input.routes,
    regionBbox: input.chunkBbox,
    publicOnly: input.run.config.includePublicOnly,
    includeReviewItems: input.run.config.includeReviewItems,
  });

  const writeOptions: OsmNationalWriteOptions = {
    writeTarget: input.run.writeTarget,
    operation: "writeUnexploredTilesForChunk",
    confirmProductionWrite: input.run.confirmProductionWrite,
  };

  return bulkWriteUnexploredTiles(tiles, writeOptions);
}
