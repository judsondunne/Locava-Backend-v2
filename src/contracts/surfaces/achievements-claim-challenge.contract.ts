import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementClaimRewardPayloadSchema } from "../entities/achievement-entities.contract.js";

export const AchievementsClaimChallengeBodySchema = z
  .object({
    challengeId: z.string().min(1).max(256)
  })
  .strict();

export const AchievementsClaimChallengeResponseSchema = z.object({
  routeName: z.literal("achievements.claimchallenge.post"),
  reward: AchievementClaimRewardPayloadSchema,
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

// invalidation: claiming a challenge updates achievements snapshot, status, and leaderboard projections.
export const achievementsClaimChallengeContract = defineContract({
  routeName: "achievements.claimchallenge.post",
  method: "POST",
  path: "/v2/achievements/claim-challenge",
  query: z.object({}).strict(),
  body: AchievementsClaimChallengeBodySchema,
  response: AchievementsClaimChallengeResponseSchema
});

export type AchievementsClaimChallengeResponse = z.infer<typeof AchievementsClaimChallengeResponseSchema>;
