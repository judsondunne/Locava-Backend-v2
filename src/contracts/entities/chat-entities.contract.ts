import { z } from "zod";
import { AuthorSummarySchema } from "./post-entities.contract.js";

export const ConversationSummarySchema = z.object({
  conversationId: z.string(),
  isGroup: z.boolean(),
  title: z.string(),
  displayPhotoUrl: z.string().url().nullable(),
  participantIds: z.array(z.string()).max(12),
  participantPreview: z.array(AuthorSummarySchema).max(3),
  lastMessagePreview: z.string().max(140).nullable(),
  lastMessageType: z.enum(["message", "photo", "gif", "post", "place", "collection"]).nullable(),
  lastSender: AuthorSummarySchema.nullable(),
  lastMessageAtMs: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  muted: z.boolean(),
  archived: z.boolean()
});

export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
