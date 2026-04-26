import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementHeroSummarySchema } from "../entities/achievement-entities.contract.js";

export const AchievementsHeroResponseSchema = z.object({
  routeName: z.literal("achievements.hero.get"),
  hero: AchievementHeroSummarySchema,
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const achievementsHeroContract = defineContract({
  routeName: "achievements.hero.get",
  method: "GET",
  path: "/v2/achievements/hero",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: AchievementsHeroResponseSchema
});

export type AchievementsHeroResponse = z.infer<typeof AchievementsHeroResponseSchema>;
