import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementClaimRewardPayloadSchema } from "../entities/achievement-entities.contract.js";

export const AchievementsClaimWeeklyCaptureBodySchema = z
  .object({
    captureId: z.string().min(1).max(256)
  })
  .strict();

export const AchievementsClaimWeeklyCaptureResponseSchema = z.object({
  routeName: z.literal("achievements.claimweeklycapture.post"),
  reward: AchievementClaimRewardPayloadSchema,
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

// invalidation: claiming weekly capture updates achievements snapshot, status, and leaderboard projections.
export const achievementsClaimWeeklyCaptureContract = defineContract({
  routeName: "achievements.claimweeklycapture.post",
  method: "POST",
  path: "/v2/achievements/claim-weekly-capture",
  query: z.object({}).strict(),
  body: AchievementsClaimWeeklyCaptureBodySchema,
  response: AchievementsClaimWeeklyCaptureResponseSchema
});

export type AchievementsClaimWeeklyCaptureResponse = z.infer<typeof AchievementsClaimWeeklyCaptureResponseSchema>;
