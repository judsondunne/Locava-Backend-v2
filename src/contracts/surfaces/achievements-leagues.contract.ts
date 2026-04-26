import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementLeagueDefinitionSchema } from "../entities/achievement-entities.contract.js";

export const AchievementsLeaguesResponseSchema = z.object({
  routeName: z.literal("achievements.leagues.get"),
  leagues: z.array(AchievementLeagueDefinitionSchema),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const achievementsLeaguesContract = defineContract({
  routeName: "achievements.leagues.get",
  method: "GET",
  path: "/v2/achievements/leagues",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: AchievementsLeaguesResponseSchema
});

export type AchievementsLeaguesResponse = z.infer<typeof AchievementsLeaguesResponseSchema>;
