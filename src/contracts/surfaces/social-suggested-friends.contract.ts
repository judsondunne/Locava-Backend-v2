import { z } from "zod";
import { defineContract } from "../conventions.js";

export const SocialSuggestedFriendsQuerySchema = z.object({
  userId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).optional(),
  excludeUserIds: z.string().optional(),
  sortBy: z.enum(["default", "postCount"]).optional(),
  surface: z
    .enum(["onboarding", "profile", "search", "home", "notifications", "generic"])
    .optional()
});

export const SocialSuggestedFriendsResponseSchema = z.object({
  routeName: z.literal("social.suggested_friends.get"),
  viewerId: z.string().min(1),
  surface: z.enum(["onboarding", "profile", "search", "home", "notifications", "generic"]),
  users: z.array(
    z.object({
      userId: z.string().min(1),
      handle: z.string().nullable(),
      name: z.string().nullable(),
      profilePic: z.string().nullable(),
      reason: z.enum(["contacts", "referral", "groups", "mutuals", "popular", "nearby", "all_users"]),
      reasonLabel: z.string().max(120).nullable().optional(),
      mutualCount: z.number().int().nonnegative().optional(),
      mutualPreview: z
        .array(
          z.object({
            userId: z.string().min(1),
            handle: z.string().nullable().optional()
          })
        )
        .optional(),
      isFollowing: z.boolean(),
      followerCount: z.number().int().nonnegative().optional(),
      postCount: z.number().int().nonnegative().optional(),
      score: z.number().optional()
    })
  ),
  page: z.object({
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable()
  }),
  sourceBreakdown: z.record(z.number().int().nonnegative()),
  returnedCount: z.number().int().nonnegative(),
  generatedAt: z.number().int().positive(),
  etag: z.string().optional(),
  diagnostics: z
    .object({
      routeName: z.literal("social.suggested_friends.get"),
      viewerId: z.string().min(1),
      surface: z.enum(["onboarding", "profile", "search", "home", "notifications", "generic"]),
      returnedCount: z.number().int().nonnegative(),
      sourceBreakdown: z.record(z.number().int().nonnegative()),
      payloadBytes: z.number().int().nonnegative(),
      dbReads: z.number().int().nonnegative(),
      queryCount: z.number().int().nonnegative(),
      cache: z.object({
        hits: z.number().int().nonnegative(),
        misses: z.number().int().nonnegative()
      }),
      dedupeCount: z.number().int().nonnegative(),
      excludedAlreadyFollowingCount: z.number().int().nonnegative()
    })
    .optional()
});

export const socialSuggestedFriendsContract = defineContract({
  method: "GET",
  path: "/v2/social/suggested-friends",
  routeName: "social.suggested_friends.get",
  query: SocialSuggestedFriendsQuerySchema,
  body: z.object({}).strict(),
  response: SocialSuggestedFriendsResponseSchema
});
