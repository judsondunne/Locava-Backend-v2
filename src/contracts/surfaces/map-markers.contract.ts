import { z } from "zod";
import { defineContract } from "../conventions.js";
import { MAP_MARKERS_MIN_DOCS } from "../../lib/map/map-marker-budgets.js";

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
    docsScanned: z.number().int().nonnegative(),
    estimatedReads: z.number().int().nonnegative(),
    payloadBytes: z.number().int().nonnegative(),
    invalidCoordinateDrops: z.number().int().nonnegative(),
    cacheSource: z.enum(["miss", "hit", "revalidated_304"]),
    payloadMode: z.enum(["full", "compact"]).optional(),
    requestedLimit: z.number().int().nullable(),
    effectiveLimit: z.number().int().nonnegative(),
    candidateLimit: z.number().int().nonnegative(),
    ownerScoped: z.boolean(),
    boundsApplied: z.boolean(),
    hardCapApplied: z.boolean(),
    sourceQueryMode: z.string().nullable().optional(),
    degradedReason: z.string().nullable().optional(),
    /** Optional diagnostics — safe for logs; omit when unknown. */
    bboxKey: z.string().nullable().optional(),
    pageCount: z.number().int().nonnegative().optional(),
    nextCursor: z.string().nullable().optional(),
    totalEligibleEstimate: z.number().nullable().optional(),
    droppedMissingCoords: z.number().int().nonnegative().optional(),
    droppedNoMedia: z.number().int().nonnegative().optional(),
    droppedNoOpenPayload: z.number().int().nonnegative().optional(),
    droppedByPolicy: z.number().int().nonnegative().optional(),
    returnedMarkerCount: z.number().int().nonnegative().optional(),
    bboxArea: z.number().nullable().optional(),
    zoomBucket: z.string().nullable().optional(),
    bboxClamped: z.boolean().optional(),
    hasMore: z.boolean().optional()
  })
});

export const mapMarkersContract = defineContract({
  routeName: "map.markers.get",
  method: "GET",
  path: "/v2/map/markers",
  query: z.object({
    limit: z.coerce.number().int().min(MAP_MARKERS_MIN_DOCS).max(10_000).optional(),
    /**
     * Optional owner filter used by profile/other-user minimaps.
     * When present, the backend performs server-side filtering so older posts
     * aren't dropped by the global "latest N posts" universe slice.
     */
    ownerId: z.string().min(1).optional()
    ,
    payloadMode: z.enum(["full", "compact"]).default("compact"),
    bbox: z
      .string()
      .regex(
        /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/,
        "bbox must be minLng,minLat,maxLng,maxLat"
      )
      .optional(),
    /** When true, markers omit synthetic `openPayload` (native hydrates on tap via real-post batch). */
    markerIndexOnly: z.coerce.boolean().optional().default(false),
  }),
  body: z.object({}).strict(),
  response: MapMarkersResponseSchema
});

export type MapMarkersResponse = z.infer<typeof MapMarkersResponseSchema>;
