import { z } from "zod";
import { defineContract } from "../conventions.js";
import { CommentSummarySchema } from "../entities/comment-entities.contract.js";

export const CommentsCreateParamsSchema = z.object({
  postId: z.string().min(6)
});

export const CommentsCreateBodySchema = z.object({
  text: z.string().trim().min(1).max(400),
  clientMutationKey: z.string().min(8).max(128).optional()
});

export const CommentsCreateResponseSchema = z.object({
  routeName: z.literal("comments.create.post"),
  comment: CommentSummarySchema,
  idempotency: z.object({
    replayed: z.boolean()
  }),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const commentsCreateContract = defineContract({
  routeName: "comments.create.post",
  method: "POST",
  path: "/v2/posts/:postId/comments",
  query: z.object({}).strict(),
  body: CommentsCreateBodySchema,
  response: CommentsCreateResponseSchema
});
