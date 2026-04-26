import { z } from "zod";
import { defineContract } from "../conventions.js";

export const AchievementsScreenOpenedBodySchema = z
  .object({
    clientOpenedAtMs: z.number().int().nonnegative().optional()
  })
  .strict();

export const AchievementsScreenOpenedResponseSchema = z.object({
  routeName: z.literal("achievements.screenopened.post"),
  ok: z.literal(true),
  recordedAtMs: z.number().int().nonnegative()
});

// invalidation: screen-opened updates viewer-specific achievements seen state and badge surfacing.
export const achievementsScreenOpenedContract = defineContract({
  routeName: "achievements.screenopened.post",
  method: "POST",
  path: "/v2/achievements/screen-opened",
  query: z.object({}).strict(),
  body: AchievementsScreenOpenedBodySchema,
  response: AchievementsScreenOpenedResponseSchema
});

export type AchievementsScreenOpenedResponse = z.infer<typeof AchievementsScreenOpenedResponseSchema>;
