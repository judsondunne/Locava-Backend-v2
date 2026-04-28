import { z } from "zod";
import { defineContract } from "../conventions.js";
import { MapMarkerSummarySchema } from "../entities/map-entities.contract.js";

export const MapBootstrapQuerySchema = z.object({
  bbox: z
    .string()
    .regex(
      /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/,
      "bbox must be minLng,minLat,maxLng,maxLat"
    ),
  limit: z.coerce.number().int().min(20).max(5000).default(120)
});

export const MapBootstrapResponseSchema = z.object({
  routeName: z.literal("map.bootstrap.get"),
  requestKey: z.string(),
  query: z.object({
    bbox: z.object({
      minLng: z.number().min(-180).max(180),
      minLat: z.number().min(-90).max(90),
      maxLng: z.number().min(-180).max(180),
      maxLat: z.number().min(-90).max(90)
    }),
    limit: z.number().int().positive()
  }),
  page: z.object({
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    sort: z.literal("ts_desc")
  }),
  markers: z.array(MapMarkerSummarySchema),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const mapBootstrapContract = defineContract({
  routeName: "map.bootstrap.get",
  method: "GET",
  path: "/v2/map/bootstrap",
  query: MapBootstrapQuerySchema,
  body: z.object({}).strict(),
  response: MapBootstrapResponseSchema
});

export type MapBootstrapResponse = z.infer<typeof MapBootstrapResponseSchema>;
