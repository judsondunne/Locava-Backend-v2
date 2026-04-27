import { z } from "zod";
import { defineContract } from "../conventions.js";
import { NotificationSummarySchema } from "../entities/notification-entities.contract.js";

export const NotificationsListQuerySchema = z.object({
  cursor: z.string().min(8).max(200).optional(),
  limit: z.coerce.number().int().min(10).max(20).default(15)
});

export const NotificationsListResponseSchema = z.object({
  routeName: z.literal("notifications.list.get"),
  page: z.object({
    cursorIn: z.string().nullable(),
    limit: z.number().int().min(10).max(20),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    sort: z.literal("created_desc")
  }),
  items: z.array(NotificationSummarySchema),
  unread: z.object({
    count: z.number().int().nonnegative().nullable()
  }),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export type NotificationsListResponse = z.infer<typeof NotificationsListResponseSchema>;

export const notificationsListContract = defineContract({
  routeName: "notifications.list.get",
  method: "GET",
  path: "/v2/notifications",
  query: NotificationsListQuerySchema,
  body: z.object({}).strict(),
  response: NotificationsListResponseSchema
});
