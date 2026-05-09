/**
 * Standardized post doc contract — server-side mirror.
 *
 * Canonical definition: `Locava-Master/locava-contracts/src/standardizedPostDoc.ts`
 * Native mirror:        `Locava-Native/src/contracts/standardizedPostDoc.ts`
 *
 * The drift guard script
 *   `Locava-Native/scripts/check-standardized-post-doc-contract-drift.js`
 * fails CI if these three files diverge in their outer sections or their
 * key field names.
 *
 * Used by:
 *   - `routes/v2/posts-render-standardized-batch.routes.ts`
 *   - `services/posts/render-standardized-batch.handler.ts`
 *   - validation tests
 */

import { z } from "zod";
import { defineContract } from "./conventions.js";

export const STANDARDIZED_POST_DOC_OUTER_SECTIONS = [
  "id",
  "author",
  "classification",
  "compatibility",
  "engagement",
  "engagementPreview",
  "lifecycle",
  "location",
  "media",
  "ranking",
  "schema",
  "text",
] as const;

export type StandardizedPostDocOuterSection =
  (typeof STANDARDIZED_POST_DOC_OUTER_SECTIONS)[number];

export const StandardizedAuthorSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  handle: z.string(),
  profilePicUrl: z.string()
});

export const StandardizedClassificationSchema = z.object({
  activities: z.array(z.string()),
  primaryActivity: z.string(),
  mediaKind: z.enum(["image", "video", "mixed", "text", "unknown"]),
  visibility: z.enum(["public", "private", "group"]),
  isBoosted: z.boolean(),
  reel: z.boolean(),
  settingType: z.string(),
  moderatorTier: z.number(),
  source: z.string(),
  privacyLabel: z.string()
});

export const StandardizedCompatibilitySchema = z.object({
  displayPhotoLink: z.string(),
  mediaType: z.enum(["image", "video"]),
  photoLink: z.string(),
  photoLinks2: z.string().nullable(),
  photoLinks3: z.string().nullable(),
  thumbUrl: z.string(),
  posterUrl: z.string().nullable(),
  fallbackVideoUrl: z.string().nullable()
});

export const StandardizedEngagementSchema = z.object({
  commentCount: z.number(),
  commentsVersion: z.number(),
  likeCount: z.number(),
  likesVersion: z.number(),
  saveCount: z.number(),
  savesVersion: z.number(),
  shareCount: z.number(),
  showComments: z.boolean(),
  showLikes: z.boolean(),
  viewCount: z.number()
});

export const StandardizedRecentLikerSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  handle: z.string(),
  profilePicUrl: z.string(),
  likedAt: z.string()
});

export const StandardizedRecentCommentSchema = z.object({
  commentId: z.string(),
  userId: z.string(),
  displayName: z.string(),
  handle: z.string(),
  profilePicUrl: z.string(),
  text: z.string(),
  createdAt: z.string()
});

export const StandardizedEngagementPreviewSchema = z.object({
  recentComments: z.array(StandardizedRecentCommentSchema),
  recentLikers: z.array(StandardizedRecentLikerSchema)
});

export const StandardizedLifecycleSchema = z.object({
  createdAt: z.string(),
  createdAtMs: z.number(),
  deletedAt: z.string().nullable(),
  isDeleted: z.boolean(),
  lastMediaUpdatedAt: z.string(),
  lastUserVisibleAt: z.string(),
  status: z.enum(["active", "deleted", "hidden", "processing", "failed"]),
  updatedAt: z.string()
});

export const StandardizedLocationSchema = z.object({
  coordinates: z.object({
    geohash: z.string(),
    lat: z.number(),
    lng: z.number()
  }),
  display: z.object({
    address: z.string(),
    label: z.string(),
    name: z.string(),
    subtitle: z.string()
  }),
  place: z.object({
    placeId: z.string().nullable(),
    placeName: z.string().nullable(),
    precision: z.string(),
    source: z.string()
  }),
  regions: z.object({
    city: z.string(),
    cityRegionId: z.string(),
    country: z.string(),
    countryRegionId: z.string(),
    state: z.string(),
    stateRegionId: z.string()
  })
});

export const StandardizedAssetPresentationSchema = z.object({
  carouselFitWidth: z.boolean(),
  letterboxGradient: z.object({ top: z.string(), bottom: z.string() }),
  resizeMode: z.literal("contain")
});

