import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementSnapshotSchema } from "../entities/achievement-entities.contract.js";

export const AchievementsSnapshotResponseSchema = z.object({
  routeName: z.literal("achievements.snapshot.get"),
  snapshot: AchievementSnapshotSchema,
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const achievementsSnapshotContract = defineContract({
  routeName: "achievements.snapshot.get",
  method: "GET",
  path: "/v2/achievements/snapshot",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: AchievementsSnapshotResponseSchema
});

export type AchievementsSnapshotResponse = z.infer<typeof AchievementsSnapshotResponseSchema>;
