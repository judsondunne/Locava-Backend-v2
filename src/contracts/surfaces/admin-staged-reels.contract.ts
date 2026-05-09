import { z } from "zod";
import { defineContract } from "../conventions.js";

const ADMIN_REEL_STAGER_UID = "aXngoh9jeqW35FNM3fq1w9aXdEh1";
const MAX_VIDEO_SIZE_BYTES = 1024 * 1024 * 1024;

const ReelLocationSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  source: z.enum(["exif", "manual-map"]),
  address: z.string().max(300).optional(),
  city: z.string().max(140).optional(),
  region: z.string().max(140).optional(),
  country: z.string().max(140).optional(),
  placeName: z.string().max(180).optional(),
  sourceAssetLocalId: z.string().max(400).optional(),
  extractedAt: z.string().datetime().optional()
});

const ReelMediaSchema = z.object({
  filename: z.string().min(1).max(300),
  mimeType: z.string().min(6).max(120).refine((value) => value.toLowerCase().startsWith("video/"), {
    message: "mimeType must start with video/"
  }),
  sizeBytes: z.coerce.number().int().positive().max(MAX_VIDEO_SIZE_BYTES),
  durationMs: z.coerce.number().int().nonnegative().optional(),
  width: z.coerce.number().int().positive().optional(),
  height: z.coerce.number().int().positive().optional()
});

export const AdminStagedReelsInitUploadBodySchema = ReelMediaSchema;

export const AdminStagedReelsInitUploadResponseSchema = z.object({
  routeName: z.literal("admin.stagedreels.initupload.post"),
  uploadId: z.string(),
  uploadUrl: z.string().url(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  objectKey: z.string(),
  bucket: z.string(),
  canonicalUrl: z.string().url()
});

export const AdminStagedReelsFinalizeBodySchema = z.object({
  uploadId: z.string().min(6).max(120),
  bucket: z.string().min(1).max(200),
  objectKey: z.string().min(3).max(600),
  url: z.string().url(),
  media: ReelMediaSchema,
  location: ReelLocationSchema,
  client: z.object({
    platform: z.string().min(2).max(80),
    appVersion: z.string().max(120).optional()
  })
});

const StagedReelSchema = z.object({
  id: z.string(),
  type: z.literal("stagedReel"),
  status: z.enum(["staged", "reviewing", "ready"]),
  createdByUid: z.string(),
  createdAt: z.union([z.number(), z.string(), z.null()]).optional(),
  updatedAt: z.union([z.number(), z.string(), z.null()]).optional(),
  media: z.object({
    kind: z.literal("video"),
    bucket: z.string(),
    objectKey: z.string(),
    originalUrl: z.string(),
    mimeType: z.string(),
    filename: z.string(),
    sizeBytes: z.number(),
    durationMs: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    source: z.literal("native-admin-reel-stager"),
    uploadId: z.string()
  }),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
    geohash: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    region: z.string().optional(),
    country: z.string().optional(),
    placeName: z.string().optional(),
    source: z.enum(["exif", "manual-map"]),
    sourceAssetLocalId: z.string().optional(),
    extractedAt: z.string().optional()
  }),
  postDraft: z.object({
    title: z.string(),
    description: z.string(),
    activities: z.array(z.string()),
    visibility: z.enum(["public", "friends", "private"]),
    postAsUserId: z.string().nullable(),
    notes: z.string()
  }),
  audit: z.object({
    schemaVersion: z.literal(1),
    createdFrom: z.literal("native-admin-reel-stager"),
    backendVersion: z.string().optional(),
    clientPlatform: z.string().optional(),
    finalizedAt: z.union([z.number(), z.string(), z.null()]).optional()
  })
});

export const AdminStagedReelsFinalizeResponseSchema = z.object({
  routeName: z.literal("admin.stagedreels.finalize.post"),
  stagedReel: StagedReelSchema
});

export const AdminStagedReelsListResponseSchema = z.object({
  routeName: z.literal("admin.stagedreels.list.get"),
  stagedReels: z.array(StagedReelSchema)
});

export const AdminStagedReelsPatchBodySchema = z.object({
  status: z.enum(["staged", "reviewing", "ready"]).optional(),
  postDraft: z
    .object({
      title: z.string().max(240).optional(),
      description: z.string().max(5000).optional(),
      activities: z.array(z.string().min(1).max(80)).max(32).optional(),
      notes: z.string().max(5000).optional(),
      visibility: z.enum(["public", "friends", "private"]).optional(),
      postAsUserId: z.string().max(128).nullable().optional()
    })
    .optional()
});

export const AdminStagedReelsPatchResponseSchema = z.object({
  routeName: z.literal("admin.stagedreels.patch.patch"),
  stagedReel: StagedReelSchema
});

export const adminStagedReelsInitUploadContract = defineContract({
  routeName: "admin.stagedreels.initupload.post",
  method: "POST",
  path: "/v2/admin/staged-reels/init-upload",
  query: z.object({}).strict(),
  body: AdminStagedReelsInitUploadBodySchema,
  response: AdminStagedReelsInitUploadResponseSchema
});

export const adminStagedReelsFinalizeContract = defineContract({
  routeName: "admin.stagedreels.finalize.post",
  method: "POST",
  path: "/v2/admin/staged-reels/finalize",
  query: z.object({}).strict(),
  body: AdminStagedReelsFinalizeBodySchema,
  response: AdminStagedReelsFinalizeResponseSchema
});

export const adminStagedReelsListContract = defineContract({
  routeName: "admin.stagedreels.list.get",
  method: "GET",
  path: "/v2/admin/staged-reels",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: AdminStagedReelsListResponseSchema
});

export const AdminStagedReelsPatchParamsSchema = z.object({
  id: z.string().min(6).max(120)
});

export const adminStagedReelsPatchContract = defineContract({
  routeName: "admin.stagedreels.patch.patch",
  method: "PATCH",
  path: "/v2/admin/staged-reels/:id",
  query: z.object({}).strict(),
  body: AdminStagedReelsPatchBodySchema,
  response: AdminStagedReelsPatchResponseSchema
});

export const REEL_STAGER_ADMIN_UID = ADMIN_REEL_STAGER_UID;
export const REEL_STAGER_MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_BYTES;
