import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementLeaderboardScopeSchema } from "../entities/achievement-entities.contract.js";

export const AchievementsLeaderboardViewerRankParamsSchema = z.object({
  leaderboardKey: AchievementLeaderboardScopeSchema
});

export const AchievementsLeaderboardViewerRankResponseSchema = z.object({
  routeName: z.literal("achievements.leaderboardviewerrank.get"),
  leaderboardKey: AchievementLeaderboardScopeSchema,
  viewerRank: z.number().int().positive().nullable(),
  leagueId: z.string().nullable(),
  leagueName: z.string().nullable(),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const achievementsLeaderboardViewerRankContract = defineContract({
  routeName: "achievements.leaderboardviewerrank.get",
  method: "GET",
  path: "/v2/achievements/leaderboard/:leaderboardKey/viewer-rank",
  query: z
    .object({
      leagueId: z.string().max(128).optional()
    })
    .strict(),
  body: z.object({}).strict(),
  response: AchievementsLeaderboardViewerRankResponseSchema
});

export type AchievementsLeaderboardViewerRankResponse = z.infer<
  typeof AchievementsLeaderboardViewerRankResponseSchema
>;
