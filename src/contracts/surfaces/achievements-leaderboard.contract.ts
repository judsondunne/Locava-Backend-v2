import { z } from "zod";
import { defineContract } from "../conventions.js";
import {
  AchievementLeaderboardEntryReadSchema,
  AchievementLeaderboardScopeSchema
} from "../entities/achievement-entities.contract.js";

export const AchievementsLeaderboardParamsSchema = z.object({
  scope: AchievementLeaderboardScopeSchema
});

export const AchievementsLeaderboardResponseSchema = z.object({
  routeName: z.literal("achievements.leaderboard.get"),
  scope: AchievementLeaderboardScopeSchema,
  leaderboard: z.array(AchievementLeaderboardEntryReadSchema),
  viewerRank: z.number().int().positive().nullable(),
  cityName: z.string().nullable(),
  groupName: z.string().nullable(),
  leagueId: z.string().nullable(),
  leagueName: z.string().nullable(),
  leagueIconUrl: z.string().nullable(),
  leagueColor: z.string().nullable(),
  leagueBgColor: z.string().nullable(),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const achievementsLeaderboardContract = defineContract({
  routeName: "achievements.leaderboard.get",
  method: "GET",
  path: "/v2/achievements/leaderboard/:scope",
  query: z
    .object({
      leagueId: z.string().max(128).optional()
    })
    .strict(),
  body: z.object({}).strict(),
  response: AchievementsLeaderboardResponseSchema
});

export type AchievementsLeaderboardResponse = z.infer<typeof AchievementsLeaderboardResponseSchema>;
