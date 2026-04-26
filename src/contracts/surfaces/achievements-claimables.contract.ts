import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AchievementsClaimablesResponseSchema = z.object({
  routeName: z.literal("achievements.claimables.get"),
  claimables: z.object({
    totalCount: z.number().int().nonnegative(),
    weeklyCaptures: z.array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        xpReward: z.number().int().nonnegative()
      })
    ),
    badges: z.array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        source: z.enum(["static", "competitive"]),
        rewardPoints: z.number().int().nonnegative()
      })
    ),
    challenges: z.array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        rewardPoints: z.number().int().nonnegative()
      })
    )
  }),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const achievementsClaimablesContract = defineContract({
  routeName: "achievements.claimables.get",
  method: "GET",
  path: "/v2/achievements/claimables",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: AchievementsClaimablesResponseSchema
});

export type AchievementsClaimablesResponse = z.infer<typeof AchievementsClaimablesResponseSchema>;
