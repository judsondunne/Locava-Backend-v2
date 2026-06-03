import { z } from "zod";
import { defineContract } from "../conventions.js";

export const UnexploredRouteTileMarkerSchema = z.object({
  id: z.string(),
  lat: z.number(),
  lng: z.number(),
  title: z.string().optional(),
  firstActivity: z.string().nullable().optional(),
  emoji: z.string().nullable().optional(),
  iconKey: z.string().nullable().optional(),
  activity: z.string().nullable().optional(),
  sourceCollection: z.literal("unexploredRoutes"),
  itemType: z.literal("unexploredRoute"),
  markerPriority: z.string().nullable().optional(),
  rank: z.number().optional(),
  routeSummary: z.record(z.unknown()).nullable().optional(),
});

export const UnexploredRouteTileResponseSchema = z.object({
  routeName: z.literal("map.unexplored_routes.tile.get"),
  tileKey: z.string(),
  z: z.number().int().nonnegative(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  routes: z.array(UnexploredRouteTileMarkerSchema),
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
    source: z.enum(["tile_doc", "route_index", "empty"]),
    capped: z.boolean(),
    tileLimit: z.number().int().nonnegative(),
  }),
});

export const unexploredRouteTilesContract = defineContract({
  routeName: "map.unexplored_routes.tile.get",
  method: "GET",
  path: "/v2/map/unexplored-routes/tile",
  query: z.object({
    z: z.coerce.number().int().min(10).max(15),
    x: z.coerce.number().int().min(0),
    y: z.coerce.number().int().min(0),
  }),
  body: z.object({}).strict(),
  response: UnexploredRouteTileResponseSchema,
});

export const UnexploredRouteTilesBatchResponseSchema = z.object({
  routeName: z.literal("map.unexplored_routes.tiles.get"),
  tiles: z.array(UnexploredRouteTileResponseSchema.omit({ routeName: true }).extend({
    routeName: z.literal("map.unexplored_routes.tile.get").optional(),
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

export const unexploredRouteTilesBatchContract = defineContract({
  routeName: "map.unexplored_routes.tiles.get",
  method: "GET",
  path: "/v2/map/unexplored-routes/tiles",
  query: z.object({
    tiles: z
      .string()
      .min(3)
      .max(4096)
      .regex(/^[0-9]+\/[0-9]+\/[0-9]+(,[0-9]+\/[0-9]+\/[0-9]+)*$/),
  }),
  body: z.object({}).strict(),
  response: UnexploredRouteTilesBatchResponseSchema,
});

export type UnexploredRouteTileResponse = z.infer<typeof UnexploredRouteTileResponseSchema>;
