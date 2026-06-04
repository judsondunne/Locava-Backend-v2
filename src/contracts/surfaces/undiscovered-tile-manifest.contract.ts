import { z } from "zod";

export const undiscoveredTileManifestContract = {
  routeName: "map.undiscovered_tiles.manifest.get" as const,
  path: "/v2/map/undiscovered-tiles/manifest",
};

export const undiscoveredTileManifestSchema = z.object({
  version: z.string(),
  minZoom: z.number().int(),
  maxZoom: z.number().int(),
  updatedAt: z.number(),
  regions: z.array(z.string()),
  tilePathFormat: z.string(),
  spotIndexFallbackEnabled: z.boolean().optional(),
  source: z.enum(["firestore_tile_docs", "storage_cdn"]).optional(),
});

export type UndiscoveredTileManifestWire = z.infer<typeof undiscoveredTileManifestSchema>;
