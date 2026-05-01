import { z } from "zod";
import { defineContract } from "../conventions.js";

const MixFilterSchema = z
  .object({
    activity: z.string().trim().min(1).max(80).optional(),
    state: z.string().trim().min(1).max(80).optional(),
    place: z.string().trim().min(1).max(120).optional(),
    lat: z.coerce.number().finite().optional(),
    lng: z.coerce.number().finite().optional(),
    radiusKm: z.coerce.number().finite().positive().max(500).optional(),
  })
  .strict();

export const MixPreviewQuerySchema = MixFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(3).default(3),
  viewerId: z.string().trim().min(1).max(128).optional(),
});

export const MixPageQuerySchema = MixFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(24).default(12),
  cursor: z.string().trim().min(1).optional(),
  viewerId: z.string().trim().min(1).max(128).optional(),
});

export const MixPathParamsSchema = z.object({
  mixKey: z.string().trim().min(1).max(120),
});

const MixPostCardSchema = z.object({
  postId: z.string(),
  rankToken: z.string(),
  author: z.object({
    userId: z.string(),
    handle: z.string(),
    name: z.string().nullable(),
    pic: z.string().nullable(),
  }),
  title: z.string().nullable(),
  captionPreview: z.string().nullable(),
  activities: z.array(z.string()),
  locationSummary: z.string().nullable(),
  media: z.object({
    type: z.enum(["image", "video"]).optional(),
    posterUrl: z.string(),
    previewUrl: z.string().nullable().optional(),
    aspectRatio: z.number().positive().nullable().optional(),
    startupHint: z.enum(["poster_only", "poster_then_preview"]).optional(),
  }),
  assets: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum(["image", "video"]),
        previewUrl: z.string().nullable().optional(),
        posterUrl: z.string().nullable().optional(),
        originalUrl: z.string().nullable().optional(),
        streamUrl: z.string().nullable().optional(),
        mp4Url: z.string().nullable().optional(),
        width: z.number().nullable().optional(),
        height: z.number().nullable().optional(),
        aspectRatio: z.number().nullable().optional(),
      }),
    )
    .optional(),
  mediaStatus: z.enum(["processing", "ready", "failed"]).optional(),
  assetsReady: z.boolean().optional(),
  posterReady: z.boolean().optional(),
  playbackReady: z.boolean().optional(),
  playbackUrlPresent: z.boolean().optional(),
  playbackUrl: z.string().nullable().optional(),
  fallbackVideoUrl: z.string().nullable().optional(),
  posterUrl: z.string().nullable().optional(),
  hasVideo: z.boolean().optional(),
  aspectRatio: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  resizeMode: z.string().nullable().optional(),
  letterboxGradients: z
    .array(z.object({ top: z.string(), bottom: z.string() }))
    .nullable()
    .optional(),
  geo: z
    .object({
      lat: z.number().nullable(),
      lng: z.number().nullable(),
    })
    .optional(),
  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),
});

const MixDiagnosticsSchema = z.object({
  routeName: z.string(),
  mixKey: z.string(),
  filters: MixFilterSchema,
  candidateCount: z.number().int().nonnegative(),
  returnedCount: z.number().int().nonnegative(),
  source: z.string(),
  cacheHit: z.boolean(),
  latencyMs: z.number().nonnegative(),
  readCount: z.number().int().nonnegative(),
  poolLimit: z.number().int().positive().optional(),
  poolBuiltAt: z.string().nullable().optional(),
  poolBuildLatencyMs: z.number().nonnegative().optional(),
  poolBuildReadCount: z.number().int().nonnegative().optional(),
});

export const MixPreviewResponseSchema = z.object({
  ok: z.literal(true),
  mixKey: z.string(),
  filters: MixFilterSchema,
  posts: z.array(MixPostCardSchema),
  diagnostics: MixDiagnosticsSchema,
});

export const MixPageResponseSchema = z.object({
  ok: z.literal(true),
  mixKey: z.string(),
  filters: MixFilterSchema,
  posts: z.array(MixPostCardSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  diagnostics: MixDiagnosticsSchema,
});

export const mixesPreviewContract = defineContract({
  routeName: "mixes.preview.get",
  method: "GET",
  path: "/v2/mixes/:mixKey/preview",
  query: MixPreviewQuerySchema,
  body: z.object({}).strict(),
  response: MixPreviewResponseSchema,
});

export const mixesPageContract = defineContract({
  routeName: "mixes.page.get",
  method: "GET",
  path: "/v2/mixes/:mixKey/page",
  query: MixPageQuerySchema,
  body: z.object({}).strict(),
  response: MixPageResponseSchema,
});

export type MixFilter = z.infer<typeof MixFilterSchema>;
