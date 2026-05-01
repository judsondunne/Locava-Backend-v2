import { z } from "zod";
import { defineContract } from "../conventions.js";
import {
  ProfileAchievementPreviewItemSchema,
  ProfileEndpointDebugSchema,
} from "./profile-bootstrap.contract.js";

export const ProfileAchievementsParamsSchema = z.object({
  userId: z.string().min(6),
});

export const ProfileAchievementsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(3).max(24).default(8),
});

export const ProfileAchievementsResponseSchema = z.object({
  routeName: z.literal("profile.achievements.get"),
  profileUserId: z.string(),
  page: z.object({
    cursorIn: z.string().nullable(),
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    sort: z.literal("earnedAtMs_desc"),
  }),
  items: z.array(ProfileAchievementPreviewItemSchema),
  degraded: z.boolean(),
  fallbacks: z.array(z.string()),
  debug: ProfileEndpointDebugSchema.optional(),
});

export const profileAchievementsContract = defineContract({
  routeName: "profile.achievements.get",
  method: "GET",
  path: "/v2/profiles/:userId/achievements",
  query: ProfileAchievementsQuerySchema,
  body: z.object({}).strict(),
  response: ProfileAchievementsResponseSchema,
});

export type ProfileAchievementsResponse = z.infer<typeof ProfileAchievementsResponseSchema>;
