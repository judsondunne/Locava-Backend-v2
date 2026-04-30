import { z } from "zod";
import { defineContract } from "../conventions.js";
import { LegendsPreviewCardSchema } from "./legends-stage-post.contract.js";
import {
  CanonicalLegendItemSchema,
  LegendKindSchema,
  LegendFamilySchema,
  LegendDimensionSchema
} from "../entities/achievement-entities.contract.js";

export const LegendScopeSummarySchema = z.object({
  scopeId: z.string(),
  scopeType: z.string(),
  title: z.string(),
  subtitle: z.string(),
  totalPosts: z.number().int().nonnegative(),
  leaderUserId: z.string().nullable(),
  leaderCount: z.number().int().nonnegative(),
  viewerCount: z.number().int().nonnegative().optional(),
  viewerRank: z.number().int().positive().nullable().optional(),
  deltaToLeader: z.number().int().nonnegative().optional()
});

export const LegendAwardWireSchema = z.object({
  awardId: z.string(),
  awardType: z.string(),
  id: z.string().optional(),
  kind: LegendKindSchema.optional(),
  family: LegendFamilySchema.optional(),
  dimension: LegendDimensionSchema.optional(),
  iconContext: z.string().optional(),
  activityKey: z.string().nullable().optional(),
  activityLabel: z.string().nullable().optional(),
  locationKey: z.string().nullable().optional(),
  locationLabel: z.string().nullable().optional(),
  comboKey: z.string().nullable().optional(),
  rank: z.number().int().positive().nullable().optional(),
  isPermanent: z.boolean().optional(),
  claimedAt: z.unknown().optional(),
  updatedAt: z.unknown().optional(),
  sourcePostId: z.string().nullable().optional(),
  viewerStatus: z.string().optional(),
  displayPriority: z.number().int().nonnegative().optional(),
  scopeId: z.string(),
  scopeType: z.string(),
  title: z.string(),
  subtitle: z.string(),
  postId: z.string(),
  previousRank: z.number().int().positive().nullable(),
  newRank: z.number().int().positive().nullable(),
  userCount: z.number().int().nonnegative(),
  leaderCount: z.number().int().nonnegative(),
  deltaToLeader: z.number().int().nonnegative(),
  createdAt: z.unknown().optional(),
  seen: z.boolean().optional()
});

export const LegendEventWireSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  scopeId: z.string(),
  scopeType: z.string(),
  scopeTitle: z.string(),
  activityId: z.string().nullable().optional(),
  placeType: z.string().nullable().optional(),
  placeId: z.string().nullable().optional(),
  geohash: z.string().nullable().optional(),
  previousRank: z.number().int().positive().nullable(),
  newRank: z.number().int().positive().nullable(),
  previousLeaderCount: z.number().int().nonnegative(),
  newLeaderCount: z.number().int().nonnegative(),
  viewerCount: z.number().int().nonnegative(),
  deltaToReclaim: z.number().int().nonnegative(),
  overtakenByUserId: z.string().nullable(),
  sourcePostId: z.string(),
  createdAt: z.unknown().optional(),
  seen: z.boolean().optional()
});

export const LegendsMeBootstrapResponseSchema = z.object({
  routeName: z.literal("legends.me.bootstrap.get"),
  activeLegends: z.array(LegendScopeSummarySchema).max(12),
  closeToLegends: z.array(LegendScopeSummarySchema).max(12),
  recentAwards: z.array(LegendAwardWireSchema).max(20),
  firstLegends: z.array(CanonicalLegendItemSchema).max(64).optional(),
  rankLegends: z.array(CanonicalLegendItemSchema).max(64).optional(),
  recentEvents: z.array(LegendEventWireSchema).max(20),
  defense: z
    .object({
      atRisk: z.array(LegendScopeSummarySchema).max(12),
      lost: z.array(LegendEventWireSchema).max(12),
      reclaimable: z.array(LegendScopeSummarySchema).max(12)
    })
    .optional(),
  pendingGlobalModalEvent: LegendEventWireSchema.nullable().optional(),
  totals: z.object({
    activeLegendCount: z.number().int().nonnegative(),
    firstFinderCount: z.number().int().nonnegative(),
    topThreeCount: z.number().int().nonnegative()
  })
});

export const legendsMeBootstrapContract = defineContract({
  routeName: "legends.me.bootstrap.get",
  method: "GET",
  path: "/v2/legends/me/bootstrap",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: LegendsMeBootstrapResponseSchema
});

