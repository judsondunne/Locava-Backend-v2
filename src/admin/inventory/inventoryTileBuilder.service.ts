import type {
  InventoryRoute,
  InventorySpot,
  InventoryTileBuildResult,
  InventoryTilePayload,
} from "../../contracts/entities/inventory-entities.contract.js";
import type { InventoryCommitTarget } from "../../contracts/entities/inventory-entities.contract.js";
import { buildInventoryTileVersion } from "../../lib/inventory/inventoryIds.js";
import { bboxIntersects } from "../../lib/inventory/inventoryBbox.js";
import {
  DEFAULT_INVENTORY_TILE_ZOOM_RANGE,
  DEFAULT_MAX_ITEMS_PER_TILE,
  formatTileKey,
  latLngToTileXY,
  tilesForBboxAtZoom,
} from "../../lib/inventory/inventoryTileGrid.js";
import { bulkWriteInventoryTiles } from "../../repositories/source-of-truth/inventory-tiles-firestore.adapter.js";
import {
  getInventoryRunArtifacts,
  getInventoryRunMemory,
  setInventoryRunTilePreview,
  updateInventoryRunMemory,
} from "./inventoryImportRunStore.js";

export type InventoryTileBuildInput = {
  runId: string;
  dryRun?: boolean;
  commitTarget?: InventoryCommitTarget;
  minZoom?: number;
  maxZoom?: number;
  confirmProductionWrite?: string;
};

function toTileSpotSummary(spot: InventorySpot): InventoryTilePayload["spots"][number] {
  return {
    id: spot.id,
    kind: "inventory_spot",
    name: spot.name,
    category: spot.category,
    categories: spot.categories,
    activities: spot.activities,
    lat: spot.lat,
    lng: spot.lng,
    qualityScore: spot.qualityScore,
    hasMedia: false,
  };
}

function toTileRouteSummary(route: InventoryRoute): InventoryTilePayload["routes"][number] {
  return {
    id: route.id,
    kind: "inventory_route",
    name: route.name,
    activity: route.activity,
    categories: route.categories,
    activities: route.activities,
    center: route.center,
    bbox: route.bbox,
    distanceMeters: route.distanceMeters,
    encodedPolyline: route.encodedPolyline,
    qualityScore: route.qualityScore,
    hasMedia: false,
  };
}

function trimTilePayload(tile: InventoryTilePayload): InventoryTilePayload {
  return {
    ...tile,
    spots: [...tile.spots]
      .sort((a, b) => b.qualityScore - a.qualityScore || a.id.localeCompare(b.id))
      .slice(0, DEFAULT_MAX_ITEMS_PER_TILE),
    routes: [...tile.routes]
      .sort((a, b) => b.qualityScore - a.qualityScore || a.id.localeCompare(b.id))
      .slice(0, DEFAULT_MAX_ITEMS_PER_TILE),
  };
}

export function buildInventoryTilesFromRecords(input: {
  runId: string;
  spots: InventorySpot[];
  routes: InventoryRoute[];
  regionBbox: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  minZoom?: number;
  maxZoom?: number;
  generatedAt?: string;
}): InventoryTilePayload[] {
  const minZ = input.minZoom ?? DEFAULT_INVENTORY_TILE_ZOOM_RANGE.minZ;
  const maxZ = input.maxZoom ?? DEFAULT_INVENTORY_TILE_ZOOM_RANGE.maxZ;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const version = buildInventoryTileVersion(input.runId, generatedAt);
  const tileMap = new Map<string, InventoryTilePayload>();

  for (let z = minZ; z <= maxZ; z += 1) {
    for (const tile of tilesForBboxAtZoom(input.regionBbox, z)) {
      tileMap.set(tile.tileKey, {
        tileKey: tile.tileKey,
        z: tile.z,
        x: tile.x,
        y: tile.y,
        version,
        generatedAt,
        spots: [],
        routes: [],
      });
    }
  }

  for (const spot of input.spots) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const { x, y } = latLngToTileXY(spot.lat, spot.lng, z);
      const tileKey = formatTileKey(z, x, y);
      const tile = tileMap.get(tileKey);
      if (!tile) continue;
      tile.spots.push(toTileSpotSummary(spot));
    }
  }

  for (const route of input.routes) {
    if (!bboxIntersects(route.bbox, input.regionBbox)) continue;
    for (let z = minZ; z <= maxZ; z += 1) {
      for (const tile of tilesForBboxAtZoom(route.bbox, z)) {
        const payload = tileMap.get(tile.tileKey);
        if (!payload) continue;
        payload.routes.push(toTileRouteSummary(route));
      }
    }
  }

  const finalized: InventoryTilePayload[] = [];
  for (const tile of tileMap.values()) {
    const trimmed = trimTilePayload(tile);
    if (trimmed.spots.length > 0 || trimmed.routes.length > 0) {
      finalized.push(trimmed);
    }
  }

  return finalized.sort((a, b) => a.tileKey.localeCompare(b.tileKey));
}

export async function buildInventoryTilesForRun(input: InventoryTileBuildInput): Promise<InventoryTileBuildResult> {
  const run = getInventoryRunMemory(input.runId);
  if (!run) throw new Error(`run_not_found:${input.runId}`);
  const artifacts = getInventoryRunArtifacts(input.runId);
  if (!artifacts) throw new Error(`run_artifacts_not_found:${input.runId}`);

  updateInventoryRunMemory(input.runId, { status: "tile_build_running" });

  const tiles = buildInventoryTilesFromRecords({
    runId: input.runId,
    spots: artifacts.stagedSpots,
    routes: artifacts.stagedRoutes,
    regionBbox: run.bbox,
    minZoom: input.minZoom,
    maxZoom: input.maxZoom,
  });

  const dryRun = input.dryRun !== false;
  const commitTarget = input.commitTarget ?? (dryRun ? "none" : "emulator");
  let tileWrites = 0;

  if (!dryRun) {
    tileWrites = await bulkWriteInventoryTiles(tiles, {
      commitTarget,
      operation: "inventory.build_tiles",
      confirmProductionWrite: input.confirmProductionWrite,
    });
  }

  setInventoryRunTilePreview(input.runId, tiles.slice(0, 20));
  updateInventoryRunMemory(input.runId, {
    status: dryRun ? "dry_run_complete" : "tiles_built",
    tilesBuiltAt: new Date().toISOString(),
    counts: {
      ...run.counts,
      tilesGenerated: tiles.length,
      firestoreTileWrites: tileWrites,
    },
  });

  return {
    runId: input.runId,
    tilesGenerated: tiles.length,
    tileWrites,
    dryRun,
    tiles: tiles.slice(0, 50),
    zoomRange: {
      minZ: input.minZoom ?? DEFAULT_INVENTORY_TILE_ZOOM_RANGE.minZ,
      maxZ: input.maxZoom ?? DEFAULT_INVENTORY_TILE_ZOOM_RANGE.maxZ,
    },
  };
}
