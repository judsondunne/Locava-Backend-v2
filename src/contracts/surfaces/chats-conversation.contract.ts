import { z } from "zod";
import { defineContract } from "../conventions.js";
import { ConversationDetailSchema } from "../entities/chat-entities.contract.js";

export const ChatsConversationParamsSchema = z.object({
  conversationId: z.string().min(1)
});

export const ChatsConversationResponseSchema = z.object({
  routeName: z.literal("chats.conversation.get"),
  requestKey: z.string(),
  conversation: ConversationDetailSchema
});

export type ChatsConversationResponse = z.infer<typeof ChatsConversationResponseSchema>;

export const chatsConversationContract = defineContract({
  routeName: "chats.conversation.get",
  method: "GET",
  path: "/v2/chats/:conversationId",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: ChatsConversationResponseSchema
});
