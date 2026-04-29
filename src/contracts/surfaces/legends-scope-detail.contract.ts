import { z } from "zod";
import { defineContract } from "../conventions.js";

export const LegendsScopeDetailParamsSchema = z.object({
  scopeId: z.string().min(3)
});

export const LegendsScopeDetailResponseSchema = z.object({
  routeName: z.literal("legends.scope.get"),
  scope: z.object({
    scopeId: z.string(),
    scopeType: z.string(),
    title: z.string(),
    subtitle: z.string(),
    totalPosts: z.number().int().nonnegative(),
    leaderUserId: z.string().nullable(),
    leaderCount: z.number().int().nonnegative(),
    topUsers: z.array(z.object({ userId: z.string(), count: z.number().int().nonnegative() })).max(10)
  }),
  topUsers: z.array(z.object({ userId: z.string(), count: z.number().int().nonnegative() })).max(10),
  viewerRank: z.number().int().positive().nullable(),
  viewerCount: z.number().int().nonnegative(),
  deltaToLeader: z.number().int().nonnegative()
});

export const legendsScopeDetailContract = defineContract({
  routeName: "legends.scope.get",
  method: "GET",
  path: "/v2/legends/scopes/:scopeId",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: LegendsScopeDetailResponseSchema
});

