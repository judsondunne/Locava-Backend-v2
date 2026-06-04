import type { UnexploredSpot, UnexploredTile } from "../../contracts/entities/osm-national-entities.contract.js";
import { buildInventoryTileVersion } from "../../lib/inventory/inventoryIds.js";
import {
  DEFAULT_INVENTORY_TILE_ZOOM_RANGE,
  DEFAULT_MAX_ITEMS_PER_TILE,
  formatTileKey,
  latLngToTileXY,
} from "../../lib/inventory/inventoryTileGrid.js";
import { attachSpotMapTileIndex } from "../../lib/map/unexploredSpotTileIndex.js";
import { rankSpotForTile } from "../../lib/map/unexploredSpotTileZoom.js";
import { bulkWriteUnexploredSpots } from "../../repositories/source-of-truth/unexplored-spots-firestore.adapter.js";
import { bulkWriteUnexploredTiles } from "../../repositories/source-of-truth/unexplored-tiles-firestore.adapter.js";
import { getUnexploredTilesByKeys } from "../../repositories/source-of-truth/unexplored-read-firestore.adapter.js";
import type { OsmNationalWriteOptions } from "../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";

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

function spotTileKeysForSpot(spot: UnexploredSpot): string[] {
  if (Array.isArray(spot.mapTileKeys) && spot.mapTileKeys.length > 0) {
    return spot.mapTileKeys.filter((k): k is string => typeof k === "string" && k.includes("/"));
  }
  const keys: string[] = [];
  for (
    let z = DEFAULT_INVENTORY_TILE_ZOOM_RANGE.minZ;
    z <= DEFAULT_INVENTORY_TILE_ZOOM_RANGE.maxZ;
    z += 1
  ) {
    const { x, y } = latLngToTileXY(spot.lat, spot.lng, z);
    keys.push(formatTileKey(z, x, y));
  }
  return keys;
}

export function indexUnexploredSpotsForTiles(spots: UnexploredSpot[]): UnexploredSpot[] {
  return spots.map((spot) => attachSpotMapTileIndex(spot));
}

export async function upsertUnexploredSpotsIntoTileDocs(input: {
  spots: UnexploredSpot[];
  runId: string;
  writeOptions: OsmNationalWriteOptions;
}): Promise<number> {
  if (input.spots.length === 0) return 0;
  const indexed = indexUnexploredSpotsForTiles(input.spots);
  const tileKeys = [...new Set(indexed.flatMap((s) => spotTileKeysForSpot(s)))];
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
    for (const spot of indexed) {
      if (!spotTileKeysForSpot(spot).includes(tileKey)) continue;
      byId.set(spot.id, toTileItemFromSpot(spot));
    }
    const mergedItems = [...byId.values()].sort(
      (a, b) =>
        rankSpotForTile({
          displayPriority: b.displayPriority ?? null,
          displayName: b.displayName,
          id: b.id,
        }) -
          rankSpotForTile({
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
    operation: input.writeOptions.operation ?? "upsertUnexploredSpotsIntoTileDocs",
  });
}

export async function writeUnexploredSpotsWithTileIndex(input: {
  spots: UnexploredSpot[];
  runId: string;
  writeOptions: OsmNationalWriteOptions;
}): Promise<{ spotsWritten: number; tilesWritten: number }> {
  const indexed = indexUnexploredSpotsForTiles(input.spots);
  const spotsWritten = await bulkWriteUnexploredSpots(indexed, input.writeOptions);
  const tilesWritten = await upsertUnexploredSpotsIntoTileDocs({
    spots: indexed,
    runId: input.runId,
    writeOptions: input.writeOptions,
  });
  return { spotsWritten, tilesWritten };
}
