import { z } from "zod";
import { defineContract } from "../conventions.js";

export const ChatsMarkUnreadParamsSchema = z.object({
  conversationId: z.string().min(6)
});

export const ChatsMarkUnreadResponseSchema = z.object({
  routeName: z.literal("chats.markunread.post"),
  conversationId: z.string(),
  unreadCount: z.number().int().nonnegative(),
  idempotency: z.object({
    replayed: z.boolean()
  }),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const chatsMarkUnreadContract = defineContract({
  routeName: "chats.markunread.post",
  method: "POST",
  path: "/v2/chats/:conversationId/mark-unread",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: ChatsMarkUnreadResponseSchema
});
