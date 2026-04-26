import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementPendingDeltaSchema } from "../entities/achievement-entities.contract.js";

export const AchievementsPendingDeltaResponseSchema = z.object({
  routeName: z.literal("achievements.pendingdelta.get"),
  delta: AchievementPendingDeltaSchema.nullable(),
  pollAfterMs: z.number().int().positive(),
  serverSuggestedBackoffMs: z.number().int().positive(),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const achievementsPendingDeltaContract = defineContract({
  routeName: "achievements.pendingdelta.get",
  method: "GET",
  path: "/v2/achievements/pending-delta",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: AchievementsPendingDeltaResponseSchema
});

export type AchievementsPendingDeltaResponse = z.infer<typeof AchievementsPendingDeltaResponseSchema>;
