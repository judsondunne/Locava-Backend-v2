import { z } from "zod";
import { defineContract } from "../conventions.js";
import { CommentSummarySchema } from "../entities/comment-entities.contract.js";
import { GifAttachmentSchema } from "../entities/chat-message-entities.contract.js";

export const CommentsCreateParamsSchema = z.object({
  postId: z.string().min(6)
});

export const CommentsCreateBodySchema = z
  .object({
    text: z.string().trim().max(400).optional().default(""),
    gif: GifAttachmentSchema.nullable().optional(),
    replyingTo: z.string().min(6).nullable().optional(),
    clientMutationKey: z.string().min(8).max(128).optional()
  })
  .superRefine((value, ctx) => {
    const hasText = value.text.trim().length > 0;
    const hasGif = value.gif != null;
    if (!hasText && !hasGif) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "text or gif is required",
        path: ["text"]
      });
    }
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
