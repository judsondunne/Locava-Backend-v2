import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementClaimRewardPayloadSchema } from "../entities/achievement-entities.contract.js";

export const AchievementsClaimBodySchema = z.object({
  kind: z.enum(["weekly_capture", "badge", "challenge"]),
  id: z.string().min(1),
  source: z.enum(["static", "competitive"]).optional()
});

export const AchievementsClaimResponseSchema = z.object({
  routeName: z.literal("achievements.claim.post"),
  kind: AchievementsClaimBodySchema.shape.kind,
  id: z.string().min(1),
  source: z.enum(["static", "competitive"]).nullable(),
  reward: AchievementClaimRewardPayloadSchema,
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const achievementsClaimContract = defineContract({
  routeName: "achievements.claim.post",
  method: "POST",
  path: "/v2/achievements/claim",
  query: z.object({}).strict(),
  body: AchievementsClaimBodySchema,
  response: AchievementsClaimResponseSchema
});

export type AchievementsClaimResponse = z.infer<typeof AchievementsClaimResponseSchema>;
