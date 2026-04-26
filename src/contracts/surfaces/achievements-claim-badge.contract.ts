import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementClaimRewardPayloadSchema } from "../entities/achievement-entities.contract.js";

export const AchievementsClaimBadgeBodySchema = z
  .object({
    badgeId: z.string().min(1).max(256)
  })
  .strict();

export const AchievementsClaimBadgeResponseSchema = z.object({
  routeName: z.literal("achievements.claimbadge.post"),
  reward: AchievementClaimRewardPayloadSchema,
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

// invalidation: claiming a badge updates achievements snapshot, status, and leaderboard projections.
export const achievementsClaimBadgeContract = defineContract({
  routeName: "achievements.claimbadge.post",
  method: "POST",
  path: "/v2/achievements/claim-badge",
  query: z.object({}).strict(),
  body: AchievementsClaimBadgeBodySchema,
  response: AchievementsClaimBadgeResponseSchema
});

export type AchievementsClaimBadgeResponse = z.infer<typeof AchievementsClaimBadgeResponseSchema>;
