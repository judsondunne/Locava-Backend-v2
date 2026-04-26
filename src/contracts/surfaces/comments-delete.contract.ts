import { z } from "zod";
import { defineContract } from "../conventions.js";

export const CommentsDeleteParamsSchema = z.object({
  commentId: z.string().min(6)
});

export const CommentsDeleteResponseSchema = z.object({
  routeName: z.literal("comments.delete.delete"),
  commentId: z.string(),
  postId: z.string(),
  deleted: z.boolean(),
  idempotency: z.object({
    replayed: z.boolean()
  }),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const commentsDeleteContract = defineContract({
  routeName: "comments.delete.delete",
  method: "DELETE",
  path: "/v2/comments/:commentId",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: CommentsDeleteResponseSchema
});
