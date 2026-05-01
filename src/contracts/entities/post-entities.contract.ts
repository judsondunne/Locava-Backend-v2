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
});

export const AuthorSummarySchema = z.object({
  userId: z.string(),
  handle: z.string(),
  name: z.string().nullable(),
  pic: z.string().nullable()
});

export const SocialSummarySchema = z.object({
  likeCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative()
});

export const ViewerPostStateSchema = z.object({
  liked: z.boolean(),
  saved: z.boolean()
});

export const MediaStartupHintsSchema = z.object({
  type: z.enum(["image", "video"]),
  posterUrl: z.string().url(),
  aspectRatio: z.number().positive(),
  startupHint: z.enum(["poster_only", "poster_then_preview"])
});

export const PostCardSummarySchema = z.object({
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
  commentsPreview: z.array(EmbeddedCommentSchema).optional()
});

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
});
