import { z } from "zod";
import { AuthorSummarySchema } from "./post-entities.contract.js";

export const GifAttachmentSchema = z.object({
  provider: z.literal("giphy"),
  gifId: z.string().min(1),
  title: z.string().optional(),
  previewUrl: z.string().url(),
  fixedHeightUrl: z.string().url().optional(),
  mp4Url: z.string().url().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  originalUrl: z.string().url().optional()
});

export const MessageSummarySchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
  senderId: z.string(),
  sender: AuthorSummarySchema,
  messageType: z.enum(["text", "photo", "gif", "post", "place", "collection", "message"]),
  text: z.string().max(600).nullable(),
  photoUrl: z.string().url().nullable().optional(),
  gif: GifAttachmentSchema.nullable().optional(),
  postId: z.string().nullable().optional(),
  createdAtMs: z.number().int().nonnegative(),
  ownedByViewer: z.boolean(),
  seenByViewer: z.boolean(),
  replyToMessageId: z.string().nullable(),
  /** Map of userId -> emoji string for persisted message reactions */
  reactions: z.record(z.string()).optional()
});

export type MessageSummary = z.infer<typeof MessageSummarySchema>;
