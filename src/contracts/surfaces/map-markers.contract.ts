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
  updatedAt: z.number().int().nullable().optional(),
  visibility: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  // Display config for native marker rendering (parity with old map index).
  thumbKey: z.string().nullable().optional(),
  followedUserPic: z.string().nullable().optional(),
  hasPhoto: z.boolean().optional(),
  hasVideo: z.boolean().optional(),
  openPayload: z.record(z.unknown()).nullable().optional(),
}).passthrough();

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
    cacheSource: z.enum(["miss", "hit", "revalidated_304"]),
    payloadMode: z.enum(["full", "compact"]).optional()
  })
});

export const mapMarkersContract = defineContract({
  routeName: "map.markers.get",
  method: "GET",
  path: "/v2/map/markers",
  query: z.object({
    limit: z.coerce.number().int().min(20).max(10_000).optional(),
    /**
     * Optional owner filter used by profile/other-user minimaps.
     * When present, the backend performs server-side filtering so older posts
     * aren't dropped by the global "latest N posts" universe slice.
     */
    ownerId: z.string().min(1).optional()
    ,
    payloadMode: z.enum(["full", "compact"]).default("compact")
  }),
  body: z.object({}).strict(),
  response: MapMarkersResponseSchema
});

export type MapMarkersResponse = z.infer<typeof MapMarkersResponseSchema>;
