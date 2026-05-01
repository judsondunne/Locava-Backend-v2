import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementLeaguePassCelebrationSchema } from "../entities/achievement-entities.contract.js";

export const AchievementsPendingCelebrationsResponseSchema = z.object({
  routeName: z.literal("achievements.pendingcelebrations.get"),
  celebrations: z.array(AchievementLeaguePassCelebrationSchema),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const achievementsPendingCelebrationsContract = defineContract({
  routeName: "achievements.pendingcelebrations.get",
  method: "GET",
  path: "/v2/achievements/pending-celebrations",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: AchievementsPendingCelebrationsResponseSchema
});

export type AchievementsPendingCelebrationsResponse = z.infer<typeof AchievementsPendingCelebrationsResponseSchema>;
