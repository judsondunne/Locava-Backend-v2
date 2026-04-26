import { z } from "zod";
import { defineContract } from "../conventions.js";
import { UserDiscoveryRowSchema } from "../entities/user-discovery-entities.contract.js";

export const DirectoryUsersQuerySchema = z.object({
  q: z.string().trim().max(80).optional().default(""),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(5).max(12).default(8),
  /** Comma-separated userIds to omit (e.g. already selected in a picker). Max 40. */
  exclude: z.string().max(2000).optional()
});

export const DirectoryUsersResponseSchema = z.object({
  routeName: z.literal("directory.users.get"),
  requestKey: z.string(),
  queryEcho: z.string(),
  page: z.object({
    cursorIn: z.string().nullable(),
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    sort: z.literal("directory_users_relevance_v1")
  }),
  items: z.array(UserDiscoveryRowSchema),
  viewer: z.object({
    followingUserIds: z.array(z.string())
  }),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const directoryUsersContract = defineContract({
  routeName: "directory.users.get",
  method: "GET",
  path: "/v2/directory/users",
  query: DirectoryUsersQuerySchema,
  body: z.object({}).strict(),
  response: DirectoryUsersResponseSchema
});

export type DirectoryUsersResponse = z.infer<typeof DirectoryUsersResponseSchema>;
