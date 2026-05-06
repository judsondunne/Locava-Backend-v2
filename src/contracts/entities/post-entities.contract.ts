import { z } from "zod";
const EmbeddedCommentSchema = z.object({
  id: z.string().optional(),
  commentId: z.string().optional(),
  content: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  userName: z.string().nullable().optional(),
  userHandle: z.string().nullable().optional(),
  userPic: z.string().nullable().optional(),
  time: z.unknown().optional(),
  createdAt: z.unknown().optional(),
  createdAtMs: z.number().nullable().optional(),
  likedBy: z.array(z.string()).optional(),
  replies: z.array(z.unknown()).optional()
}).passthrough();

export const AuthorSummarySchema = z.object({
  userId: z.string(),
  handle: z.string(),
  name: z.string().nullable(),
  pic: z.string().nullable()
}).passthrough();

export const SocialSummarySchema = z.object({
  likeCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative()
}).passthrough();

export const ViewerPostStateSchema = z.object({
  liked: z.boolean(),
  saved: z.boolean()
}).passthrough();

export const MediaStartupHintsSchema = z.object({
  type: z.enum(["image", "video"]),
  posterUrl: z.string().url(),
  aspectRatio: z.number().positive(),
  startupHint: z.enum(["poster_only", "poster_then_preview"])
}).passthrough();

const PostEnvelopeDebugSchema = z.object({
  sourceRoute: z.string().optional(),
  hydrationLevel: z.enum(["card", "detail", "marker"]).optional(),
  debugSource: z.string().nullable().optional()
}).passthrough();

const PostEnvelopeMediaSchema = z.object({
  mediaType: z.enum(["image", "video"]).optional(),
  assets: z.array(z.record(z.unknown())).optional(),
  firstAssetUrl: z.string().nullable().optional(),
  posterUrl: z.string().nullable().optional(),
  hasPlayableVideo: z.boolean().optional(),
  playableVideoUrl: z.string().nullable().optional()
}).passthrough();

const PostEnvelopeLocationSchema = z.object({
  address: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  long: z.number().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  geohash: z.string().nullable().optional()
}).passthrough();

const PostEnvelopeCountsSchema = z.object({
  likeCount: z.number().int().nonnegative().optional(),
  commentCount: z.number().int().nonnegative().optional()
}).passthrough();

const PostEnvelopeFieldsSchema = z.object({
  id: z.string().optional(),
  hydrationLevel: z.enum(["card", "detail", "marker"]).optional(),
  normalizedCard: z.record(z.unknown()).optional(),
  normalizedMedia: PostEnvelopeMediaSchema.optional(),
  normalizedAuthor: AuthorSummarySchema.optional(),
  normalizedLocation: PostEnvelopeLocationSchema.optional(),
  normalizedCounts: PostEnvelopeCountsSchema.optional(),
  mediaResolutionSource: z.string().optional(),
  hasPlayableVideo: z.boolean().optional(),
  hasAssetsArray: z.boolean().optional(),
  hasRawPost: z.boolean().optional(),
  hasEmbeddedComments: z.boolean().optional(),
  sourceRoute: z.string().optional(),
  rawPost: z.record(z.unknown()).nullable().optional(),
  sourcePost: z.record(z.unknown()).nullable().optional(),
  debugPostEnvelope: PostEnvelopeDebugSchema.optional()
}).passthrough();

export const PostCardSummarySchema = z.object({
  /** Canonical app-facing post contract (Master Post V2 derived). */
  appPost: z.record(z.unknown()).optional(),
  appPostV2: z.record(z.unknown()).optional(),
  canonicalPost: z.record(z.unknown()).optional(),
  post: z.record(z.unknown()).optional(),
  postContractVersion: z.union([z.literal(2), z.literal(3)]).optional(),
  postId: z.string(),
  rankToken: z.string(),
  author: AuthorSummarySchema,
  activities: z.array(z.string()).optional(),
  address: z.string().nullable().optional(),
  carouselFitWidth: z.boolean().optional(),
  layoutLetterbox: z.boolean().optional(),
  letterboxGradientTop: z.string().nullable().optional(),
  letterboxGradientBottom: z.string().nullable().optional(),
  letterboxGradients: z
    .array(
      z.object({
        top: z.string(),
        bottom: z.string()
      })
    )
    .optional(),
  geo: z
    .object({
      lat: z.number().nullable(),
      long: z.number().nullable(),
      city: z.string().nullable(),
      state: z.string().nullable(),
      country: z.string().nullable(),
      geohash: z.string().nullable()
    })
    .optional(),
  assets: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum(["image", "video"]),
        previewUrl: z.string().url().nullable(),
        posterUrl: z.string().url().nullable(),
        originalUrl: z.string().url().nullable(),
        streamUrl: z.string().url().nullable().optional(),
        mp4Url: z.string().url().nullable().optional(),
        blurhash: z.string().nullable(),
        width: z.number().nullable(),
        height: z.number().nullable(),
        aspectRatio: z.number().nullable(),
        orientation: z.string().nullable()
      })
    )
    .optional(),
  title: z.string().nullable(),
  captionPreview: z.string().nullable(),
  firstAssetUrl: z.string().url().nullable(),
  media: MediaStartupHintsSchema,
  social: SocialSummarySchema,
  viewer: ViewerPostStateSchema,
  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative()
  ,
  comments: z.array(EmbeddedCommentSchema).optional(),
  commentsPreview: z.array(EmbeddedCommentSchema).optional(),
  appPostAttached: z.boolean().optional(),
  appPostWireAssetCount: z.number().int().nonnegative().optional(),
  wireDeclaredMediaAssetCount: z.number().int().nonnegative().optional()
}).merge(PostEnvelopeFieldsSchema).passthrough();

