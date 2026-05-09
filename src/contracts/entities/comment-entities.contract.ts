import { z } from "zod";
import { GifAttachmentSchema } from "./chat-message-entities.contract.js";
import { AuthorSummarySchema } from "./post-entities.contract.js";

export const CommentViewerStateSchema = z.object({
  liked: z.boolean(),
  owned: z.boolean()
});

export const CommentSummarySchema = z.object({
  commentId: z.string(),
  postId: z.string(),
  author: AuthorSummarySchema,
  text: z.string(),
  gif: GifAttachmentSchema.nullable().optional(),
  /** Parent commentId when this is a reply. Null/undefined for top-level comments. */
  replyingTo: z.string().nullable().optional(),
  /** True when the row came from a bounded preview source rather than the full comments source. */
  preview: z.boolean().optional(),
  createdAtMs: z.number().int().nonnegative(),
  likeCount: z.number().int().nonnegative().optional(),
  viewerState: CommentViewerStateSchema
});

export type CommentSummary = z.infer<typeof CommentSummarySchema>;
