import { z } from "zod";
import { defineContract } from "../conventions.js";
import { LegendAwardWireSchema } from "./legends-me-bootstrap.contract.js";
import { LegendRewardEnvelopeSchema } from "../entities/achievement-entities.contract.js";
import { AchievementLeaguePassCelebrationSchema } from "../entities/achievement-entities.contract.js";

export const LegendsAfterPostParamsSchema = z.object({
  postId: z.string().min(3)
});

export const LegendsAfterPostResponseSchema = z.object({
  routeName: z.literal("legends.afterpost.get"),
  postId: z.string(),
  status: z.enum(["pending", "ready", "none", "error"]),
  hasNewAwards: z.boolean(),
  shouldShowAwardScreen: z.boolean(),
  retryAfterMs: z.number().int().nonnegative(),
  processedAt: z.unknown().nullable().optional(),
  xpSettled: z.boolean().optional(),
  xpDelta: z.number().int().nonnegative().optional(),
  xpClaim: z
    .object({
      xpGained: z.number().int().nonnegative(),
      newTotalXP: z.number().int().nonnegative().nullable().optional(),
      newLevel: z.number().int().positive().nullable().optional(),
      tier: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  leaguePassCelebration: AchievementLeaguePassCelebrationSchema.nullable().optional(),
  pendingCelebrations: z.array(AchievementLeaguePassCelebrationSchema).optional(),
  reasonIfEmpty: z.string().nullable().optional(),
  legendStatus: z
    .object({
      activityKey: z.string().nullable(),
      activityLabel: z.string().nullable(),
      scopeKey: z.string().nullable(),
      scopeLabel: z.string().nullable(),
      currentRank: z.number().int().positive().nullable(),
      previousRank: z.number().int().positive().nullable(),
      podiumRank: z.number().int().positive().max(3).nullable(),
      distanceToLegend: z.number().int().nonnegative().nullable(),
      becameLegend: z.boolean()
    })
    .nullable()
    .optional(),
  awards: z.array(LegendAwardWireSchema).max(40),
  rewards: LegendRewardEnvelopeSchema.optional()
});

export const legendsAfterPostContract = defineContract({
  routeName: "legends.afterpost.get",
  method: "GET",
  path: "/v2/legends/after-post/:postId",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: LegendsAfterPostResponseSchema
});

