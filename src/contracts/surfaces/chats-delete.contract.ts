import { z } from "zod";
import { defineContract } from "../conventions.js";

export const ChatsDeleteParamsQuerySchema = z.object({});
export const ChatsDeleteBodySchema = z.object({}).strict();

export const ChatsDeleteResponseSchema = z.object({
  routeName: z.literal("chats.delete.delete"),
  conversationId: z.string().min(1),
  removed: z.boolean()
});

// invalidation: delete removes the conversation from chat inbox/index and invalidates thread reads.
export const chatsDeleteContract = defineContract({
  routeName: "chats.delete.delete",
  method: "DELETE",
  path: "/v2/chats/:conversationId",
  query: ChatsDeleteParamsQuerySchema,
  body: ChatsDeleteBodySchema,
  response: ChatsDeleteResponseSchema
});
