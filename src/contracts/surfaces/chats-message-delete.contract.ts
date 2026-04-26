import { z } from "zod";
import { defineContract } from "../conventions.js";

export const ChatsMessageDeleteParamsSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
});

export const ChatsMessageDeleteResponseSchema = z.object({
  routeName: z.literal("chats.message.delete"),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  removed: z.boolean(),
});

export const chatsMessageDeleteContract = defineContract({
  routeName: "chats.message.delete",
  method: "DELETE",
  path: "/v2/chats/:conversationId/messages/:messageId",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: ChatsMessageDeleteResponseSchema,
});
