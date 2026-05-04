import { z } from "zod";
import { defineContract } from "../conventions.js";

export const ProfilePostDetailParamsSchema = z.object({
  userId: z.string().min(6),
  postId: z.string().min(6)
});

export const ProfilePostDetailQuerySchema = z.object({
  debugSlowDeferredMs: z.coerce.number().int().min(0).max(2000).default(0)
});

const AssetSchema = z.object({
  id: z.string(),
  type: z.enum(["image", "video"]),
  original: z.string().url().optional(),
  poster: z.string().url().optional(),
  thumbnail: z.string().url().optional(),
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

export const ProfilePostDetailResponseSchema = z.object({
  routeName: z.literal("profile.postdetail.get"),
  firstRender: z.object({
    profileUserId: z.string(),
    post: z.object({
      postId: z.string(),
      userId: z.string(),
      caption: z.string().optional(),
      title: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      activities: z.array(z.string()).optional(),
      address: z.string().nullable().optional(),
      lat: z.number().nullable().optional(),
      lng: z.number().nullable().optional(),
      geoData: z.record(z.unknown()).optional(),
      coordinates: z.record(z.unknown()).optional(),
      createdAtMs: z.number().int().nonnegative(),
      updatedAtMs: z.number().int().nonnegative().optional(),
      mediaType: z.enum(["image", "video"]),
      thumbUrl: z.string().url(),
      assetsReady: z.boolean().optional(),
      mediaReadiness: z
        .object({
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
        })
        .optional(),
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
      playbackLab: z.record(z.unknown()).optional(),
      assetLocations: z.array(z.record(z.unknown())).optional(),
      assets: z.array(AssetSchema)
    }).passthrough(),
    author: z.object({
      userId: z.string(),
      handle: z.string(),
      name: z.string(),
      profilePic: z.string().url()
    }),
    social: z.object({
      likeCount: z.number().int().nonnegative(),
      commentCount: z.number().int().nonnegative(),
      viewerHasLiked: z.boolean()
    }),
    viewerActions: z.object({
      canDelete: z.boolean(),
      canReport: z.boolean()
    })
  }),
  deferred: z.object({
    commentsPreview: z
      .array(
        z.object({
          commentId: z.string(),
          userId: z.string(),
          text: z.string(),
          createdAtMs: z.number().int().nonnegative(),
          userName: z.string().nullable().optional(),
          userHandle: z.string().nullable().optional(),
          userPic: z.string().nullable().optional()
        })
      )
      .nullable()
  }),
  background: z.object({
    prefetchHints: z.array(z.string())
  }),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const profilePostDetailContract = defineContract({
  routeName: "profile.postdetail.get",
  method: "GET",
  path: "/v2/profiles/:userId/posts/:postId/detail",
  query: ProfilePostDetailQuerySchema,
  body: z.object({}).strict(),
  response: ProfilePostDetailResponseSchema
});

export type ProfilePostDetailResponse = z.infer<typeof ProfilePostDetailResponseSchema>;
