import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementClaimRewardPayloadSchema } from "../entities/achievement-entities.contract.js";

export const AchievementsClaimIntroBonusBodySchema = z.object({}).strict();

export const AchievementsClaimIntroBonusResponseSchema = z.object({
  routeName: z.literal("achievements.claimintrobonus.post"),
  reward: AchievementClaimRewardPayloadSchema,
  alreadyClaimed: z.boolean(),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const achievementsClaimIntroBonusContract = defineContract({
  routeName: "achievements.claimintrobonus.post",
  method: "POST",
  path: "/v2/achievements/claim-intro-bonus",
  query: z.object({}).strict(),
  body: AchievementsClaimIntroBonusBodySchema,
  response: AchievementsClaimIntroBonusResponseSchema
});

export type AchievementsClaimIntroBonusResponse = z.infer<typeof AchievementsClaimIntroBonusResponseSchema>;
