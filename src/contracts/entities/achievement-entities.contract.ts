import { z } from "zod";

export const AchievementXpSchema = z.object({
  current: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  levelProgress: z.number().int().min(0).max(100),
  tier: z.string().min(1).max(64)
});

export const AchievementStreakSchema = z.object({
  current: z.number().int().nonnegative(),
  longest: z.number().int().nonnegative(),
  lastQualifiedAt: z.string().nullable()
});

export const AchievementHeroSummarySchema = z.object({
  xp: AchievementXpSchema,
  streak: AchievementStreakSchema,
  totalPosts: z.number().int().nonnegative(),
  globalRank: z.number().int().positive().nullable()
});

export const AchievementChallengeSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  counterSource: z.enum(["action_count", "following_count", "referral_signup_count", "total_posts"]),
  actionKey: z.string().nullable(),
  current: z.number().int().nonnegative(),
  target: z.number().int().positive(),
  completed: z.boolean(),
  claimable: z.boolean(),
  claimed: z.boolean()
});

export const AchievementWeeklyCaptureSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
  claimed: z.boolean(),
  xpReward: z.number().int().nonnegative()
});

export const AchievementBadgeSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  emoji: z.string().optional(),
  image: z.string().optional(),
  iconUrl: z.string().optional(),
  statKey: z.string().optional(),
  targetNumber: z.number().int().positive().optional(),
  rewardPoints: z.number().int().nonnegative().optional(),
  color: z.string().optional(),
  category: z.string().optional(),
  minUserXP: z.number().int().nonnegative().optional(),
  badgeSource: z.enum(["static", "competitive"]).optional(),
  badgeType: z.enum(["activity", "region"]).optional(),
  iconKey: z.string().optional(),
  activityKey: z.string().nullable().optional(),
  regionKey: z.string().nullable().optional(),
  earned: z.boolean(),
  claimed: z.boolean(),
  progress: z.object({
    current: z.number().int().nonnegative(),
    target: z.number().int().positive()
  })
});

export const AchievementPendingLeaderboardEventSchema = z.object({
  eventId: z.string(),
  kind: z.enum(["global", "friends", "community"]),
  prevRank: z.number().int().positive(),
  newRank: z.number().int().positive(),
  crossedCount: z.number().int().positive(),
  cityName: z.string().nullable()
});

export const LegendTopUserRowSchema = z.object({
  userId: z.string(),
  count: z.number().int().nonnegative()
});

export const AchievementLegendScopeSummarySchema = z.object({
  scopeId: z.string(),
  scopeType: z.string(),
  title: z.string(),
  subtitle: z.string(),
  totalPosts: z.number().int().nonnegative(),
  leaderUserId: z.string().nullable(),
  leaderCount: z.number().int().nonnegative(),
  viewerCount: z.number().int().nonnegative(),
  viewerRank: z.number().int().positive().nullable(),
  deltaToLeader: z.number().int().nonnegative()
});

export const AchievementLegendAwardSchema = z.object({
  awardId: z.string(),
  awardType: z.string(),
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

export const AchievementLegendsSliceSchema = z.object({
  activeLegends: z.array(AchievementLegendScopeSummarySchema).max(12),
  closeToLegends: z.array(AchievementLegendScopeSummarySchema).max(12),
  recentAwards: z.array(AchievementLegendAwardSchema).max(20)
});

export const AchievementSnapshotSchema = z.object({
  xp: AchievementXpSchema,
  streak: AchievementStreakSchema,
  totalPosts: z.number().int().nonnegative(),
  globalRank: z.number().int().positive().nullable(),
  challenges: z.array(AchievementChallengeSummarySchema),
  weeklyCapturesWeekOf: z.string().nullable(),
  weeklyCaptures: z.array(AchievementWeeklyCaptureSummarySchema),
  legends: AchievementLegendsSliceSchema.optional(),
  badges: z.array(AchievementBadgeSummarySchema),
  pendingLeaderboardEvent: AchievementPendingLeaderboardEventSchema.nullable()
});

export const AchievementPendingDeltaPayloadSchema = z.object({
  xpGained: z.number().int().nonnegative(),
  newTotalXP: z.number().int().nonnegative().nullable(),
  newLevel: z.number().int().positive().nullable(),
  tier: z.string().nullable(),
  deltaError: z.string().nullable()
});

export const AchievementPendingDeltaSchema = z.object({
  deltaId: z.string(),
  createdAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().nonnegative(),
  payload: AchievementPendingDeltaPayloadSchema
});

export const AchievementDeltaUiEventSchema = z.enum([
  "XP_TOAST",
  "LEVEL_UP_MODAL",
  "WEEKLY_CAPTURE_MODAL",
  "ACHIEVEMENT_PROGRESS_TOAST",
  "BADGE_UNLOCK_MODAL"
]);

export const AchievementProgressBumpSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  prev: z.number().int().nonnegative(),
  next: z.number().int().nonnegative(),
  target: z.number().int().positive().optional()
});

