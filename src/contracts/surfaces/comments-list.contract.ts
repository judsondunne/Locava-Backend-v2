import { z } from "zod";
import { defineContract } from "../conventions.js";
import { CommentSummarySchema } from "../entities/comment-entities.contract.js";

export const CommentsListParamsSchema = z.object({
  postId: z.string().min(6)
});

export const CommentsListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(5).max(20).default(10)
});

export const CommentsListResponseSchema = z.object({
  routeName: z.literal("comments.list.get"),
  requestKey: z.string(),
  page: z.object({
    cursorIn: z.string().nullable(),
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    sort: z.literal("created_desc")
  }),
  items: z.array(CommentSummarySchema),
  /**
   * Newest top-level comment summary, present on bootstrap (cursor=null) when count > 0.
   * Lets clients render the comment-button preview ("@username: text") without a follow-up read.
   * Set to null when no comments exist; absent on cursor-based page requests.
   */
  latestCommentPreview: CommentSummarySchema.nullable().optional(),
  /** Diagnostic surfaced when count > 0 but items is empty (e.g. embedded array drift). */
  contractMismatch: z
    .object({
      reason: z.enum(["count_positive_items_empty", "embedded_drift"]),
      countHint: z.number().int().nonnegative()
    })
    .nullable()
    .optional(),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const commentsListContract = defineContract({
  routeName: "comments.list.get",
  method: "GET",
  path: "/v2/posts/:postId/comments",
  query: CommentsListQuerySchema,
  body: z.object({}).strict(),
  response: CommentsListResponseSchema
});

export type CommentsListResponse = z.infer<typeof CommentsListResponseSchema>;
