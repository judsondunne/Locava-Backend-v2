import { z } from "zod";
import { defineContract } from "../conventions.js";
import {
  AuthorSummarySchema,
  PostDetailSchema,
  SocialSummarySchema,
  ViewerPostStateSchema
} from "../entities/post-entities.contract.js";

export const PostsDetailParamsSchema = z.object({
  postId: z.string().min(6)
});

export const PostsDetailResponseSchema = z.object({
  routeName: z.literal("posts.detail.get"),
  firstRender: z.object({
    post: PostDetailSchema.extend({
      title: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      activities: z.array(z.string()).optional(),
      address: z.string().nullable().optional(),
      lat: z.number().nullable().optional(),
      lng: z.number().nullable().optional(),
      location: z
        .object({
          address: z.string().nullable().optional(),
          lat: z.number().nullable().optional(),
          lng: z.number().nullable().optional()
        })
        .optional(),
      mentions: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      visibility: z.enum(["public", "followers", "private"]).optional(),
      deleted: z.boolean().optional(),
      blocked: z.boolean().optional()
    }),
    author: AuthorSummarySchema,
    social: SocialSummarySchema,
    viewer: ViewerPostStateSchema.extend({
      viewerFollowsCreator: z.boolean().optional()
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
  degraded: z.boolean(),
  fallbacks: z.array(z.string()),
  debugHydrationSource: z.enum(["cache", "firestore", "mixed"]).optional(),
  debugReads: z.number().int().nonnegative().optional(),
  debugPostIds: z.array(z.string()).optional(),
  debugMissingIds: z.array(z.string()).optional(),
  debugDurationMs: z.number().int().nonnegative().optional()
});

export const PostsDetailsBatchBodySchema = z.object({
  postIds: z.array(z.string().min(1)).min(1).max(15),
  reason: z.enum(["prefetch", "open", "surface_bootstrap", "presentation_hints"]),
  hydrationMode: z.enum(["card", "playback", "open", "full"]).default("open")
});

export const PostsDetailsBatchResponseSchema = z.object({
  routeName: z.literal("posts.detail.batch"),
  reason: z.enum(["prefetch", "open", "surface_bootstrap", "presentation_hints"]),
  hydrationMode: z.enum(["card", "playback", "open", "full"]),
  found: z.array(
    z.object({
      postId: z.string(),
      detail: PostsDetailResponseSchema
    })
  ),
  missing: z.array(z.string()),
  forbidden: z.array(z.string()),
  debugHydrationSource: z.enum(["cache", "firestore", "mixed"]).optional(),
  debugReads: z.number().int().nonnegative().optional(),
  debugEntityConstructionCount: z.number().int().nonnegative().optional(),
  debugPayloadCategory: z.enum(["tiny", "small", "medium", "heavy"]).optional(),
  debugPayloadBytes: z.number().int().nonnegative().optional(),
  debugPostIds: z.array(z.string()).optional(),
  debugMissingIds: z.array(z.string()).optional(),
  debugDurationMs: z.number().int().nonnegative().optional()
});

export const postsDetailContract = defineContract({
  routeName: "posts.detail.get",
  method: "GET",
  path: "/v2/posts/:postId/detail",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: PostsDetailResponseSchema
});

export const postsDetailsBatchContract = defineContract({
  routeName: "posts.detail.batch",
  method: "POST",
  path: "/v2/posts/details:batch",
  query: z.object({}).strict(),
  body: PostsDetailsBatchBodySchema,
  response: PostsDetailsBatchResponseSchema
});