export const AchievementWeeklyCaptureDeltaSchema = z.object({
  captureId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  completed: z.boolean(),
  wasNewCompletion: z.boolean(),
  distanceMeters: z.number().nonnegative().optional(),
  xpReward: z.number().int().nonnegative().optional(),
  imageUrl: z.string().optional()
});

export const AchievementDeltaSchema = z.object({
  xpGained: z.number().int().nonnegative(),
  newTotalXP: z.number().int().nonnegative(),
  leveledUp: z.boolean().optional(),
  newLevel: z.number().int().positive().optional(),
  tier: z.string().min(1).max(64).optional(),
  progressBumps: z.array(AchievementProgressBumpSchema),
  weeklyCapture: AchievementWeeklyCaptureDeltaSchema.nullable().optional(),
  newlyUnlockedBadges: z.array(z.string().min(1)),
  uiEvents: z.array(AchievementDeltaUiEventSchema),
  competitiveBadgeUnlocks: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
        iconKey: z.string().optional(),
        xpAwarded: z.number().int().nonnegative().optional(),
        autoAwarded: z.boolean().optional()
      })
    )
    .optional(),
  postSuccessMessage: z.string().nullable().optional(),
  deltaError: z.string().nullable().optional()
});

/** Minimal viewer progression row for GET /v2/achievements/status (no challenges/captures). */
export const AchievementsCanonicalStatusSchema = z.object({
  xp: AchievementXpSchema,
  streak: AchievementStreakSchema,
  totalPosts: z.number().int().nonnegative(),
  globalRank: z.number().int().positive().nullable(),
  /** XP remaining until the next level threshold (derived; matches seeded hero math). */
  nextLevelXp: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  badgeCount: z.number().int().nonnegative(),
  earnedBadgeCount: z.number().int().nonnegative()
});

/** Single badge row for GET /v2/achievements/badges (canonical list shape). */
export const AchievementsCanonicalBadgeRowSchema = z.object({
  badgeId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  icon: z.string(),
  rarity: z.enum(["common", "uncommon", "rare", "epic", "legendary"]).optional(),
  unlocked: z.boolean(),
  unlockedAt: z.string().nullable(),
  progressCurrent: z.number().int().nonnegative(),
  progressTarget: z.number().int().positive(),
  claimed: z.boolean()
});

export const AchievementLeagueDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  minXP: z.number().int(),
  maxXP: z.number().int(),
  imageUrl: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().min(1).max(32),
  bgColor: z.string().min(1).max(32),
  order: z.number().int(),
  active: z.boolean()
});

export const AchievementLeaderboardScopeSchema = z.enum([
  "xp_global",
  "xp_league",
  "xp_friends",
  "xp_group",
  "posts_global",
  "posts_friends",
  "friends",
  "city"
]);

export const AchievementLeaderboardEntryReadSchema = z.object({
  rank: z.number().int().positive(),
  userId: z.string().min(1),
  userName: z.string().min(1),
  profilePic: z.string().nullable(),
  score: z.number().int().nonnegative(),
  totalPosts: z.number().int().nonnegative().optional(),
  level: z.number().int().nonnegative().optional(),
  tier: z.string().max(64).optional(),
  xpUpdatedAtMs: z.number().int().nonnegative().optional()
});

export const AchievementClaimRewardPayloadSchema = z.object({
  xpAwarded: z.number().int().nonnegative(),
  newTotalXP: z.number().int().nonnegative(),
  leveledUp: z.boolean(),
  newLevel: z.number().int().positive(),
  tier: z.string().min(1).max(64)
});

export type AchievementHeroSummary = z.infer<typeof AchievementHeroSummarySchema>;
export type AchievementSnapshot = z.infer<typeof AchievementSnapshotSchema>;
export type AchievementPendingDelta = z.infer<typeof AchievementPendingDeltaSchema>;
export type AchievementDelta = z.infer<typeof AchievementDeltaSchema>;
export type AchievementsCanonicalStatus = z.infer<typeof AchievementsCanonicalStatusSchema>;
export type AchievementsCanonicalBadgeRow = z.infer<typeof AchievementsCanonicalBadgeRowSchema>;
export type AchievementLeagueDefinition = z.infer<typeof AchievementLeagueDefinitionSchema>;
export type AchievementLeaderboardScope = z.infer<typeof AchievementLeaderboardScopeSchema>;
export type AchievementLeaderboardEntryRead = z.infer<typeof AchievementLeaderboardEntryReadSchema>;
export type AchievementClaimRewardPayload = z.infer<typeof AchievementClaimRewardPayloadSchema>;
