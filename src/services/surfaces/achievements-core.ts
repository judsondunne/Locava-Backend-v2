import type { Timestamp } from "firebase-admin/firestore";

export type LevelTier = {
  name: string;
  minLevel: number;
  maxLevel: number;
  xpPerLevel: number;
  color: string;
  icon: string;
};

export type AchievementChallengeDefinition = {
  id: string;
  name: string;
  description: string;
  target: number;
  rewardPoints: number;
  unitLabel: string;
  counterSource: "action_count" | "total_posts" | "following_count" | "referral_signup_count";
  actionKey?: string;
  active: boolean;
  order: number;
  color?: string;
  icon?: string;
  emoji?: string;
  ctaType?: "none" | "invite";
};

export type BadgeDefinitionRead = {
  id: string;
  category: string;
  name: string;
  description: string;
  emoji?: string;
  image?: string;
  iconUrl?: string;
  statKey: string;
  targetNumber: number;
  unlockOnce: boolean;
  rewardPoints: number;
  color?: string;
  type?: string;
  ruleType?: string;
  ruleParams?: unknown;
  active?: boolean;
  activityType?: string;
  minUserXP?: number;
  order?: number;
};

export const LEVEL_TIERS: LevelTier[] = [
  { name: "Beginner", minLevel: 1, maxLevel: 10, xpPerLevel: 100, color: "#9E9E9E", icon: "🌱" },
  { name: "Explorer", minLevel: 11, maxLevel: 25, xpPerLevel: 250, color: "#4CAF50", icon: "🧭" },
  { name: "Adventurer", minLevel: 26, maxLevel: 50, xpPerLevel: 500, color: "#2196F3", icon: "⛰️" },
  { name: "Champion", minLevel: 51, maxLevel: 75, xpPerLevel: 1000, color: "#9C27B0", icon: "👑" },
  { name: "Legend", minLevel: 76, maxLevel: 100, xpPerLevel: 2000, color: "#FF9800", icon: "⭐" }
];

export const XP_REWARDS = {
  post_create: 50,
  like: 2,
  comment: 5,
  save: 3,
  view: 1,
  invite_account_created: 50,
  trio_task_complete: 25,
  trio_all_complete: 100,
  weekly_quest_complete: 200,
  badge_easy: 150,
  badge_medium: 250,
  badge_hard: 500,
  badge_geo: 300,
  streak_milestone_3: 50,
  streak_milestone_7: 100,
  streak_milestone_14: 200,
  streak_milestone_30: 500
} as const;

export const DEFAULT_ACHIEVEMENT_CHALLENGES: AchievementChallengeDefinition[] = [
  {
    id: "post_20_spots",
    name: "Post 20 spots",
    description: "Create 20 posts to unlock this challenge.",
    target: 20,
    rewardPoints: 100,
    unitLabel: "posts",
    counterSource: "total_posts",
    active: true,
    order: 10,
    color: "#0f8f6f",
    icon: "📝",
    emoji: "📝",
    ctaType: "none"
  },
  {
    id: "comment_on_5_posts",
    name: "Comment on 5 posts",
    description: "Leave 5 comments across the app.",
    target: 5,
    rewardPoints: 100,
    unitLabel: "comments",
    counterSource: "action_count",
    actionKey: "comment",
    active: true,
    order: 20,
    color: "#2979ff",
    icon: "💬",
    emoji: "💬",
    ctaType: "none"
  },
  {
    id: "follow_50_people",
    name: "Follow 50 people",
    description: "Build your network by following 50 people.",
    target: 50,
    rewardPoints: 100,
    unitLabel: "follows",
    counterSource: "following_count",
    active: true,
    order: 30,
    color: "#8e44ad",
    icon: "👥",
    emoji: "👥",
    ctaType: "none"
  },
  {
    id: "invite_10_friends",
    name: "Invite 10 friends",
    description: "Invite friends and get credit when they actually make an account.",
    target: 10,
    rewardPoints: 100,
    unitLabel: "friends",
    counterSource: "referral_signup_count",
    active: true,
    order: 40,
    color: "#f39c12",
    icon: "✉️",
    emoji: "✉️",
    ctaType: "invite"
  }
];

