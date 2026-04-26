import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AchievementsLeaderboardAckBodySchema = z
  .object({
    eventId: z.string().min(1).max(256)
  })
  .strict();

export const AchievementsLeaderboardAckResponseSchema = z.object({
  routeName: z.literal("achievements.leaderboardack.post"),
  ok: z.literal(true),
  acknowledged: z.boolean(),
  recordedAtMs: z.number().int().nonnegative()
});

// invalidation: leaderboard ack updates viewer-specific notification/read state for achievements surfaces.
export const achievementsLeaderboardAckContract = defineContract({
  routeName: "achievements.leaderboardack.post",
  method: "POST",
  path: "/v2/achievements/ack-leaderboard-event",
  query: z.object({}).strict(),
  body: AchievementsLeaderboardAckBodySchema,
  response: AchievementsLeaderboardAckResponseSchema
});

export type AchievementsLeaderboardAckResponse = z.infer<typeof AchievementsLeaderboardAckResponseSchema>;
