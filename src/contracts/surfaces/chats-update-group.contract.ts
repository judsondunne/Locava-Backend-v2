import { z } from "zod";
import { defineContract } from "../conventions.js";

export const ChatsUpdateGroupParamsSchema = z.object({
  conversationId: z.string().min(1)
});

export const ChatsUpdateGroupBodySchema = z
  .object({
    groupName: z.string().trim().min(1).max(80).optional(),
    displayPhotoURL: z.string().url().nullable().optional(),
    participants: z.array(z.string().min(1)).min(2).max(12).optional()
  })
  .superRefine((val, ctx) => {
    const hasName = typeof val.groupName === "string" && val.groupName.trim().length > 0;
    const hasPhoto = val.displayPhotoURL !== undefined;
    const hasParticipants = Array.isArray(val.participants);
    if (!hasName && !hasPhoto && !hasParticipants) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide groupName and/or displayPhotoURL and/or participants",
        path: ["groupName"]
      });
    }
  });

export const ChatsUpdateGroupResponseSchema = z.object({
  routeName: z.literal("chats.updategroup.post"),
  conversationId: z.string(),
  groupName: z.string(),
  displayPhotoURL: z.string().nullable(),
  participantIds: z.array(z.string()).max(12),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const chatsUpdateGroupContract = defineContract({
  routeName: "chats.updategroup.post",
  method: "POST",
  path: "/v2/chats/:conversationId/update-group",
  query: z.object({}).strict(),
  body: ChatsUpdateGroupBodySchema,
  response: ChatsUpdateGroupResponseSchema
});
