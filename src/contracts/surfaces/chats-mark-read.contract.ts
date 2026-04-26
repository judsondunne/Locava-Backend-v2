import { z } from "zod";
import { defineContract } from "../conventions.js";

export const ChatsMarkReadParamsSchema = z.object({
  conversationId: z.string().min(6)
});

export const ChatsMarkReadResponseSchema = z.object({
  routeName: z.literal("chats.markread.post"),
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

export const chatsMarkReadContract = defineContract({
  routeName: "chats.markread.post",
  method: "POST",
  path: "/v2/chats/:conversationId/mark-read",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: ChatsMarkReadResponseSchema
});
