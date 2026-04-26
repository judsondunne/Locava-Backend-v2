import { z } from "zod";
import { defineContract } from "../conventions.js";

export const ChatsCreateGroupBodySchema = z.object({
  participants: z.array(z.string().min(1)).min(1).max(11),
  groupName: z.string().trim().min(1).max(80),
  displayPhotoURL: z.string().url().optional().nullable()
});

export const ChatsCreateGroupResponseSchema = z.object({
  routeName: z.literal("chats.create_group.post"),
  conversationId: z.string().min(1)
});

// invalidation: create-group creates a new inbox thread and changes chat index ordering for members.
export const chatsCreateGroupContract = defineContract({
  routeName: "chats.create_group.post",
  method: "POST",
  path: "/v2/chats/create-group",
  query: z.object({}).strict(),
  body: ChatsCreateGroupBodySchema,
  response: ChatsCreateGroupResponseSchema
});
