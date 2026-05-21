import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { inventoryTilesContract } from "../../contracts/surfaces/inventory-tiles.contract.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { getInventoryTilesByKeys } from "../../repositories/source-of-truth/inventory-tiles-firestore.adapter.js";
import { tilesForViewport } from "../../lib/inventory/inventoryTileGrid.js";

function parseBounds(rawBbox: string | undefined): {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
} | null {
  if (typeof rawBbox !== "string" || rawBbox.trim().length === 0) return null;
  const parts = rawBbox.split(",").map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
  if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 || minLng >= maxLng || minLat >= maxLat) {
    return null;
  }
  return { minLng, minLat, maxLng, maxLat };
}

export async function registerV2InventoryTilesRoutes(app: FastifyInstance): Promise<void> {
  app.get(inventoryTilesContract.path, async (request, reply) => {
    setRouteName(inventoryTilesContract.routeName);
    buildViewerContext(request);
    const query = inventoryTilesContract.query.parse(request.query);

    let tileKeys: string[] = [];
    if (query.z != null && query.x != null && query.y != null) {
      tileKeys = [`${query.z}/${query.x}/${query.y}`];
    } else if (query.bbox) {
      const bbox = parseBounds(query.bbox);
      if (!bbox) {
        return reply.status(400).send(failure("invalid_bbox", "bbox must be minLng,minLat,maxLng,maxLat"));
      }
      const zoom = query.zoom ?? 13;
      tileKeys = tilesForViewport(bbox, zoom).map((t) => t.tileKey);
    } else {
      return reply.status(400).send(failure("missing_tile_selector", "Provide bbox+zoom or z/x/y"));
    }

    const tiles = await getInventoryTilesByKeys(tileKeys);
    const generatedAt = new Date().toISOString();
    const payload = {
      routeName: "inventory.tiles.get" as const,
      tiles,
      count: tiles.length,
      generatedAt,
      version: tiles[0]?.version ?? "empty",
    };
    reply.header("Cache-Control", "public, max-age=60");
    return success(payload);
  });
}
