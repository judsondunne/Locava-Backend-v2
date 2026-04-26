import { z } from "zod";
import { defineContract } from "../conventions.js";

export const NotificationsMarkAllReadResponseSchema = z.object({
  routeName: z.literal("notifications.markallread.post"),
  updated: z.object({
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

export const notificationsMarkAllReadContract = defineContract({
  routeName: "notifications.markallread.post",
  method: "POST",
  path: "/v2/notifications/mark-all-read",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: NotificationsMarkAllReadResponseSchema
});
