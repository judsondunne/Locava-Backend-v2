import { z } from "zod";
import { defineContract } from "../conventions.js";

export const ChatsMessageReactionParamsSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1)
});

export const ChatsMessageReactionBodySchema = z.object({
  emoji: z.string().trim().min(1).max(16)
});

export const ChatsMessageReactionResponseSchema = z.object({
  routeName: z.literal("chats.messagereaction.post"),
  conversationId: z.string(),
  messageId: z.string(),
  reactions: z.record(z.string()),
  viewerReaction: z.string().nullable(),
  idempotency: z.object({ replayed: z.boolean() }),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const chatsMessageReactionContract = defineContract({
  routeName: "chats.messagereaction.post",
  method: "POST",
  path: "/v2/chats/:conversationId/messages/:messageId/reaction",
  query: z.object({}).strict(),
  body: ChatsMessageReactionBodySchema,
  response: ChatsMessageReactionResponseSchema
});
