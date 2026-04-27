import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostLikesListParamsSchema = z.object({
  postId: z.string().min(6)
});

export const PostLikesListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const PostLikesListResponseSchema = z.object({
  routeName: z.literal("posts.likes.list"),
  postId: z.string(),
  likes: z.array(
    z.object({
      userId: z.string(),
      userHandle: z.string().nullable(),
      userName: z.string().nullable(),
      userPic: z.string().nullable(),
      createdAtMs: z.number().int().nonnegative().nullable()
    })
  ),
  hasMore: z.boolean()
});

export const postLikesListContract = defineContract({
  routeName: "posts.likes.list",
  method: "GET",
  path: "/v2/posts/:postId/likes",
  query: PostLikesListQuerySchema,
  body: z.object({}).strict(),
  response: PostLikesListResponseSchema
});

