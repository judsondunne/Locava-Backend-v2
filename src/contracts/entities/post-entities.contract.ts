import { z } from "zod";

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
  updatedAtMs: z.number().int().nonnegative()
});

export const PostDetailAssetSchema = z.object({
  id: z.string(),
  type: z.enum(["image", "video"]),
  original: z.string().url().nullable().optional(),
  poster: z.string().url().nullable(),
  thumbnail: z.string().url().nullable(),
  variants: z.record(z.unknown()).optional()
});

export const PostDetailSchema = z.object({
  postId: z.string(),
  userId: z.string(),
  caption: z.string().nullable(),
  createdAtMs: z.number().int().nonnegative(),
  mediaType: z.enum(["image", "video"]),
  thumbUrl: z.string().url(),
  assets: z.array(PostDetailAssetSchema),
  cardSummary: PostCardSummarySchema
});
