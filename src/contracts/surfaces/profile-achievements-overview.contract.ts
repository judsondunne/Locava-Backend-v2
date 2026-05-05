import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementSnapshotSchema } from "../entities/achievement-entities.contract.js";

export const ProfileAchievementsOverviewParamsSchema = z.object({
  userId: z.string().min(6)
});

export const ProfileAchievementsOverviewResponseSchema = z.object({
  routeName: z.literal("profile.achievements_overview.get"),
  profileUserId: z.string(),
  snapshot: AchievementSnapshotSchema,
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const profileAchievementsOverviewContract = defineContract({
  routeName: "profile.achievements_overview.get",
  method: "GET",
  path: "/v2/profiles/:userId/achievements-overview",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: ProfileAchievementsOverviewResponseSchema
});

export type ProfileAchievementsOverviewResponse = z.infer<typeof ProfileAchievementsOverviewResponseSchema>;
