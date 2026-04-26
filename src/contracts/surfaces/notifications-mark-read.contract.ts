import { z } from "zod";
import { defineContract } from "../conventions.js";

export const NotificationsMarkReadBodySchema = z.object({
  notificationIds: z.array(z.string().min(6)).min(1).max(20)
});

export const NotificationsMarkReadResponseSchema = z.object({
  routeName: z.literal("notifications.markread.post"),
  updated: z.object({
    requestedCount: z.number().int().nonnegative(),
    markedCount: z.number().int().nonnegative(),
    unreadCount: z.number().int().nonnegative()
  }),
  idempotency: z.object({
    replayed: z.boolean()
  }),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  })
});

export const notificationsMarkReadContract = defineContract({
  routeName: "notifications.markread.post",
  method: "POST",
  path: "/v2/notifications/mark-read",
  query: z.object({}).strict(),
  body: NotificationsMarkReadBodySchema,
  response: NotificationsMarkReadResponseSchema
});
