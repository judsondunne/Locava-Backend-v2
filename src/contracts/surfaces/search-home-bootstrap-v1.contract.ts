import { z } from "zod";
import { defineContract, EmptySchema } from "../conventions.js";

const SearchHomeV1UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  handle: z.string(),
  profilePic: z.string().nullable(),
  bio: z.string(),
  followerCount: z.number().int().nonnegative(),
  followingCount: z.number().int().nonnegative(),
  postCount: z.number().int().nonnegative(),
});

const SearchHomeV1FirstPostSchema = z
  .object({
    id: z.string(),
    thumbnailUrl: z.string().nullable(),
    mediaType: z.enum(["photo", "video"]),
    activity: z.string(),
    createdAt: z.string(),
  })
  .nullable();

const SearchHomeV1SuggestedUserSchema = z.object({
  user: SearchHomeV1UserSchema,
  firstPost: SearchHomeV1FirstPostSchema,
  reason: z.string(),
});

const SearchHomeV1MixPostSchema = z.object({
  id: z.string(),
  thumbnailUrl: z.string().nullable(),
  mediaType: z.enum(["photo", "video"]),
  activity: z.string(),
  title: z.string().nullable(),
  placeName: z.string().nullable(),
  createdAt: z.string(),
});

const SearchHomeV1ActivityMixSchema = z.object({
  id: z.string(),
  title: z.string(),
  activityKey: z.string(),
  previewMode: z.enum(["one", "three"]),
  posts: z.array(SearchHomeV1MixPostSchema).max(3),
  nextCursor: z.string().nullable(),
});

const SearchHomeV1DebugSchema = z.object({
  routeName: z.literal("search.home_bootstrap.v1"),
  cacheStatus: z.enum(["hit", "miss", "bypass"]),
  latencyMs: z.number(),
  readCount: z.number().int().nonnegative(),
  payloadBytes: z.number().int().nonnegative(),
  suggestedUserCount: z.number().int().nonnegative(),
  suggestedUsersWithFirstPostCount: z.number().int().nonnegative(),
  activityMixCount: z.number().int().nonnegative(),
  postsPerMix: z.array(z.number().int().nonnegative()),
});

export const SearchHomeBootstrapV1QuerySchema = z.object({
  includeDebug: z
    .union([z.literal("1"), z.literal("0")])
    .optional()
    .transform((v) => v === "1"),
  bypassCache: z
    .union([z.literal("1"), z.literal("0")])
    .optional()
    .transform((v) => v === "1"),
});

export const SearchHomeBootstrapV1ResponseSchema = z.object({
  version: z.literal(1),
  viewerId: z.string(),
  generatedAt: z.string(),
  suggestedUsers: z.array(SearchHomeV1SuggestedUserSchema),
  /** Empty while activity rails are disabled; schema kept for forward compatibility. */
  activityMixes: z.array(SearchHomeV1ActivityMixSchema).max(8),
  debug: SearchHomeV1DebugSchema.optional(),
});

export const searchHomeBootstrapV1Contract = defineContract({
  routeName: "search.home_bootstrap.v1",
  method: "GET",
  path: "/v2/search/home-bootstrap",
  query: SearchHomeBootstrapV1QuerySchema,
  body: EmptySchema,
  response: SearchHomeBootstrapV1ResponseSchema,
});

/** GET /v2/search/mixes/:activityKey/page */
export const SearchMixActivityPageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(4).max(36).optional(),
  includeDebug: z
    .union([z.literal("1"), z.literal("0")])
    .optional()
    .transform((v) => v === "1"),
});

export const SearchMixActivityPageResponseSchema = z.object({
  version: z.literal(1),
  activityKey: z.string(),
  posts: z.array(SearchHomeV1MixPostSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  debug: z
    .object({
      routeName: z.literal("search.mixes.activity.page.get"),
      latencyMs: z.number(),
      readCount: z.number().int().nonnegative(),
    })
    .optional(),
});

export const searchMixActivityPageContract = defineContract({
  routeName: "search.mixes.activity.page.get",
  method: "GET",
  path: "/v2/search/mixes/:activityKey/page",
  query: SearchMixActivityPageQuerySchema,
  body: EmptySchema,
  response: SearchMixActivityPageResponseSchema,
});
