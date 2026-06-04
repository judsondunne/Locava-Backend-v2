import { z } from "zod";
import { defineContract } from "../conventions.js";
import { GifAttachmentSchema, MessageSummarySchema } from "../entities/chat-message-entities.contract.js";

const SharedPostPreviewSchema = z
  .object({
    title: z.string().trim().max(240).optional(),
    thumbUrl: z.string().trim().max(2048).optional(),
    displayPhotoLink: z.string().trim().max(2048).optional(),
    photoLink: z.string().trim().max(2048).optional(),
    poster: z.string().trim().max(2048).optional(),
    thumbnail: z.string().trim().max(2048).optional(),
    firstActivity: z.string().trim().max(120).optional(),
    activities: z.array(z.string().trim().max(120)).max(12).optional(),
    lat: z.number().finite().optional(),
    lng: z.number().finite().optional(),
    lon: z.number().finite().optional(),
    long: z.number().finite().optional(),
    address: z.string().trim().max(400).optional(),
    locationName: z.string().trim().max(400).optional(),
    undiscoveredLabel: z.string().trim().max(240).optional(),
    isRoute: z.boolean().optional(),
    sourceCollection: z.enum(["posts", "unexploredSpots", "unexploredRoutes"]).optional(),
    itemType: z.enum(["post", "unexploredSpot", "unexploredRoute"]).optional(),
    routeSummary: z.record(z.unknown()).optional(),
    routePreviewCoordinates: z
      .array(z.object({ lat: z.number().finite(), lon: z.number().finite() }))
      .max(512)
      .optional(),
    undiscoveredIconName: z.string().trim().max(64).optional(),
    undiscoveredColorKey: z.string().trim().max(64).optional(),
    undiscoveredMarkerColor: z.string().trim().max(32).optional()
  })
  .strict();

export const ChatsSendMessageParamsSchema = z.object({
  conversationId: z.string().min(1)
});

export const ChatsSendMessageBodySchema = z
  .object({
    messageType: z.enum(["text", "photo", "gif", "post"]).default("text"),
    text: z.string().trim().max(600).optional(),
    photoUrl: z.string().url().optional(),
    gifUrl: z.string().url().optional(),
    gif: GifAttachmentSchema.optional(),
    postId: z.string().trim().min(4).max(128).optional(),
    sourceCollection: z.enum(["posts", "unexploredSpots", "unexploredRoutes"]).optional(),
    itemType: z.enum(["post", "unexploredSpot", "unexploredRoute"]).optional(),
    postSource: z.enum(["posts", "undiscovered", "undiscoveredPost"]).optional(),
    sharedPostPreview: SharedPostPreviewSchema.optional(),
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