export const PostDetailAssetSchema = z.object({
  id: z.string(),
  type: z.enum(["image", "video"]),
  original: z.string().url().nullable().optional(),
  poster: z.string().url().nullable(),
  thumbnail: z.string().url().nullable(),
  aspectRatio: z.number().nullable().optional(),
  durationSec: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  orientation: z.string().nullable().optional(),
  hasAudio: z.boolean().optional(),
  codecs: z.record(z.unknown()).optional(),
  variantMetadata: z.record(z.unknown()).optional(),
  instantPlaybackReady: z.boolean().optional(),
  playbackLab: z.record(z.unknown()).optional(),
  generated: z.record(z.unknown()).optional(),
  variants: z.record(z.unknown()).optional()
}).passthrough();

export const PostMediaReadinessSchema = z.object({
  mediaStatus: z.enum(["processing", "ready", "failed"]),
  assetsReady: z.boolean(),
  videoProcessingStatus: z.string().optional(),
  posterReady: z.boolean(),
  posterPresent: z.boolean(),
  posterUrl: z.string().url().optional(),
  playbackReady: z.boolean(),
  playbackUrlPresent: z.boolean(),
  playbackUrl: z.string().url().optional(),
  fallbackVideoUrl: z.string().url().optional(),
  instantPlaybackReady: z.boolean(),
  hasVideo: z.boolean(),
  aspectRatio: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  resizeMode: z.enum(["cover", "contain"]),
  gradientTop: z.string().nullable().optional(),
  gradientBottom: z.string().nullable().optional(),
  letterboxGradients: z
    .array(
      z.object({
        top: z.string(),
        bottom: z.string()
      })
    )
    .optional(),
  updatedAtMs: z.number().int().nonnegative().nullable().optional(),
  mediaUpdatedAtMs: z.number().int().nonnegative().nullable().optional()
});

export const PostDetailSchema = z.object({
  postId: z.string(),
  userId: z.string(),
  caption: z.string().nullable(),
  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative().optional(),
  carouselFitWidth: z.boolean().optional(),
  layoutLetterbox: z.boolean().optional(),
  letterboxGradientTop: z.string().nullable().optional(),
  letterboxGradientBottom: z.string().nullable().optional(),
  letterboxGradients: z
    .array(
      z.object({
        top: z.string(),
        bottom: z.string()
      })
    )
    .optional(),
  mediaType: z.enum(["image", "video"]),
  thumbUrl: z.string().url(),
  assetsReady: z.boolean().optional(),
  playbackLab: z.record(z.unknown()).optional(),
  geoData: z
    .object({
      city: z.string().nullable().optional(),
      state: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
      geohash: z.string().nullable().optional()
    })
    .optional(),
  coordinates: z
    .object({
      lat: z.number().nullable().optional(),
      lng: z.number().nullable().optional()
    })
    .optional(),
  mediaReadiness: PostMediaReadinessSchema.optional(),
  mediaStatus: z.enum(["processing", "ready", "failed"]).optional(),
  videoProcessingStatus: z.string().optional(),
  posterReady: z.boolean().optional(),
  posterPresent: z.boolean().optional(),
  posterUrl: z.string().url().optional(),
  playbackReady: z.boolean().optional(),
  playbackUrlPresent: z.boolean().optional(),
  playbackUrl: z.string().url().optional(),
  fallbackVideoUrl: z.string().url().optional(),
  instantPlaybackReady: z.boolean().optional(),
  assetLocations: z
    .array(
      z.object({
        lat: z.number().nullable().optional(),
        long: z.number().nullable().optional()
      })
    )
    .optional(),
  assets: z.array(PostDetailAssetSchema),
  cardSummary: PostCardSummarySchema
  ,
  comments: z.array(EmbeddedCommentSchema).optional(),
  commentsPreview: z.array(EmbeddedCommentSchema).optional()
}).merge(PostEnvelopeFieldsSchema).passthrough();
