import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementsCanonicalBadgeRowSchema } from "../entities/achievement-entities.contract.js";

export const AchievementsBadgesResponseSchema = z.object({
  routeName: z.literal("achievements.badges.get"),
  badges: z.array(AchievementsCanonicalBadgeRowSchema),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const achievementsBadgesContract = defineContract({
  routeName: "achievements.badges.get",
  method: "GET",
  path: "/v2/achievements/badges",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: AchievementsBadgesResponseSchema
});

export type AchievementsBadgesResponse = z.infer<typeof AchievementsBadgesResponseSchema>;
