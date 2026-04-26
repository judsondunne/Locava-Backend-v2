import { z } from "zod";
import { defineContract } from "../conventions.js";
import { MessageSummarySchema } from "../entities/chat-message-entities.contract.js";

export const ChatsSendMessageParamsSchema = z.object({
  conversationId: z.string().min(1)
});

export const ChatsSendMessageBodySchema = z
  .object({
    messageType: z.enum(["text", "photo", "gif", "post"]).default("text"),
    text: z.string().trim().max(600).optional(),
    photoUrl: z.string().url().optional(),
    gifUrl: z.string().url().optional(),
    postId: z.string().trim().min(4).max(128).optional(),
    clientMessageId: z.string().trim().min(8).max(128).optional(),
    replyingToMessageId: z.string().trim().min(1).max(128).optional()
  })
  .superRefine((val, ctx) => {
    if (val.messageType === "post" && (!val.postId || val.postId.trim().length < 4)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "postId is required for post messages", path: ["postId"] });
    }
  });

export const ChatsSendMessageResponseSchema = z.object({
  routeName: z.literal("chats.sendtext.post"),
  message: MessageSummarySchema,
  idempotency: z.object({
    replayed: z.boolean()
  }),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const chatsSendMessageContract = defineContract({
  routeName: "chats.sendtext.post",
  method: "POST",
  path: "/v2/chats/:conversationId/messages",
  query: z.object({}).strict(),
  body: ChatsSendMessageBodySchema,
  response: ChatsSendMessageResponseSchema
});
