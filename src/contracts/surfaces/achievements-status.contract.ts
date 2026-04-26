import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementsCanonicalStatusSchema } from "../entities/achievement-entities.contract.js";

export const AchievementsStatusResponseSchema = z.object({
  routeName: z.literal("achievements.status.get"),
  status: AchievementsCanonicalStatusSchema,
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const achievementsStatusContract = defineContract({
  routeName: "achievements.status.get",
  method: "GET",
  path: "/v2/achievements/status",
  query: z
    .object({
      lat: z.string().max(32).optional(),
      long: z.string().max(32).optional()
    })
    .strict(),
  body: z.object({}).strict(),
  response: AchievementsStatusResponseSchema
});

export type AchievementsStatusResponse = z.infer<typeof AchievementsStatusResponseSchema>;
