import { z } from "zod";
import { AuthorSummarySchema } from "./post-entities.contract.js";

export const NotificationTypeSchema = z.enum([
  "like",
  "comment",
  "follow",
  "post",
  "mention",
  "invite",
  "group_invite",
  "group_joined",
  "collection_shared",
  "contact_joined",
  "place_follow",
  "audio_like",
  "system",
  "chat",
  "achievement_leaderboard",
  "leaderboard_rank_up",
  "leaderboard_rank_down",
  "leaderboard_passed",
  "post_discovery"
]);

export const NotificationPreviewSchema = z.object({
  text: z.string().max(120).nullable(),
  thumbUrl: z.string().url().nullable()
});

export const NotificationSummarySchema = z.object({
  notificationId: z.string(),
  type: NotificationTypeSchema,
  actorId: z.string(),
  actor: AuthorSummarySchema,
  targetId: z.string(),
  createdAtMs: z.number().int().nonnegative(),
  readState: z.enum(["unread", "read"]),
  preview: NotificationPreviewSchema,
  /** Deep-link / destination fields (commentId, collectionId, etc.) for clients and legacy mappers. */
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type NotificationSummary = z.infer<typeof NotificationSummarySchema>;
