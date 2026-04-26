import { z } from "zod";
import { defineContract } from "../conventions.js";
import { MessageSummarySchema } from "../entities/chat-message-entities.contract.js";

export const ChatsThreadParamsSchema = z.object({
  conversationId: z.string().min(1)
});

export const ChatsThreadQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(10).max(50).default(25)
});

export const ChatsThreadCursorSchema = z.object({
  messageId: z.string(),
  createdAtMs: z.number().int().nonnegative()
});

export const ChatsThreadResponseSchema = z.object({
  requestKey: z.string(),
  page: z.object({
    cursorIn: z.string(),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    order: z.literal("created_desc")
  }),
  conversationId: z.string(),
  items: z.array(MessageSummarySchema)
});

export const chatsThreadContract = defineContract({
  method: "GET",
  path: "/v2/chats/:conversationId/messages",
  routeName: "chats.thread.get",
  query: ChatsThreadQuerySchema,
  body: z.object({}).strict(),
  response: ChatsThreadResponseSchema
});

export type ChatsThreadResponse = z.infer<typeof ChatsThreadResponseSchema>;
