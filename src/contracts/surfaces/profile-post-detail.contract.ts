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
  poster: z.string().url().optional(),
  thumbnail: z.string().url().optional(),
  variants: z
    .object({
      startup720FaststartAvc: z.string().url().optional(),
      main720Avc: z.string().url().optional(),
      hls: z.string().url().optional()
    })
    .optional()
});

export const ProfilePostDetailResponseSchema = z.object({
  routeName: z.literal("profile.postdetail.get"),
  firstRender: z.object({
    profileUserId: z.string(),
    post: z.object({
      postId: z.string(),
      userId: z.string(),
      caption: z.string().optional(),
      createdAtMs: z.number().int().nonnegative(),
      mediaType: z.enum(["image", "video"]),
      thumbUrl: z.string().url(),
      assets: z.array(AssetSchema)
    }),
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