export const StandardizedAssetSourceSchema = z.object({
  kind: z.string(),
  legacySourcesConsidered: z.array(z.unknown()),
  legacyVariantUrlsMerged: z.boolean(),
  originalAssetId: z.string(),
  primarySources: z.array(z.string())
});

export const StandardizedImageAssetSchema = z.object({
  id: z.string(),
  index: z.number(),
  type: z.literal("image"),
  image: z.object({
    aspectRatio: z.number(),
    blurhash: z.string().nullable(),
    displayUrl: z.string(),
    height: z.number(),
    orientation: z.enum(["portrait", "landscape", "square"]),
    originalUrl: z.string(),
    thumbnailUrl: z.string(),
    width: z.number()
  }),
  presentation: StandardizedAssetPresentationSchema,
  source: StandardizedAssetSourceSchema
});

export const StandardizedVideoPlaybackSchema = z.object({
  primaryUrl: z.string(),
  startupUrl: z.string(),
  goodNetworkUrl: z.string().nullable(),
  weakNetworkUrl: z.string().nullable(),
  poorNetworkUrl: z.string().nullable(),
  defaultUrl: z.string(),
  highQualityUrl: z.string().nullable(),
  fallbackUrl: z.string().nullable(),
  upgradeUrl: z.string().nullable(),
  hlsUrl: z.string().nullable(),
  previewUrl: z.string().nullable(),
  selectedReason: z.string()
});

export const StandardizedVideoVariantsSchema = z.object({
  preview360: z.string().nullable(),
  preview360Avc: z.string().nullable(),
  main720: z.string().nullable(),
  main720Avc: z.string().nullable(),
  main1080: z.string().nullable(),
  main1080Avc: z.string().nullable(),
  startup540Faststart: z.string().nullable(),
  startup540FaststartAvc: z.string().nullable(),
  startup720Faststart: z.string().nullable(),
  startup720FaststartAvc: z.string().nullable(),
  startup1080Faststart: z.string().nullable(),
  startup1080FaststartAvc: z.string().nullable(),
  upgrade1080Faststart: z.string().nullable(),
  upgrade1080FaststartAvc: z.string().nullable(),
  hls: z.string().nullable(),
  hlsAvcMaster: z.string().nullable()
});

export const StandardizedVideoReadinessSchema = z.object({
  assetsReady: z.boolean(),
  instantPlaybackReady: z.boolean(),
  faststartVerified: z.boolean(),
  processingStatus: z.enum(["ready", "processing", "failed"])
});

export const StandardizedVideoCodecsSchema = z.object({
  video: z.string().nullable(),
  audio: z.string().nullable()
});

export const StandardizedVideoTechnicalSchema = z.object({
  sourceCodec: z.string().nullable(),
  playbackCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  bitrateKbps: z.number().nullable(),
  sizeBytes: z.number().nullable(),
  width: z.number(),
  height: z.number()
});

export const StandardizedVideoAssetSchema = z.object({
  id: z.string(),
  index: z.number(),
  type: z.literal("video"),
  video: z.object({
    originalUrl: z.string(),
    posterUrl: z.string(),
    posterHighUrl: z.string(),
    thumbnailUrl: z.string(),
    durationSec: z.number(),
    hasAudio: z.boolean(),
    playback: StandardizedVideoPlaybackSchema,
    variants: StandardizedVideoVariantsSchema,
    readiness: StandardizedVideoReadinessSchema,
    codecs: StandardizedVideoCodecsSchema,
    technical: StandardizedVideoTechnicalSchema
  }),
  presentation: StandardizedAssetPresentationSchema,
  source: StandardizedAssetSourceSchema
});

export const StandardizedMediaAssetSchema = z.discriminatedUnion("type", [
  StandardizedImageAssetSchema,
  StandardizedVideoAssetSchema
]);

export const StandardizedMediaCoverSchema = z.object({
  assetId: z.string(),
  aspectRatio: z.number(),
  gradient: z.object({ top: z.string(), bottom: z.string() }),
  height: z.number(),
  posterUrl: z.string().nullable(),
  thumbUrl: z.string(),
  type: z.enum(["image", "video"]),
  url: z.string(),
  width: z.number()
});

