import { z } from "zod";
import { defineContract } from "../conventions.js";
import {
  AchievementHeroSummarySchema,
  AchievementLeagueDefinitionSchema,
  AchievementSnapshotSchema
} from "../entities/achievement-entities.contract.js";
import { AchievementsClaimablesResponseSchema } from "./achievements-claimables.contract.js";

export const AchievementsBootstrapResponseSchema = z.object({
  routeName: z.literal("achievements.bootstrap.get"),
  hero: AchievementHeroSummarySchema,
  snapshot: AchievementSnapshotSchema,
  leagues: z.array(AchievementLeagueDefinitionSchema),
  claimables: AchievementsClaimablesResponseSchema.shape.claimables,
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const achievementsBootstrapContract = defineContract({
  routeName: "achievements.bootstrap.get",
  method: "GET",
  path: "/v2/achievements/bootstrap",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: AchievementsBootstrapResponseSchema
});

export type AchievementsBootstrapResponse = z.infer<typeof AchievementsBootstrapResponseSchema>;