export function calculateTotalXPForLevel(level: number): number {
  if (level <= 1) return 0;
  let totalXP = 0;
  for (let currentLevel = 1; currentLevel < level; currentLevel += 1) {
    const tier = LEVEL_TIERS.find((row) => currentLevel >= row.minLevel && currentLevel <= row.maxLevel);
    if (tier) totalXP += tier.xpPerLevel;
  }
  return totalXP;
}

export function calculateLevelFromXP(totalXP: number): {
  level: number;
  tier: LevelTier;
  progress: number;
  xpForNextLevel: number;
} {
  let level = 1;
  let accumulatedXP = 0;
  for (let currentLevel = 1; currentLevel <= 100; currentLevel += 1) {
    const tier = LEVEL_TIERS.find((row) => currentLevel >= row.minLevel && currentLevel <= row.maxLevel);
    if (!tier) break;
    const xpNeeded = tier.xpPerLevel;
    if (accumulatedXP + xpNeeded > totalXP) {
      level = currentLevel;
      break;
    }
    accumulatedXP += xpNeeded;
    if (currentLevel === 100) {
      level = 100;
      break;
    }
  }
  const tier = LEVEL_TIERS.find((row) => level >= row.minLevel && level <= row.maxLevel) ?? LEVEL_TIERS[0]!;
  const xpIntoCurrentLevel = totalXP - accumulatedXP;
  const xpForNextLevel = level === 100 ? 0 : tier.xpPerLevel;
  const progress =
    level === 100 || xpForNextLevel <= 0
      ? 100
      : Math.min(100, Math.round((xpIntoCurrentLevel / xpForNextLevel) * 100));
  return { level, tier, progress, xpForNextLevel };
}

export function buildXpState(totalXP: number): {
  current: number;
  level: number;
  levelProgress: number;
  tier: string;
} {
  const levelData = calculateLevelFromXP(Math.max(0, Math.floor(totalXP)));
  return {
    current: Math.max(0, Math.floor(totalXP)),
    level: levelData.level,
    levelProgress: levelData.progress,
    tier: levelData.tier.name
  };
}

export function getBadgeClaimReward(definition: Partial<BadgeDefinitionRead> | null | undefined): number {
  if (!definition) return 100;
  if (definition.type === "geo" || definition.ruleType === "GeoNearCity") return XP_REWARDS.badge_geo;
  const target = Math.max(0, Math.floor(Number(definition.targetNumber ?? 0) || 0));
  if (target <= 5) return XP_REWARDS.badge_easy;
  if (target <= 15) return XP_REWARDS.badge_medium;
  return XP_REWARDS.badge_hard;
}

export function toIsoString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  const seconds =
    typeof (value as { _seconds?: unknown })?._seconds === "number"
      ? (value as { _seconds: number })._seconds
      : typeof (value as { seconds?: unknown })?.seconds === "number"
        ? (value as { seconds: number }).seconds
        : null;
  return seconds != null ? new Date(seconds * 1000).toISOString() : null;
}

export function normalizeActivityId(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function getDateString(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getISOWeek(date = new Date()): string {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((copy.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function finiteInteger(value: unknown, fallback = 0): number {
  const n = finiteNumber(value, fallback);
  return Math.floor(n);
}

export function positiveIntegerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

export function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

export function clampPercent(value: unknown): number {
  return Math.max(0, Math.min(100, finiteInteger(value, 0)));
}

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function asStringArray(value: unknown): string[] {
  return asArray(value)
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

export function firestoreTimestampNowLike(): Timestamp | Date {
  return new Date();
}

