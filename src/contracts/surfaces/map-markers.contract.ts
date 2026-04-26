import { z } from "zod";
import { defineContract } from "../conventions.js";

export const MapMarkerRecordSchema = z.object({
  id: z.string(),
  postId: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  activity: z.string().nullable().optional(),
  activities: z.array(z.string()).default([]),
  createdAt: z.number().int().nullable().optional(),
  visibility: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  hasPhoto: z.boolean().optional(),
  hasVideo: z.boolean().optional()
});

export const MapMarkersResponseSchema = z.object({
  routeName: z.literal("map.markers.get"),
  markers: z.array(MapMarkerRecordSchema),
  count: z.number().int().nonnegative(),
  generatedAt: z.number().int().nonnegative(),
  version: z.string(),
  etag: z.string(),
  diagnostics: z.object({
    queryCount: z.number().int().nonnegative(),
    readCount: z.number().int().nonnegative(),
    payloadBytes: z.number().int().nonnegative(),
    invalidCoordinateDrops: z.number().int().nonnegative(),
    cacheSource: z.enum(["miss", "hit", "revalidated_304"])
  })
});

export const mapMarkersContract = defineContract({
  routeName: "map.markers.get",
  method: "GET",
  path: "/v2/map/markers",
  query: z.object({
    limit: z.coerce.number().int().min(20).max(400).optional()
  }),
  body: z.object({}).strict(),
  response: MapMarkersResponseSchema
});

export type MapMarkersResponse = z.infer<typeof MapMarkersResponseSchema>;
