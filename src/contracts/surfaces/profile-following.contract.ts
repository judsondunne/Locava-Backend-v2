import { z } from "zod";
import { defineContract } from "../conventions.js";
import { UserDiscoveryRowSchema } from "../entities/user-discovery-entities.contract.js";

export const ProfileFollowingParamsSchema = z.object({
  userId: z.string().min(6)
});

export const ProfileFollowingQuerySchema = z.object({
  cursor: z.string().min(1).nullable().default(null),
  limit: z.coerce.number().int().min(10).max(200).default(50)
});

export const ProfileFollowingResponseSchema = z.object({
  routeName: z.literal("profile.following.get"),
  userId: z.string().min(6),
  totalCount: z.number().int().nonnegative(),
  items: z.array(UserDiscoveryRowSchema),
  page: z.object({
    nextCursor: z.string().nullable()
  }),
  degraded: z.boolean().optional()
});

export const profileFollowingContract = defineContract({
  routeName: "profile.following.get",
  method: "GET",
  path: "/v2/profiles/:userId/following",
  query: ProfileFollowingQuerySchema,
  body: z.object({}).strict(),
  response: ProfileFollowingResponseSchema
});

