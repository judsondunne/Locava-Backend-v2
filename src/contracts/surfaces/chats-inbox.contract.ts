import { z } from "zod";
import { defineContract } from "../conventions.js";
import { ConversationSummarySchema } from "../entities/chat-entities.contract.js";

export const ChatsInboxQuerySchema = z.object({
  cursor: z.string().min(8).max(200).optional(),
  limit: z.coerce.number().int().min(10).max(20).default(15)
});

export const ChatsInboxResponseSchema = z.object({
  routeName: z.literal("chats.inbox.get"),
  requestKey: z.string(),
  page: z.object({
    cursorIn: z.string().nullable(),
    limit: z.number().int().min(10).max(20),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    sort: z.literal("last_message_desc")
  }),
  items: z.array(ConversationSummarySchema),
  unread: z.object({
    totalConversationsUnread: z.number().int().nonnegative()
  }),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export type ChatsInboxResponse = z.infer<typeof ChatsInboxResponseSchema>;

export const chatsInboxContract = defineContract({
  routeName: "chats.inbox.get",
  method: "GET",
  path: "/v2/chats/inbox",
  query: ChatsInboxQuerySchema,
  body: z.object({}).strict(),
  response: ChatsInboxResponseSchema
});
