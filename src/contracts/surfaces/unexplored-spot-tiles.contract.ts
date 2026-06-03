import { z } from "zod";
import { defineContract } from "../conventions.js";

export const UnexploredSpotTileMarkerSchema = z.object({
  id: z.string(),
  lat: z.number(),
  lng: z.number(),
  title: z.string().optional(),
  firstActivity: z.string().nullable().optional(),
  emoji: z.string().nullable().optional(),
  iconKey: z.string().nullable().optional(),
  activity: z.string().nullable().optional(),
  sourceCollection: z.literal("unexploredSpots"),
  itemType: z.literal("unexploredSpot"),
  markerPriority: z.string().nullable().optional(),
  rank: z.number().optional(),
});

export const UnexploredSpotTileResponseSchema = z.object({
  routeName: z.literal("map.unexplored_spots.tile.get"),
  tileKey: z.string(),
  z: z.number().int().nonnegative(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  spots: z.array(UnexploredSpotTileMarkerSchema),
  count: z.number().int().nonnegative(),
  generatedAt: z.number().int().nonnegative(),
  version: z.string(),
  etag: z.string(),
  diagnostics: z.object({
    cacheHit: z.boolean(),
    cacheSource: z.enum(["hit", "miss", "revalidated_304"]),
    payloadBytes: z.number().int().nonnegative(),
    fetchMs: z.number().int().nonnegative(),
    dbReads: z.number().int().nonnegative(),
    source: z.enum(["tile_doc", "spot_index", "empty"]),
    capped: z.boolean(),
    tileLimit: z.number().int().nonnegative(),
  }),
});

export const unexploredSpotTilesContract = defineContract({
  routeName: "map.unexplored_spots.tile.get",
  method: "GET",
  path: "/v2/map/unexplored-spots/tile",
  query: z.object({
    z: z.coerce.number().int().min(10).max(15),
    x: z.coerce.number().int().min(0),
    y: z.coerce.number().int().min(0),
  }),
  body: z.object({}).strict(),
  response: UnexploredSpotTileResponseSchema,
});

export const UnexploredSpotTilesBatchResponseSchema = z.object({
  routeName: z.literal("map.unexplored_spots.tiles.get"),
  tiles: z.array(UnexploredSpotTileResponseSchema.omit({ routeName: true }).extend({
    routeName: z.literal("map.unexplored_spots.tile.get").optional(),
  })),
  count: z.number().int().nonnegative(),
  generatedAt: z.number().int().nonnegative(),
  version: z.string(),
  etag: z.string(),
  diagnostics: z.object({
    cacheHits: z.number().int().nonnegative(),
    cacheMisses: z.number().int().nonnegative(),
    payloadBytes: z.number().int().nonnegative(),
    fetchMs: z.number().int().nonnegative(),
  }),
});

export const unexploredSpotTilesBatchContract = defineContract({
  routeName: "map.unexplored_spots.tiles.get",
  method: "GET",
  path: "/v2/map/unexplored-spots/tiles",
  query: z.object({
    tiles: z
      .string()
      .min(3)
      .max(4096)
      .regex(/^[0-9]+\/[0-9]+\/[0-9]+(,[0-9]+\/[0-9]+\/[0-9]+)*$/),
  }),
  body: z.object({}).strict(),
  response: UnexploredSpotTilesBatchResponseSchema,
});

export type UnexploredSpotTileResponse = z.infer<typeof UnexploredSpotTileResponseSchema>;
