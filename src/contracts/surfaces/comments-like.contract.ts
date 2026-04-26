import { z } from "zod";
import { defineContract } from "../conventions.js";

export const CommentsLikeParamsSchema = z.object({
  commentId: z.string().min(6)
});

export const CommentsLikeResponseSchema = z.object({
  routeName: z.literal("comments.like.post"),
  commentId: z.string(),
  postId: z.string(),
  liked: z.boolean(),
  likeCount: z.number().int().nonnegative(),
  viewerState: z.object({
    liked: z.boolean()
  }),
  idempotency: z.object({
    replayed: z.boolean()
  }),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const commentsLikeContract = defineContract({
  routeName: "comments.like.post",
  method: "POST",
  path: "/v2/comments/:commentId/like",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: CommentsLikeResponseSchema
});
