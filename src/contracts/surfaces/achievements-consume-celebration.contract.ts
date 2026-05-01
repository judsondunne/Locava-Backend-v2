import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementLeaguePassCelebrationSchema } from "../entities/achievement-entities.contract.js";

export const AchievementsConsumeCelebrationParamsSchema = z.object({
  celebrationId: z.string().min(1)
});

export const AchievementsConsumeCelebrationResponseSchema = z.object({
  routeName: z.literal("achievements.consumecelebration.post"),
  consumed: z.boolean(),
  celebration: AchievementLeaguePassCelebrationSchema.nullable(),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const achievementsConsumeCelebrationContract = defineContract({
  routeName: "achievements.consumecelebration.post",
  method: "POST",
  path: "/v2/achievements/celebrations/:celebrationId/consume",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: AchievementsConsumeCelebrationResponseSchema
});

export type AchievementsConsumeCelebrationResponse = z.infer<typeof AchievementsConsumeCelebrationResponseSchema>;
