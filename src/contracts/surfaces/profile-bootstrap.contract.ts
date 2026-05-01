import { z } from "zod";
import { defineContract } from "../conventions.js";

export const ProfileBootstrapParamsSchema = z.object({
  userId: z.string().min(6)
});

export const ProfileBootstrapQuerySchema = z.object({
  gridLimit: z.coerce.number().int().min(6).max(18).default(12),
  debugSlowDeferredMs: z.coerce.number().int().min(0).max(2000).default(0)
});

export const ProfileGridPreviewItemSchema = z.object({
  postId: z.string(),
  thumbUrl: z.string().url(),
  mediaType: z.enum(["image", "video"]),
  aspectRatio: z.number().positive().optional(),
  updatedAtMs: z.number().int().nonnegative(),
  processing: z.boolean().optional(),
  processingFailed: z.boolean().optional(),
  id: z.string().optional(),
  hydrationLevel: z.enum(["card", "detail", "marker"]).optional(),
  sourceRoute: z.string().optional(),
  rawPost: z.record(z.unknown()).nullable().optional(),
  sourcePost: z.record(z.unknown()).nullable().optional(),
  normalizedCard: z.record(z.unknown()).optional(),
  normalizedMedia: z.record(z.unknown()).optional(),
  normalizedAuthor: z.record(z.unknown()).optional(),
  normalizedLocation: z.record(z.unknown()).optional(),
  normalizedCounts: z.record(z.unknown()).optional(),
  comments: z.array(z.record(z.unknown())).optional(),
  commentsPreview: z.array(z.record(z.unknown())).optional(),
  assets: z.array(z.record(z.unknown())).optional(),
  author: z.record(z.unknown()).optional(),
  user: z.record(z.unknown()).optional(),
  hasPlayableVideo: z.boolean().optional(),
  hasAssetsArray: z.boolean().optional(),
  hasRawPost: z.boolean().optional(),
  hasEmbeddedComments: z.boolean().optional(),
  mediaResolutionSource: z.string().optional(),
}).passthrough();

export const ProfileBootstrapResponseSchema = z.object({
  routeName: z.literal("profile.bootstrap.get"),
  firstRender: z.object({
    profile: z.object({
      userId: z.string(),
      handle: z.string(),
      name: z.string(),
      profilePic: z.string().url().nullable(),
      followersCount: z.number().int().nonnegative(),
      followingCount: z.number().int().nonnegative(),
      numFollowers: z.number().int().nonnegative(),
      numFollowing: z.number().int().nonnegative(),
      bio: z.string().optional(),
      isOwnProfile: z.boolean()
    }),
    counts: z.object({
      posts: z.number().int().nonnegative(),
      followers: z.number().int().nonnegative(),
      following: z.number().int().nonnegative(),
      followersCount: z.number().int().nonnegative(),
      followingCount: z.number().int().nonnegative(),
      numFollowers: z.number().int().nonnegative(),
      numFollowing: z.number().int().nonnegative()
    }),
    stats: z.object({
      followersCount: z.number().int().nonnegative(),
      followingCount: z.number().int().nonnegative(),
      numFollowers: z.number().int().nonnegative(),
      numFollowing: z.number().int().nonnegative()
    }),
    relationship: z.object({
      isSelf: z.boolean(),
      following: z.boolean(),
      followedBy: z.boolean(),
      canMessage: z.boolean()
    }),
    tabs: z.array(
      z.object({
        id: z.enum(["grid", "saved", "likes", "map"]),
        enabled: z.boolean()
      })
    ),
    gridPreview: z.object({
      items: z.array(ProfileGridPreviewItemSchema),
      nextCursor: z.string().nullable()
    })
  }),
  deferred: z.object({
    profileBadgeSummary: z
      .object({
        badge: z.string(),
        score: z.number().int().nonnegative()
      })
      .nullable()
  }),
  background: z.object({
    cacheWarmScheduled: z.boolean(),
    prefetchHints: z.array(z.string())
  }),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const profileBootstrapContract = defineContract({
  routeName: "profile.bootstrap.get",
  method: "GET",
  path: "/v2/profiles/:userId/bootstrap",
  query: ProfileBootstrapQuerySchema,
  body: z.object({}).strict(),
  response: ProfileBootstrapResponseSchema
});

export type ProfileBootstrapResponse = z.infer<typeof ProfileBootstrapResponseSchema>;
