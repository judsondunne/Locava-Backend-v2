import { z } from "zod";
import { defineContract } from "../conventions.js";

export const ChatsCreateOrGetBodySchema = z.object({
  otherUserId: z.string().min(1)
});

export const ChatsCreateOrGetResponseSchema = z.object({
  routeName: z.literal("chats.create_or_get.post"),
  conversationId: z.string().min(1),
  created: z.boolean()
});

// invalidation: create-or-get affects chat inbox membership/order for the viewer.
export const chatsCreateOrGetContract = defineContract({
  routeName: "chats.create_or_get.post",
  method: "POST",
  path: "/v2/chats/create-or-get",
  query: z.object({}).strict(),
  body: ChatsCreateOrGetBodySchema,
  response: ChatsCreateOrGetResponseSchema
});
