import { z } from "zod";
import { AuthorSummarySchema } from "./post-entities.contract.js";

export const MessageSummarySchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
  senderId: z.string(),
  sender: AuthorSummarySchema,
  messageType: z.enum(["text", "photo", "gif", "post", "place", "collection", "message"]),
  text: z.string().max(600).nullable(),
  createdAtMs: z.number().int().nonnegative(),
  ownedByViewer: z.boolean(),
  seenByViewer: z.boolean(),
  replyToMessageId: z.string().nullable(),
  /** Map of userId -> emoji string for persisted message reactions */
  reactions: z.record(z.string()).optional()
});

export type MessageSummary = z.infer<typeof MessageSummarySchema>;
