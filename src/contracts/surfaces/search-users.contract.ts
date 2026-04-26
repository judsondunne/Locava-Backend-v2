import { z } from "zod";
import { defineContract } from "../conventions.js";
import { UserDiscoveryRowSchema } from "../entities/user-discovery-entities.contract.js";

export const SearchUsersQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(5).max(12).default(8),
  exclude: z.string().max(2000).optional()
});

export const SearchUsersResponseSchema = z.object({
  routeName: z.literal("search.users.get"),
  requestKey: z.string(),
  queryEcho: z.string(),
  page: z.object({
    cursorIn: z.string().nullable(),
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    sort: z.literal("search_users_relevance_v1")
  }),
  items: z.array(UserDiscoveryRowSchema),
  viewer: z.object({
    followingUserIds: z.array(z.string())
  }),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const searchUsersContract = defineContract({
  routeName: "search.users.get",
  method: "GET",
  path: "/v2/search/users",
  query: SearchUsersQuerySchema,
  body: z.object({}).strict(),
  response: SearchUsersResponseSchema
});

export type SearchUsersResponse = z.infer<typeof SearchUsersResponseSchema>;