export const StandardizedMediaSchema = z.object({
  assetCount: z.number(),
  assets: z.array(StandardizedMediaAssetSchema),
  assetsReady: z.boolean(),
  completeness: z.enum(["complete", "partial", "legacy_recovered", "missing"]),
  cover: StandardizedMediaCoverSchema,
  coverAssetId: z.string(),
  hasMultipleAssets: z.boolean(),
  instantPlaybackReady: z.boolean(),
  presentation: z.object({
    carouselFitWidth: z.boolean(),
    resizeMode: z.literal("contain")
  }),
  primaryAssetId: z.string(),
  rawAssetCount: z.number(),
  status: z.enum(["ready", "processing", "partial", "failed", "none"])
});

export const StandardizedRankingSchema = z.object({
  aggregates: z.record(z.union([z.number(), z.string(), z.null()])),
  rollup: z.record(z.number())
});

export const StandardizedSchemaSchema = z.object({
  canonicalizedAt: z.string(),
  canonicalizedBy: z.string(),
  migrationRunId: z.string().nullable(),
  name: z.literal("locava.post"),
  restoreBackupDocId: z.string(),
  restorePreviewOnly: z.boolean(),
  restoreRunId: z.string(),
  restoreSourceName: z.string(),
  restoredAt: z.string(),
  restoredFromCanonicalBackup: z.boolean(),
  sourceShape: z.string(),
  version: z.literal(2)
});

export const StandardizedTextSchema = z.object({
  caption: z.string(),
  content: z.string(),
  description: z.string(),
  searchableText: z.string(),
  title: z.string()
});

export const StandardizedPostDocSchema = z.object({
  id: z.string(),
  postId: z.string(),
  userId: z.string(),
  userName: z.string(),
  userHandle: z.string(),
  userPic: z.string(),
  title: z.string(),
  content: z.string(),
  address: z.string(),
  lat: z.number(),
  long: z.number(),
  activities: z.array(z.string()),
  mediaType: z.enum(["image", "video"]),
  photoLink: z.string(),
  thumbUrl: z.string(),
  assetsReady: z.boolean(),
  likesCount: z.number(),
  likesVersion: z.number(),
  commentsCount: z.number(),
  commentsVersion: z.number(),
  likeCount: z.number(),
  commentCount: z.number(),
  showLikes: z.boolean(),
  showComments: z.boolean(),
  author: StandardizedAuthorSchema,
  classification: StandardizedClassificationSchema,
  compatibility: StandardizedCompatibilitySchema,
  engagement: StandardizedEngagementSchema,
  engagementPreview: StandardizedEngagementPreviewSchema,
  lifecycle: StandardizedLifecycleSchema,
  location: StandardizedLocationSchema,
  media: StandardizedMediaSchema,
  ranking: StandardizedRankingSchema,
  schema: StandardizedSchemaSchema,
  text: StandardizedTextSchema
});

export type StandardizedPostDoc = z.infer<typeof StandardizedPostDocSchema>;

export const RenderStandardizedRejectReasonSchema = z.enum([
  "not_visible",
  "forbidden",
  "invalid",
  "not_standardized",
  "not_found",
  "rate_limited"
]);

export const RenderStandardizedRejectedEntrySchema = z.object({
  postId: z.string(),
  reason: RenderStandardizedRejectReasonSchema,
  issues: z.array(z.string()).optional()
});

export const RenderStandardizedBatchBodySchema = z.object({
  postIds: z.array(z.string().min(1)).min(1).max(50)
});

export const RenderStandardizedBatchResponseSchema = z.object({
  posts: z.array(StandardizedPostDocSchema),
  missing: z.array(z.string()),
  rejected: z.array(RenderStandardizedRejectedEntrySchema)
});

export type RenderStandardizedBatchBody = z.infer<typeof RenderStandardizedBatchBodySchema>;
export type RenderStandardizedBatchResponse = z.infer<typeof RenderStandardizedBatchResponseSchema>;
export type RenderStandardizedRejectedEntry = z.infer<typeof RenderStandardizedRejectedEntrySchema>;

export const RENDER_STANDARDIZED_BATCH_PATH = "/v2/posts/render-standardized:batch";
export const RENDER_STANDARDIZED_BATCH_ROUTE_NAME = "posts.render_standardized.batch";

export const renderStandardizedBatchContract = defineContract({
  routeName: RENDER_STANDARDIZED_BATCH_ROUTE_NAME,
  method: "POST",
  path: RENDER_STANDARDIZED_BATCH_PATH,
  query: z.object({}),
  body: RenderStandardizedBatchBodySchema,
  response: RenderStandardizedBatchResponseSchema
});
