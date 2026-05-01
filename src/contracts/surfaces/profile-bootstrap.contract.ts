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
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  dominantColor: z.string().optional(),
  dominantGradient: z.array(z.string()).max(4).optional(),
  title: z.string().optional(),
  locationLabel: z.string().optional(),
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

export const ProfileUserSummarySchema = z.object({
  userId: z.string(),
  handle: z.string(),
  name: z.string(),
  displayName: z.string(),
  profilePic: z.string().url().nullable(),
  profilePicSmallPath: z.string().url().nullable().optional(),
  profilePicLargePath: z.string().url().nullable().optional(),
  bio: z.string().nullable(),
  followerCount: z.number().int().nonnegative(),
  followingCount: z.number().int().nonnegative(),
  postCount: z.number().int().nonnegative(),
  isFollowingViewer: z.boolean(),
  isViewer: z.boolean(),
  profileVersion: z.string().nullable().optional(),
  updatedAtMs: z.number().int().nonnegative().nullable().optional(),
});

export const ProfileCollectionPreviewItemSchema = z.object({
  collectionId: z.string(),
  ownerId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  privacy: z.enum(["friends", "public"]),
  itemCount: z.number().int().nonnegative(),
  coverUri: z.string().url().nullable(),
  coverPostId: z.string().nullable().optional(),
  coverMediaType: z.enum(["image", "video"]).nullable().optional(),
  coverThumbnailUrl: z.string().url().nullable().optional(),
  updatedAtMs: z.number().int().nonnegative(),
});

export const ProfileAchievementPreviewItemSchema = z.object({
  achievementId: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  iconUrl: z.string().url().nullable().optional(),
  emoji: z.string().nullable().optional(),
  badgeSource: z.enum(["static", "competitive"]),
  badgeType: z.enum(["activity", "region"]).nullable().optional(),
  earnedAtMs: z.number().int().nonnegative().nullable(),
  progressCurrent: z.number().int().nonnegative(),
  progressTarget: z.number().int().positive(),
  visibility: z.literal("public"),
});

const ProfilePreviewPageSchema = z.object({
  nextCursor: z.string().nullable(),
});

export const ProfileEndpointDebugSchema = z.object({
  timingsMs: z.record(z.number().nonnegative()),
  counts: z.object({
    grid: z.number().int().nonnegative(),
    collections: z.number().int().nonnegative(),
    achievements: z.number().int().nonnegative(),
  }),
  profilePicSource: z.string().nullable(),
  emptyReasons: z
    .object({
      collections: z.string().nullable(),
      achievements: z.string().nullable(),
    })
    .optional(),
  dbOps: z
    .object({
      reads: z.number().int().nonnegative(),
      writes: z.number().int().nonnegative(),
      queries: z.number().int().nonnegative(),
    })
    .optional(),
});

export const ProfileBootstrapResponseSchema = z.object({
  routeName: z.literal("profile.bootstrap.get"),
  profileUserId: z.string(),
  summary: ProfileUserSummarySchema,
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
    }),
    collectionsPreview: ProfilePreviewPageSchema.extend({
      items: z.array(ProfileCollectionPreviewItemSchema),
    }),
    achievementsPreview: ProfilePreviewPageSchema.extend({
      items: z.array(ProfileAchievementPreviewItemSchema),
    }),
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
  fallbacks: z.array(z.string()),
  debug: ProfileEndpointDebugSchema.optional(),
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
