import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { globalCache } from "../../cache/global-cache.js";
import { invalidateRouteCacheByTags } from "../../cache/route-cache-index.js";
import { buildCacheKey } from "../../cache/types.js";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { scheduleBackgroundWork } from "../../lib/background-work.js";
import {
  type AchievementClaimRewardPayload,
  type AchievementHeroSummary,
  type AchievementLeaderboardEntryRead,
  type AchievementLeaderboardScope,
  type AchievementLeagueDefinition,
  type AchievementPendingDelta,
  type AchievementSnapshot,
  type AchievementsCanonicalBadgeRow,
  type AchievementsCanonicalStatus
} from "../../contracts/entities/achievement-entities.contract.js";
import type { AchievementsClaimablesResponse } from "../../contracts/surfaces/achievements-claimables.contract.js";
import type { AchievementsLeaguesResponse } from "../../contracts/surfaces/achievements-leagues.contract.js";
import { incrementDbOps, recordSurfaceTimings } from "../../observability/request-context.js";
import { legendRepository } from "../../domains/legends/legend.repository.js";
import {
  DEFAULT_ACHIEVEMENT_CHALLENGES,
  XP_REWARDS,
  asArray,
  asObject,
  buildXpState,
  calculateDistanceMeters,
  calculateTotalXPForLevel,
  clampPercent,
  type BadgeDefinitionRead,
  type AchievementChallengeDefinition,
  finiteInteger,
  finiteNumber,
  firstNonEmptyString,
  getBadgeClaimReward,
  getDateString,
  positiveIntegerOrNull,
  toIsoString
} from "../../services/surfaces/achievements-core.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";

type FirestoreMap = Record<string, unknown>;
type UserBadgeDoc = FirestoreMap & {
  badgeId?: string;
  earned?: boolean;
  claimed?: boolean;
  progress?: { current?: number; target?: number };
  earnedAt?: unknown;
  claimedAt?: unknown;
  visible?: boolean;
  shareCount?: number;
  lastUpdated?: unknown;
};
type CompetitiveBadgeDoc = FirestoreMap & {
  badgeKey?: string;
  badgeType?: string;
  title?: string;
  description?: string;
  iconKey?: string;
  activityKey?: string;
  regionKey?: string;
  regionName?: string;
  regionCode?: string;
  currentOwner?: boolean;
  claimed?: boolean;
  earnedAt?: unknown;
  countAtEarnTime?: number;
  xpAwarded?: boolean;
  ownershipVersion?: number;
  claimedOwnershipVersion?: number;
  xpAwardedOwnershipVersion?: number;
  lostAt?: unknown;
  lastOwnershipChangeAt?: unknown;
};

const DYNAMIC_LEADER_BADGE_KEYS = {
  global: "leader_top_global",
  friends: "leader_top_friends",
  community: "leader_top_community"
} as const;

function getCompetitiveOwnershipVersion(badge: CompetitiveBadgeDoc): number {
  return Math.max(1, finiteInteger(badge.ownershipVersion, 1));
}

function isCompetitiveBadgeClaimedForCurrentOwnership(badge: CompetitiveBadgeDoc): boolean {
  const version = getCompetitiveOwnershipVersion(badge);
  const claimedVersion = finiteInteger(badge.claimedOwnershipVersion, 0);
  const awardedVersion = finiteInteger(badge.xpAwardedOwnershipVersion, 0);
  if (claimedVersion >= version || awardedVersion >= version) return true;
  return badge.claimed === true || badge.xpAwarded === true;
}

export type AchievementWeeklyExploration = {
  currentWeek: string;
  postsThisWeek: number;
  status: "healthy" | "moderate" | "inactive";
  consecutiveWeeks: number;
  longestStreak: number;
  lastPostWeek: string;
  postDates: string[];
  postCountByDate: Record<string, number>;
  topActivities: string[];
};

const WEEKLY_STREAK_POST_LIMIT = 500;
const ACHIEVEMENTS_BOOTSTRAP_BADGE_LIMIT = 8;
const ACHIEVEMENTS_LEAGUES_CACHE_DOC_ID = "achievements_leagues_v2";
const ACHIEVEMENTS_LEAGUES_CACHE_TTL_MS = 10 * 60_000;
const ACHIEVEMENTS_SCREEN_OPENED_DEDUP_MS = 60_000;

export type LeaderboardReadModel = {
  scope: AchievementLeaderboardScope;
  entries: AchievementLeaderboardEntryRead[];
  viewerRank: number | null;
  cityName: string | null;
  groupName: string | null;
  leagueId: string | null;
  leagueName: string | null;
  leagueIconUrl: string | null;
  leagueColor: string | null;
  leagueBgColor: string | null;
};

export type AchievementBootstrapShellRead = {
  hero: AchievementHeroSummary;
  snapshot: AchievementSnapshot;
  leagues: AchievementLeagueDefinition[];
  claimables: {
    totalCount: number;
    weeklyCaptures: Array<{ id: string; title: string; xpReward: number }>;
    badges: Array<{ id: string; title: string; source: "static" | "competitive"; rewardPoints: number }>;
    challenges: Array<{ id: string; title: string; rewardPoints: number }>;
  };
  degraded: boolean;
  fallbacks: string[];
};

function pendingDeltaCacheKey(viewerId: string): string {
  return buildCacheKey("bootstrap", ["achievements-pending-delta-v2", viewerId]);
}

function achievementsStateCacheKey(viewerId: string): string {
  return buildCacheKey("bootstrap", ["achievements-state-v2", viewerId]);
}

function achievementsBadgesCacheKey(viewerId: string): string {
  return buildCacheKey("bootstrap", ["achievements-badges-v2", viewerId]);
}

function achievementsCompetitiveBadgesCacheKey(viewerId: string): string {
  return buildCacheKey("bootstrap", ["achievements-competitive-badges-v2", viewerId]);
}

function achievementsProgressCacheKey(viewerId: string): string {
  return buildCacheKey("bootstrap", ["achievements-progress-v2", viewerId]);
}

function achievementsScreenOpenedMarkerCacheKey(viewerId: string): string {
  return buildCacheKey("bootstrap", ["achievements-screen-opened-marker-v2", viewerId]);
}

function achievementsProgressSubsetCacheKey(viewerId: string, docIds: string[]): string {
  return buildCacheKey("bootstrap", ["achievements-progress-subset-v2", viewerId, ...docIds]);
}

function achievementsLeagueDefinitionsCacheKey(): string {
  return buildCacheKey("bootstrap", ["achievements-leagues-v2"]);
}

function achievementsBadgeDefinitionsCacheKey(): string {
  return buildCacheKey("bootstrap", ["achievements-badge-definitions-v2"]);
}

function achievementsActiveBadgeCountCacheKey(): string {
  return buildCacheKey("bootstrap", ["achievements-active-badge-count-v2"]);
}

function achievementsChallengeDefinitionsCacheKey(): string {
  return buildCacheKey("bootstrap", ["achievements-challenge-definitions-v2"]);
}

function achievementsWeeklyExplorationCacheKey(viewerId: string, maxPosts: number): string {
  return buildCacheKey("bootstrap", ["achievements-weekly-exploration-v2", viewerId, String(maxPosts)]);
}

function achievementsEarnedBadgeCountCacheKey(viewerId: string): string {
  return buildCacheKey("bootstrap", ["achievements-earned-badge-count-v2", viewerId]);
}

function getWeekIdentifier(date = new Date()): string {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(copy.setDate(diff));
  return monday.toISOString().split("T")[0] ?? getDateString(monday);
}

function toEpochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const iso = toIsoString(value);
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatActivityLabelForExploration(activityId: string): string {
  return activityId
    .split(/[_\s-]+/g)
    .map((part) => (part.length > 0 ? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}` : ""))
    .join(" ")
    .trim();
}

function buildProgressDocIdsForDefinitions(definitions: BadgeDefinitionRead[]): string[] {
  const docIds = new Set<string>();
  for (const definition of definitions) {
    const statKey = definition.statKey;
    if (definition.ruleType === "StreakDays" || statKey === "Streak Days") {
      continue;
    }
    if (statKey === "Posts Created" || statKey === "Total Posts") {
      docIds.add("total_posts");
      continue;
    }
    if (statKey === "Unique Spots" || statKey === "Places Visited") {
      docIds.add("unique_spots");
      continue;
    }
    if (statKey === "weekly_captures_completed" || definition.ruleType === "WeeklyCaptureCompletion") {
      docIds.add("weekly_captures_completed");
      continue;
    }
    if (definition.activityType) {
      docIds.add(`activity_${definition.activityType}`);
      continue;
    }
    if (statKey.startsWith("activity_")) {
      docIds.add(statKey);
      continue;
    }
    const normalizedKey = statKey.toLowerCase().replace(/\s+/g, "_");
    docIds.add(normalizedKey);
    if (normalizedKey !== statKey) {
      docIds.add(statKey);
    }
  }
  return [...docIds].sort((a, b) => a.localeCompare(b));
}

function toPostDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const iso = toIsoString(value);
  if (iso) {
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value > 10_000_000_000 ? value : value * 1000);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function normalizeChallengeDefinition(id: string, raw: FirestoreMap): AchievementChallengeDefinition {
  const counterSourceRaw = firstNonEmptyString(raw.counterSource) ?? "action_count";
  const counterSource =
    counterSourceRaw === "total_posts" ||
    counterSourceRaw === "following_count" ||
    counterSourceRaw === "referral_signup_count"
      ? counterSourceRaw
      : "action_count";
  return {
    id,
    name: firstNonEmptyString(raw.name) ?? id,
    description: firstNonEmptyString(raw.description) ?? "",
    target: Math.max(1, finiteInteger(raw.target, 1)),
    rewardPoints: Math.max(0, finiteInteger(raw.rewardPoints, 100)),
    unitLabel: firstNonEmptyString(raw.unitLabel) ?? "actions",
    counterSource,
    actionKey: firstNonEmptyString(raw.actionKey) ?? undefined,
    active: raw.active !== false,
    order: finiteInteger(raw.order, 999),
    color: firstNonEmptyString(raw.color) ?? "#1d7a52",
    icon: firstNonEmptyString(raw.icon) ?? "",
    emoji: firstNonEmptyString(raw.emoji) ?? "",
    ctaType: raw.ctaType === "invite" ? "invite" : "none"
  };
}

function normalizeBadgeDefinition(id: string, raw: FirestoreMap): BadgeDefinitionRead {
  const sanitizeAsset = (value: unknown): string | undefined => {
    const normalized = firstNonEmptyString(value);
    if (!normalized) return undefined;
    const lower = normalized.toLowerCase();
    if (lower.includes("via.placeholder.com") || lower.includes("placeholder")) {
      return undefined;
    }
    return normalized;
  };
  return {
    id,
    category: firstNonEmptyString(raw.category) ?? "standard",
    name: firstNonEmptyString(raw.name) ?? id,
    description: firstNonEmptyString(raw.description) ?? "",
    emoji: sanitizeAsset(raw.emoji),
    image: sanitizeAsset(raw.image),
    iconUrl: sanitizeAsset(raw.iconUrl),
    statKey: firstNonEmptyString(raw.statKey) ?? id,
    targetNumber: Math.max(1, finiteInteger(raw.targetNumber, 1)),
    unlockOnce: raw.unlockOnce !== false,
    rewardPoints: Math.max(0, finiteInteger(raw.rewardPoints, 0)),
    color: firstNonEmptyString(raw.color) ?? undefined,
    type: firstNonEmptyString(raw.type) ?? undefined,
    ruleType: firstNonEmptyString(raw.ruleType) ?? undefined,
    ruleParams: raw.ruleParams,
    active: raw.active !== false,
    activityType: firstNonEmptyString(raw.activityType) ?? undefined,
    minUserXP: Math.max(0, finiteInteger(raw.minUserXP, 0)),
    order: finiteInteger(raw.order, 999)
  };
}

function inferBadgeIcon(def: BadgeDefinitionRead): string {
  return def.emoji ?? def.iconUrl ?? def.image ?? "🏅";
}

function inferBadgeRarity(def: BadgeDefinitionRead): AchievementsCanonicalBadgeRow["rarity"] {
  const target = def.targetNumber;
  if (target >= 50) return "legendary";
  if (target >= 25) return "epic";
  if (target >= 15) return "rare";
  if (target >= 5) return "uncommon";
  return "common";
}

function mapPendingLeaderboardEvent(raw: FirestoreMap | undefined): AchievementSnapshot["pendingLeaderboardEvent"] {
  if (!raw) return null;
  const eventId = firstNonEmptyString(raw.eventId);
  if (!eventId) return null;
  const kindRaw = firstNonEmptyString(raw.kind) ?? "global";
  const kind = kindRaw === "friends" || kindRaw === "community" ? kindRaw : "global";
  return {
    eventId,
    kind,
    prevRank: Math.max(1, finiteInteger(raw.prevRank, finiteInteger(raw.previousRank, 1))),
    newRank: Math.max(1, finiteInteger(raw.newRank, finiteInteger(raw.rank, 1))),
    crossedCount: Math.max(1, finiteInteger(raw.crossedCount, finiteInteger(raw.passedCount, 1))),
    cityName: firstNonEmptyString(raw.cityName)
  };
}

function mapStateXp(stateDoc: FirestoreMap | null): AchievementSnapshot["xp"] {
  const xp = asObject(stateDoc?.xp);
  const current = Math.max(0, finiteInteger(xp.current, 0));
  const normalized = buildXpState(current);
  return {
    current,
    level: Math.max(1, finiteInteger(xp.level, normalized.level)),
    levelProgress: clampPercent(xp.levelProgress ?? normalized.levelProgress),
    tier: firstNonEmptyString(xp.tier) ?? normalized.tier
  };
}

function mapStateStreak(stateDoc: FirestoreMap | null): AchievementSnapshot["streak"] {
  const streak = asObject(stateDoc?.streak);
  return {
    current: Math.max(0, finiteInteger(streak.current, 0)),
    longest: Math.max(0, finiteInteger(streak.longest, 0)),
    lastQualifiedAt: toIsoString(streak.lastQualifiedAt)
  };
}

function mapLeagueCacheRow(raw: FirestoreMap, fallbackId: string): AchievementLeagueDefinition {
  return mapLeagueDocument(firstNonEmptyString(raw.id, raw.leagueId) ?? fallbackId, raw);
}

function mapLeagueDocument(id: string, raw: FirestoreMap): AchievementLeagueDefinition {
  return {
    id,
    title: firstNonEmptyString(raw.title) ?? id,
    description: firstNonEmptyString(raw.description) ?? undefined,
    minXP: finiteInteger(raw.minXP, 0),
    maxXP: finiteInteger(raw.maxXP, 0),
    imageUrl: firstNonEmptyString(raw.imageUrl),
    icon: firstNonEmptyString(raw.icon),
    color: firstNonEmptyString(raw.color) ?? "#0f766e",
    bgColor: firstNonEmptyString(raw.bgColor) ?? "#ecfeff",
    order: finiteInteger(raw.order, 999),
    active: raw.active !== false
  };
}

function mapCompetitiveBadgeSummary(docId: string, badge: CompetitiveBadgeDoc): AchievementSnapshot["badges"][number] {
  const owned = Boolean(badge.currentOwner);
  const claimedForOwnership = isCompetitiveBadgeClaimedForCurrentOwnership(badge);
  const badgeTypeRaw = firstNonEmptyString(badge.badgeType);
  const badgeType = badgeTypeRaw === "activity" || badgeTypeRaw === "region" ? badgeTypeRaw : undefined;
  return {
    id: firstNonEmptyString(badge.badgeKey) ?? docId,
    title: firstNonEmptyString(badge.title) ?? docId,
    description: firstNonEmptyString(badge.description) ?? undefined,
    iconUrl: firstNonEmptyString(badge.iconKey) ?? undefined,
    rewardPoints: 100,
    category: "competitive",
    badgeSource: "competitive",
    badgeType,
    iconKey: firstNonEmptyString(badge.iconKey) ?? undefined,
    activityKey: firstNonEmptyString(badge.activityKey) ?? null,
    regionKey: firstNonEmptyString(badge.regionKey) ?? null,
    ownershipVersion: getCompetitiveOwnershipVersion(badge),
    earned: owned,
    claimed: claimedForOwnership,
    progress: {
      current: Math.max(0, finiteInteger(badge.countAtEarnTime, owned ? 1 : 0)),
      target: Math.max(1, finiteInteger(badge.countAtEarnTime, 1))
    }
  };
}

export function isStaticAchievementBadge(
  badge: Pick<AchievementSnapshot["badges"][number], "badgeSource">
): boolean {
  return badge.badgeSource !== "competitive";
}

export function computeWeeklyExplorationFromPostRows(
  posts: Array<{
    createdAt?: unknown;
    time?: unknown;
    timestamp?: unknown;
    activities?: unknown;
  }>,
  now = new Date()
): AchievementWeeklyExploration {
  const currentWeek = getWeekIdentifier(now);
  const fallback: AchievementWeeklyExploration = {
    currentWeek,
    postsThisWeek: 0,
    status: "inactive",
    consecutiveWeeks: 0,
    longestStreak: 0,
    lastPostWeek: "",
    postDates: [],
    postCountByDate: {},
    topActivities: []
  };

  const sortedPosts = posts
    .map((post) => ({
      ...post,
      __date: toPostDate(post.time ?? post.createdAt ?? post.timestamp)
    }))
    .filter(
      (
        post
      ): post is typeof post & {
        __date: Date;
      } => post.__date instanceof Date && !Number.isNaN(post.__date.getTime())
    )
    .sort((a, b) => b.__date.getTime() - a.__date.getTime());

  if (sortedPosts.length === 0) {
    return {
      ...fallback,
      consecutiveWeeks: 1,
      longestStreak: 1
    };
  }

  const weekToCount = new Map<string, number>();
  const postDatesSet = new Set<string>();
  const postCountByDate = new Map<string, number>();
  const activityCounts = new Map<string, number>();

  for (const post of sortedPosts) {
    const week = getWeekIdentifier(post.__date);
    weekToCount.set(week, (weekToCount.get(week) ?? 0) + 1);
    const ymd = getDateString(post.__date);
    postDatesSet.add(ymd);
    postCountByDate.set(ymd, (postCountByDate.get(ymd) ?? 0) + 1);

    for (const activity of asArray(post.activities)) {
      const normalized = firstNonEmptyString(activity)?.toLowerCase();
      if (!normalized) continue;
      activityCounts.set(normalized, (activityCounts.get(normalized) ?? 0) + 1);
    }
  }

  const weeksSorted = [...weekToCount.keys()].sort().reverse();
  if (weeksSorted.length === 0) return fallback;
  const lastPostWeek = weeksSorted[0] ?? "";
  const postsThisWeek = weekToCount.get(currentWeek) ?? 0;
  const status = postsThisWeek >= 3 ? "healthy" : postsThisWeek >= 1 ? "moderate" : "inactive";

  let consecutiveWeeks = 0;
  const weekSet = new Set(weeksSorted);
  let check = new Date(`${lastPostWeek}T12:00:00.000Z`);
  for (let i = 0; i < 104; i += 1) {
    const week = getWeekIdentifier(check);
    if (!weekSet.has(week)) break;
    consecutiveWeeks += 1;
    check = new Date(check.getTime() - 7 * 86400000);
    if (check.getUTCDay() !== 1) {
      check.setUTCDate(check.getUTCDate() + 1);
    }
  }

  let longestStreak = 0;
  let run = 0;
  for (let i = 0; i < weeksSorted.length; i += 1) {
    const current = weeksSorted[i]!;
    const previous = weeksSorted[i - 1];
    const currentDate = new Date(`${current}T12:00:00.000Z`);
    const previousDate = previous ? new Date(`${previous}T12:00:00.000Z`) : null;
    const diffWeeks = previousDate ? Math.round((previousDate.getTime() - currentDate.getTime()) / (7 * 86400000)) : 1;
    run = diffWeeks === 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
  }

  const postCountByDateObject: Record<string, number> = {};
  for (const [ymd, count] of postCountByDate.entries()) {
    postCountByDateObject[ymd] = count;
  }

  return {
    currentWeek,
    postsThisWeek,
    status,
    consecutiveWeeks,
    longestStreak,
    lastPostWeek,
    postDates: [...postDatesSet].sort(),
    postCountByDate: postCountByDateObject,
    topActivities: [...activityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([activityId]) => formatActivityLabelForExploration(activityId))
      .filter(Boolean)
  };
}

function mapVisibleStreak(
  stateDoc: FirestoreMap | null,
  weeklyExploration: AchievementWeeklyExploration
): AchievementSnapshot["streak"] {
  const stored = mapStateStreak(stateDoc);
  return {
    ...stored,
    current: Math.max(0, weeklyExploration.consecutiveWeeks),
    longest: Math.max(0, weeklyExploration.longestStreak)
  };
}

function mapStoredWeeklyExploration(stateDoc: FirestoreMap | null): AchievementWeeklyExploration | null {
  const raw = asObject(stateDoc?.weeklyExploration);
  if (Object.keys(raw).length === 0) return null;
  return {
    currentWeek: firstNonEmptyString(raw.currentWeek) ?? getWeekIdentifier(),
    postsThisWeek: Math.max(0, finiteInteger(raw.postsThisWeek, 0)),
    status:
      raw.status === "healthy" || raw.status === "moderate" || raw.status === "inactive" ? raw.status : "inactive",
    consecutiveWeeks: Math.max(0, finiteInteger(raw.consecutiveWeeks, 0)),
    longestStreak: Math.max(0, finiteInteger(raw.longestStreak, 0)),
    lastPostWeek: firstNonEmptyString(raw.lastPostWeek) ?? "",
    postDates: asArray(raw.postDates).map((value) => String(value ?? "").trim()).filter(Boolean),
    postCountByDate: Object.fromEntries(
      Object.entries(asObject(raw.postCountByDate)).map(([date, count]) => [date, Math.max(0, finiteInteger(count, 0))])
    ),
    topActivities: asArray(raw.topActivities).map((value) => String(value ?? "").trim()).filter(Boolean)
  };
}

export function projectCanonicalStatusFromSnapshot(snapshot: AchievementSnapshot): AchievementsCanonicalStatus {
  const staticBadges = snapshot.badges.filter(isStaticAchievementBadge);
  const completedCount =
    snapshot.challenges.filter((row) => row.completed).length +
    snapshot.weeklyCaptures.filter((row) => row.completed).length +
    staticBadges.filter((row) => row.earned).length;
  const nextLevelTotalXp = calculateTotalXPForLevel(snapshot.xp.level + 1);
  const nextLevelXp = Math.max(0, nextLevelTotalXp - snapshot.xp.current);
  return {
    xp: snapshot.xp,
    streak: snapshot.streak,
    totalPosts: snapshot.totalPosts,
    globalRank: snapshot.globalRank,
    nextLevelXp,
    completedCount,
    badgeCount: staticBadges.length,
    earnedBadgeCount: staticBadges.filter((row) => row.earned).length
  };
}

export function projectCanonicalBadgeRowsFromSnapshot(snapshot: AchievementSnapshot): AchievementsCanonicalBadgeRow[] {
  return snapshot.badges.map((badge) => ({
    badgeId: badge.id,
    title: badge.title,
    description: badge.description ?? "",
    icon: badge.emoji ?? badge.iconUrl ?? badge.image ?? badge.iconKey ?? "🏅",
    ...(badge.badgeSource ? { badgeSource: badge.badgeSource } : {}),
    ...(badge.badgeType ? { badgeType: badge.badgeType } : {}),
    ...(badge.iconKey ? { iconKey: badge.iconKey } : {}),
    ...(badge.activityKey !== undefined ? { activityKey: badge.activityKey ?? null } : {}),
    ...(badge.regionKey !== undefined ? { regionKey: badge.regionKey ?? null } : {}),
    ...(badge.badgeSource === "competitive" ? { currentOwner: badge.earned } : {}),
    rarity:
      badge.progress.target >= 50
        ? "legendary"
        : badge.progress.target >= 25
          ? "epic"
          : badge.progress.target >= 15
            ? "rare"
            : badge.progress.target >= 5
              ? "uncommon"
              : "common",
    unlocked: badge.earned,
    unlockedAt: null,
    ...(badge.ownershipVersion != null ? { ownershipVersion: badge.ownershipVersion } : {}),
    progressCurrent: badge.progress.current,
    progressTarget: badge.progress.target,
    claimed: badge.claimed
  }));
}

export class AchievementsRepository {
  private leagueSnapshotWarmScheduled = false;
  private static readonly VERIFIED_POST_COUNT_TTL_MS = 5 * 60_000;
  private static readonly BOOTSTRAP_DOC_FIELD_MASK = [
    "numPosts",
    "postCount",
    "postsCount",
    "postCountVerifiedAtMs",
    "postCountVerifiedValue",
    "totalPosts",
    "challengeCounters",
    "claimedChallenges",
    "weeklyCaptures",
    "xp",
    "updatedAt",
    "achievementsScreenOpenedAt"
  ] as const;

  private requireDb() {
    const db = getFirestoreSourceClient();
    if (!db) throw new Error("firestore_source_required_for_achievements");
    return db;
  }

  private warmBootstrapShellCaches(viewerId: string): void {
    scheduleBackgroundWork(async () => {
      await (async () => {
        const [_leagues, badgeDefs] = await Promise.all([
          this.getLeagueDefinitions(),
          this.loadBootstrapBadgeDefinitions(ACHIEVEMENTS_BOOTSTRAP_BADGE_LIMIT)
        ]);
        const progressDocIds = buildProgressDocIdsForDefinitions(badgeDefs);
        await Promise.all([
          this.loadUserBadgeDocs(viewerId),
          progressDocIds.length > 0 ? this.loadProgressDocsByIds(viewerId, progressDocIds) : Promise.resolve(new Map())
        ]);
      })();
    });
  }

  async getHero(viewerId: string): Promise<AchievementHeroSummary> {
    const [userDoc, stateDoc, leagues, globalRank] = await Promise.all([
      this.loadUserDoc(viewerId),
      this.ensureAchievementStateDoc(viewerId),
      this.getLeagueDefinitions(),
      this.getViewerRankForMetric(viewerId, "xp.current")
    ]);
    const xp = mapStateXp(stateDoc);
    const weeklyExploration = mapStoredWeeklyExploration(stateDoc) ?? (await this.getWeeklyExploration(viewerId));
    const streak = mapVisibleStreak(stateDoc, weeklyExploration);
    const totalPosts = await this.getCanonicalTotalPosts(viewerId, stateDoc, undefined, userDoc);
    const currentLeague = this.resolveLeagueForXp(leagues, xp.current);
    return {
      xp: {
        current: xp.current,
        level: xp.level,
        levelProgress: xp.levelProgress,
        tier: currentLeague?.title ?? xp.tier
      },
      streak,
      totalPosts,
      globalRank
    };
  }

  async getCanonicalStatus(viewerId: string): Promise<AchievementsCanonicalStatus> {
    const [userDoc, stateDoc] = await Promise.all([
      this.loadUserDoc(viewerId),
      this.ensureAchievementStateDoc(viewerId)
    ]);
    const xp = mapStateXp(stateDoc);
    const storedWeeklyExploration = mapStoredWeeklyExploration(stateDoc);
    const streak = storedWeeklyExploration ? mapVisibleStreak(stateDoc, storedWeeklyExploration) : mapStateStreak(stateDoc);
    const totalPosts = await this.getCanonicalTotalPosts(viewerId, stateDoc, undefined, userDoc);
    const [globalRank, earnedBadgeCount, badgeCount] = await Promise.all([
      this.getViewerRankForMetric(viewerId, "xp.current", xp.current),
      this.getEarnedStaticBadgeCount(viewerId),
      this.getActiveStaticBadgeCount()
    ]);
    const weeklyCapturesData = asObject(stateDoc?.weeklyCaptures);
    const challengeCounters = asObject(stateDoc?.challengeCounters);
    const claimedChallenges = asObject(stateDoc?.claimedChallenges);
    const followingCount =
      Array.isArray(userDoc.following) ? userDoc.following.length : Math.max(0, finiteInteger(userDoc.numFollowing, 0));
    const referralSignupCount = Math.max(
      0,
      finiteInteger(userDoc.referralSignupCount, finiteInteger(challengeCounters.referral_signup_count, 0))
    );
    const completedChallengeCount = DEFAULT_ACHIEVEMENT_CHALLENGES.filter((def) => {
      const current =
        def.counterSource === "total_posts"
          ? totalPosts
          : def.counterSource === "following_count"
            ? followingCount
            : def.counterSource === "referral_signup_count"
              ? referralSignupCount
              : Math.max(0, finiteInteger(challengeCounters[def.actionKey ?? ""], 0));
      const claimedAt = firstNonEmptyString(claimedChallenges[def.id], asObject(claimedChallenges[def.id]).claimedAt);
      return current >= def.target || Boolean(claimedAt);
    }).length;
    const completedWeeklyCaptureCount = asArray<FirestoreMap>(weeklyCapturesData.captures).filter(
      (capture) => Boolean(asObject(capture).completed)
    ).length;
    return {
      xp,
      streak,
      totalPosts,
      globalRank,
      nextLevelXp: Math.max(0, calculateTotalXPForLevel(xp.level + 1) - xp.current),
      completedCount: completedChallengeCount + completedWeeklyCaptureCount + earnedBadgeCount,
      badgeCount,
      earnedBadgeCount
    };
  }

  async getSnapshot(viewerId: string): Promise<AchievementSnapshot> {
    const [userDoc, stateDoc, progressDocs, badgeDefs, userBadgeDocs, challengeDefs] =
      await Promise.all([
        this.loadUserDoc(viewerId),
        this.ensureAchievementStateDoc(viewerId),
        this.loadProgressDocs(viewerId),
        this.loadBadgeDefinitions(),
        this.loadUserBadgeDocs(viewerId),
        this.loadChallengeDefinitions()
      ]);
    await this.syncDynamicLeaderBadgesForViewer(viewerId);
    await globalCache.del(achievementsCompetitiveBadgesCacheKey(viewerId));
    const competitiveBadgeDocs = await this.loadCompetitiveBadgeDocs(viewerId);

    const xp = mapStateXp(stateDoc);
    const weeklyExploration = mapStoredWeeklyExploration(stateDoc) ?? (await this.getWeeklyExploration(viewerId));
    const streak = mapVisibleStreak(stateDoc, weeklyExploration);
    const totalPosts = await this.getCanonicalTotalPosts(viewerId, stateDoc, progressDocs, userDoc);
    const globalRank = await this.getViewerRankForMetric(viewerId, "xp.current", xp.current);
    const weeklyCapturesData = asObject(stateDoc?.weeklyCaptures);
    const challengeCounters = asObject(stateDoc?.challengeCounters);
    const claimedChallenges = asObject(stateDoc?.claimedChallenges);
    const followingCount =
      Array.isArray(userDoc.following) ? userDoc.following.length : Math.max(0, finiteInteger(userDoc.numFollowing, 0));
    const referralSignupCount = Math.max(
      0,
      finiteInteger(userDoc.referralSignupCount, finiteInteger(challengeCounters.referral_signup_count, 0))
    );

    const staticBadgeSummaries = badgeDefs.map((def) => {
      const userBadge = userBadgeDocs.get(def.id);
      const current = this.computeBadgeProgressValue(def, stateDoc, progressDocs);
      return {
        id: def.id,
        title: def.name,
        description: def.description || undefined,
        emoji: def.emoji ?? undefined,
        image: def.image ?? undefined,
        iconUrl: def.iconUrl ?? undefined,
        statKey: def.statKey,
        targetNumber: Math.max(1, def.targetNumber),
        rewardPoints: Math.max(0, def.rewardPoints ?? 0),
        color: def.color ?? undefined,
        category: def.category,
        minUserXP: Math.max(0, def.minUserXP ?? 0),
        badgeSource: "static" as const,
        earned: Boolean(userBadge?.earned),
        claimed: Boolean(userBadge?.claimed),
        progress: {
          current: Math.max(current, finiteInteger(asObject(userBadge?.progress).current, current)),
          target: Math.max(1, def.targetNumber)
        }
      };
    });
    const competitiveBadgeSummaries = [...competitiveBadgeDocs.entries()].map(([docId, badge]) =>
      mapCompetitiveBadgeSummary(docId, badge)
    );
    const badgeSummaries = [...staticBadgeSummaries, ...competitiveBadgeSummaries].sort((a, b) =>
      a.title.localeCompare(b.title)
    );

    const challengeSummaries = challengeDefs.map((def) => {
      let current = 0;
      switch (def.counterSource) {
        case "total_posts":
          current = totalPosts;
          break;
        case "following_count":
          current = followingCount;
          break;
        case "referral_signup_count":
          current = referralSignupCount;
          break;
        case "action_count":
        default:
          current = Math.max(0, finiteInteger(challengeCounters[def.actionKey ?? ""], 0));
          break;
      }
      const claimedAt = firstNonEmptyString(
        claimedChallenges[def.id],
        asObject(claimedChallenges[def.id]).claimedAt
      );
      const completed = current >= def.target || Boolean(claimedAt);
      return {
        id: def.id,
        title: def.name,
        counterSource: def.counterSource,
        actionKey: def.actionKey ?? null,
        current,
        target: def.target,
        completed,
        claimable: completed && !claimedAt,
        claimed: Boolean(claimedAt)
      };
    });

    const pendingLeaderboardEvents = asArray<FirestoreMap>(stateDoc?.pendingLeaderboardPassedEvents);

    return {
      xp,
      streak,
      totalPosts,
      globalRank,
      challenges: challengeSummaries,
      weeklyCapturesWeekOf: firstNonEmptyString(weeklyCapturesData.weekOf),
      weeklyCaptures: asArray<FirestoreMap>(weeklyCapturesData.captures).map((capture, index) => ({
        id: firstNonEmptyString(capture.id) ?? `capture-${index + 1}`,
        title:
          firstNonEmptyString(capture.title) ??
          firstNonEmptyString(capture.description) ??
          firstNonEmptyString(asObject(capture.location).address) ??
          `Capture ${index + 1}`,
        completed: Boolean(capture.completed),
        claimed: Boolean(capture.claimed),
        xpReward: Math.max(0, finiteInteger(capture.xpReward, 0))
      })),
      badges: badgeSummaries,
      pendingLeaderboardEvent: mapPendingLeaderboardEvent(pendingLeaderboardEvents[0])
    };
  }

  private async loadLegendsSlice(viewerId: string): Promise<NonNullable<AchievementSnapshot["legends"]>> {
    let db: ReturnType<typeof getFirestoreSourceClient> | null = null;
    try {
      db = this.requireDb();
    } catch {
      return { activeLegends: [], closeToLegends: [], recentAwards: [] };
    }
    try {
      const stateRef = legendRepository.userLegendsStateRef(viewerId);
      const stateSnap = await stateRef.get();
      incrementDbOps("reads", stateSnap.exists ? 1 : 0);
      const state = (stateSnap.data() as FirestoreMap | undefined) ?? {};
      const activeScopeIds = asArray<string>(state.activeScopeIds).map((v) => String(v ?? "")).filter(Boolean).slice(0, 4);
      const closeScopeIds = asArray<string>(state.closeScopeIds).map((v) => String(v ?? "")).filter(Boolean).slice(0, 4);
      const recentAwardIds = asArray<string>(state.recentAwardIds).map((v) => String(v ?? "")).filter(Boolean).slice(0, 8);

      const scopeIds = [...new Set([...activeScopeIds, ...closeScopeIds])];
      const scopeRefs = scopeIds.map((id) => legendRepository.scopeRef(id));
      const statRefs = scopeIds.map((id) => legendRepository.userStatRef(id, viewerId));
      const awardRefs = recentAwardIds.map((id) => legendRepository.awardRef(viewerId, id));

      const snaps = await db.getAll(...scopeRefs, ...statRefs, ...awardRefs);
      const scopeSnaps = snaps.slice(0, scopeRefs.length);
      const statSnaps = snaps.slice(scopeRefs.length, scopeRefs.length + statRefs.length);
      const awardSnaps = snaps.slice(scopeRefs.length + statRefs.length);
      incrementDbOps(
        "reads",
        snaps.reduce<number>((sum, snap) => sum + (snap.exists ? 1 : 0), 0)
      );

      const scopeById = new Map<string, FirestoreMap>();
      scopeSnaps.forEach((snap: (typeof scopeSnaps)[number], idx: number) => {
        const id = scopeIds[idx]!;
        if (snap.exists) scopeById.set(id, (snap.data() as FirestoreMap | undefined) ?? {});
      });
      const statByScopeId = new Map<string, FirestoreMap>();
      statSnaps.forEach((snap: (typeof statSnaps)[number], idx: number) => {
        const id = scopeIds[idx]!;
        if (snap.exists) statByScopeId.set(id, (snap.data() as FirestoreMap | undefined) ?? {});
      });

    const finiteInt = (value: unknown, fallback: number) => {
      if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
      if (typeof value === "string" && value.trim()) {
        const n = Number(value);
        if (Number.isFinite(n)) return Math.trunc(n);
      }
      return fallback;
    };

    const mapScopeSummary = (scopeId: string) => {
      const scope = scopeById.get(scopeId) ?? {};
      const stat = statByScopeId.get(scopeId) ?? {};
      const leaderCount = Math.max(0, finiteInt(scope.leaderCount, 0));
      const viewerCount = Math.max(0, finiteInt(stat.count, 0));
      const deltaToLeader = Math.max(0, leaderCount - viewerCount);
      return {
        scopeId,
        scopeType: String(scope.scopeType ?? "cell"),
        title: String(scope.title ?? "Local Legend"),
        subtitle: String(scope.subtitle ?? ""),
        totalPosts: Math.max(0, finiteInt(scope.totalPosts, 0)),
        leaderUserId: typeof scope.leaderUserId === "string" ? scope.leaderUserId : null,
        leaderCount,
        viewerCount,
        viewerRank: stat.rankSnapshot == null ? null : Math.max(1, finiteInt(stat.rankSnapshot, 1)),
        deltaToLeader
      };
    };

      const recentAwards = awardSnaps
        .filter((snap: (typeof awardSnaps)[number]) => snap.exists)
        .map(
          (snap: (typeof awardSnaps)[number]) => ((snap.data() as FirestoreMap | undefined) ?? {}) as FirestoreMap
        )
        .map((row: FirestoreMap) => ({
          awardId: String(row.awardId ?? ""),
          awardType: String(row.awardType ?? ""),
          scopeId: String(row.scopeId ?? ""),
          scopeType: String(row.scopeType ?? ""),
          title: String(row.title ?? ""),
          subtitle: String(row.subtitle ?? ""),
          postId: String(row.postId ?? ""),
          previousRank: row.previousRank == null ? null : Math.max(1, finiteInt(row.previousRank, 1)),
          newRank: row.newRank == null ? null : Math.max(1, finiteInt(row.newRank, 1)),
          userCount: Math.max(0, finiteInt(row.userCount, 0)),
          leaderCount: Math.max(0, finiteInt(row.leaderCount, 0)),
          deltaToLeader: Math.max(0, finiteInt(row.deltaToLeader, 0)),
          createdAt: row.createdAt,
          seen: row.seen === true
        }))
        .filter((a) => Boolean(a.awardId));

      return {
        activeLegends: activeScopeIds.map(mapScopeSummary),
        closeToLegends: closeScopeIds.map(mapScopeSummary),
        recentAwards
      };
    } catch {
      return { activeLegends: [], closeToLegends: [], recentAwards: [] };
    }
  }

  async getBootstrapShell(viewerId: string): Promise<AchievementBootstrapShellRead> {
    const [viewerDocs, cachedLeagues, cachedBadgeDefs, cachedUserBadgeEntries] = await Promise.all([
      this.loadBootstrapViewerDocs(viewerId),
      globalCache.get<AchievementLeagueDefinition[]>(achievementsLeagueDefinitionsCacheKey()),
      globalCache.get<BadgeDefinitionRead[]>(achievementsBadgeDefinitionsCacheKey()),
      globalCache.get<Array<[string, UserBadgeDoc]>>(achievementsBadgesCacheKey(viewerId))
    ]);
    const { userDoc, stateDoc } = viewerDocs;
    const badgeDefs = (cachedBadgeDefs ?? []).slice(0, ACHIEVEMENTS_BOOTSTRAP_BADGE_LIMIT);
    const progressDocIds = buildProgressDocIdsForDefinitions(badgeDefs);
    const cachedProgressEntries =
      progressDocIds.length > 0
        ? await globalCache.get<Array<[string, FirestoreMap]>>(achievementsProgressSubsetCacheKey(viewerId, progressDocIds))
        : [];
    const userBadgeDocs = new Map(cachedUserBadgeEntries ?? []);
    const progressDocs = new Map(cachedProgressEntries ?? []);
    const bootstrapDataStaged =
      cachedLeagues === undefined ||
      cachedBadgeDefs === undefined ||
      cachedUserBadgeEntries === undefined ||
      (progressDocIds.length > 0 && cachedProgressEntries === undefined);
    if (bootstrapDataStaged) {
      this.warmBootstrapShellCaches(viewerId);
      if (cachedLeagues === undefined) {
        this.queueLeagueDefinitionsSnapshotWarm();
      }
    }
    const leagues = cachedLeagues ?? [];
    const challengeCounters = asObject(stateDoc?.challengeCounters);
    const claimedChallenges = asObject(stateDoc?.claimedChallenges);
    const weeklyCapturesData = asObject(stateDoc?.weeklyCaptures);
    const weeklyExploration = mapStoredWeeklyExploration(stateDoc);
    const xp = mapStateXp(stateDoc);
    const totalPosts = await this.getCanonicalTotalPosts(viewerId, stateDoc, progressDocs, userDoc);
    const currentLeague = leagues.length > 0 ? this.resolveLeagueForXp(leagues, xp.current) : null;
    const streak = weeklyExploration ? mapVisibleStreak(stateDoc, weeklyExploration) : mapStateStreak(stateDoc);
    const challengeRewardsById = new Map(DEFAULT_ACHIEVEMENT_CHALLENGES.map((definition) => [definition.id, definition.rewardPoints]));
    const challengeSummaries = DEFAULT_ACHIEVEMENT_CHALLENGES.map((def) => {
      const current =
        def.counterSource === "total_posts"
          ? totalPosts
          : def.counterSource === "following_count"
            ? Math.max(0, finiteInteger(challengeCounters.following_count, 0))
            : def.counterSource === "referral_signup_count"
              ? Math.max(0, finiteInteger(challengeCounters.referral_signup_count, 0))
              : Math.max(0, finiteInteger(challengeCounters[def.actionKey ?? ""], 0));
      const claimedAt = firstNonEmptyString(claimedChallenges[def.id], asObject(claimedChallenges[def.id]).claimedAt);
      const completed = current >= def.target || Boolean(claimedAt);
      return {
        id: def.id,
        title: def.name,
        counterSource: def.counterSource,
        actionKey: def.actionKey ?? null,
        current,
        target: def.target,
        completed,
        claimable: completed && !claimedAt,
        claimed: Boolean(claimedAt)
      };
    });
    const weeklyCaptures = asArray<FirestoreMap>(weeklyCapturesData.captures).map((capture, index) => ({
      id: firstNonEmptyString(capture.id) ?? `capture-${index + 1}`,
      title:
        firstNonEmptyString(capture.title) ??
        firstNonEmptyString(capture.description) ??
        firstNonEmptyString(asObject(capture.location).address) ??
        `Capture ${index + 1}`,
      completed: Boolean(capture.completed),
      claimed: Boolean(capture.claimed),
      xpReward: Math.max(0, finiteInteger(capture.xpReward, 0))
    }));
    const staticBadgeSummaries = badgeDefs.map((def) => {
      const userBadge = userBadgeDocs.get(def.id);
      const current = this.computeBadgeProgressValue(def, stateDoc, progressDocs);
      return {
        id: def.id,
        title: def.name,
        description: def.description || undefined,
        emoji: def.emoji ?? undefined,
        image: def.image ?? undefined,
        iconUrl: def.iconUrl ?? undefined,
        statKey: def.statKey,
        targetNumber: Math.max(1, def.targetNumber),
        rewardPoints: Math.max(0, def.rewardPoints ?? 0),
        color: def.color ?? undefined,
        category: def.category,
        minUserXP: Math.max(0, def.minUserXP ?? 0),
        badgeSource: "static" as const,
        earned: Boolean(userBadge?.earned),
        claimed: Boolean(userBadge?.claimed),
        progress: {
          current: Math.max(current, finiteInteger(asObject(userBadge?.progress).current, current)),
          target: Math.max(1, def.targetNumber)
        }
      };
    });
    const legends = await this.loadLegendsSlice(viewerId);
    const snapshot: AchievementSnapshot = {
      xp: {
        ...xp,
        tier: currentLeague?.title ?? xp.tier
      },
      streak,
      totalPosts,
      globalRank: null,
      challenges: challengeSummaries,
      // Weekly captures are fully retired in favor of Legends (kept for backwards-compat wire shape).
      weeklyCapturesWeekOf: null,
      weeklyCaptures: [],
      legends,
      badges: staticBadgeSummaries,
      pendingLeaderboardEvent: mapPendingLeaderboardEvent(asArray<FirestoreMap>(stateDoc?.pendingLeaderboardPassedEvents)[0])
    };
    const claimables = {
      weeklyCaptures: [],
      badges: snapshot.badges
        .filter((badge) => badge.earned && !badge.claimed)
        .map((badge) => ({
          id: badge.id,
          title: badge.title,
          source: (badge.badgeSource === "competitive" ? "competitive" : "static") as "competitive" | "static",
          rewardPoints: Math.max(0, finiteInteger(badge.rewardPoints, 0))
        })),
      challenges: snapshot.challenges
        .filter((challenge) => challenge.claimable && !challenge.claimed)
        .map((challenge) => ({
          id: challenge.id,
          title: challenge.title,
          rewardPoints:
            DEFAULT_ACHIEVEMENT_CHALLENGES.find((definition) => definition.id === challenge.id)?.rewardPoints ?? 0
        }))
    };

    return {
      hero: {
        xp: snapshot.xp,
        streak: snapshot.streak,
        totalPosts: snapshot.totalPosts,
        globalRank: null
      },
      snapshot,
      leagues,
      claimables: {
        ...claimables,
        totalCount: claimables.badges.length + claimables.challenges.length
      },
      degraded: leagues.length === 0 || bootstrapDataStaged,
      fallbacks: [
        ...(leagues.length > 0 ? [] : ["achievement_leagues_staged"]),
        ...(cachedBadgeDefs !== undefined ? [] : ["achievement_badge_definitions_staged"]),
        ...(cachedUserBadgeEntries !== undefined ? [] : ["achievement_user_badges_staged"]),
        ...(progressDocIds.length === 0 || cachedProgressEntries !== undefined ? [] : ["achievement_badge_progress_staged"]),
        "achievement_global_rank_staged",
        "achievement_competitive_badges_staged"
      ]
    };
  }

  async getClaimables(viewerId: string): Promise<{
    totalCount: number;
    weeklyCaptures: Array<{ id: string; title: string; xpReward: number }>;
    badges: Array<{ id: string; title: string; source: "static" | "competitive"; rewardPoints: number }>;
    challenges: Array<{ id: string; title: string; rewardPoints: number }>;
  }> {
    const surface = await this.getClaimablesSurface(viewerId);
    return surface.claimables;
  }

  async getClaimablesSurface(viewerId: string): Promise<Pick<AchievementsClaimablesResponse, "claimables" | "degraded" | "fallbacks">> {
    const cachedClaimablesResponse = await globalCache.get<AchievementsClaimablesResponse>(
      buildCacheKey("bootstrap", ["achievements-claimables-v1", viewerId])
    );
    if (cachedClaimablesResponse?.claimables) {
      return {
        claimables: cachedClaimablesResponse.claimables,
        degraded: cachedClaimablesResponse.degraded,
        fallbacks: cachedClaimablesResponse.fallbacks
      };
    }
    const cachedBootstrap = await globalCache.get<AchievementBootstrapShellRead>(
      buildCacheKey("bootstrap", ["achievements-bootstrap-v1", viewerId])
    );
    if (cachedBootstrap?.claimables) {
      return {
        claimables: cachedBootstrap.claimables,
        degraded: cachedBootstrap.degraded,
        fallbacks: cachedBootstrap.fallbacks
      };
    }
    const [viewerDocs, cachedBadgeDefs, cachedUserBadgeEntries] = await Promise.all([
      this.loadBootstrapViewerDocs(viewerId),
      globalCache.get<BadgeDefinitionRead[]>(achievementsBadgeDefinitionsCacheKey()),
      globalCache.get<Array<[string, UserBadgeDoc]>>(achievementsBadgesCacheKey(viewerId))
    ]);
    const { userDoc, stateDoc } = viewerDocs;
    const badgeDefs = (cachedBadgeDefs ?? []).slice(0, ACHIEVEMENTS_BOOTSTRAP_BADGE_LIMIT);
    const userBadgeDocs = new Map(cachedUserBadgeEntries ?? []);
    const degraded = cachedBadgeDefs === undefined || cachedUserBadgeEntries === undefined;
    if (degraded) {
      this.warmBootstrapShellCaches(viewerId);
    }
    const challengeCounters = asObject(stateDoc?.challengeCounters);
    const claimedChallenges = asObject(stateDoc?.claimedChallenges);
    const weeklyCapturesData = asObject(stateDoc?.weeklyCaptures);
    const totalPosts = await this.getCanonicalTotalPosts(viewerId, stateDoc, undefined, userDoc);

    const weeklyCaptures = asArray<FirestoreMap>(weeklyCapturesData.captures)
      .map((capture, index) => ({
        id: firstNonEmptyString(capture.id) ?? `capture-${index + 1}`,
        title:
          firstNonEmptyString(capture.title) ??
          firstNonEmptyString(capture.description) ??
          firstNonEmptyString(asObject(capture.location).address) ??
          `Capture ${index + 1}`,
        xpReward: Math.max(0, finiteInteger(capture.xpReward, 0)),
        completed: Boolean(capture.completed),
        claimed: Boolean(capture.claimed)
      }))
      .filter((capture) => capture.completed && !capture.claimed)
      .map(({ completed: _completed, claimed: _claimed, ...capture }) => capture);

    const badges = badgeDefs
      .map((def) => ({
        id: def.id,
        title: def.name,
        source: "static" as const,
        rewardPoints: Math.max(0, finiteInteger(def.rewardPoints, 0)),
        earned: Boolean(userBadgeDocs.get(def.id)?.earned),
        claimed: Boolean(userBadgeDocs.get(def.id)?.claimed)
      }))
      .filter((badge) => badge.earned && !badge.claimed)
      .map(({ earned: _earned, claimed: _claimed, ...badge }) => badge);

    const challenges = DEFAULT_ACHIEVEMENT_CHALLENGES.map((def) => {
      const current =
        def.counterSource === "total_posts"
          ? totalPosts
          : def.counterSource === "following_count"
            ? Math.max(0, finiteInteger(challengeCounters.following_count, 0))
            : def.counterSource === "referral_signup_count"
              ? Math.max(0, finiteInteger(challengeCounters.referral_signup_count, 0))
              : Math.max(0, finiteInteger(challengeCounters[def.actionKey ?? ""], 0));
      const claimedAt = firstNonEmptyString(claimedChallenges[def.id], asObject(claimedChallenges[def.id]).claimedAt);
      if (current < def.target || claimedAt) return null;
      return {
        id: def.id,
        title: def.name,
        rewardPoints: Math.max(0, finiteInteger(def.rewardPoints, 0))
      };
    }).filter((row): row is { id: string; title: string; rewardPoints: number } => Boolean(row));

    return {
      claimables: {
        totalCount: weeklyCaptures.length + badges.length + challenges.length,
        weeklyCaptures,
        badges,
        challenges
      },
      degraded,
      fallbacks: [
        ...(cachedBadgeDefs !== undefined ? [] : ["achievement_badge_definitions_staged"]),
        ...(cachedUserBadgeEntries !== undefined ? [] : ["achievement_user_badges_staged"]),
        "achievement_competitive_badges_staged"
      ]
    };
  }

  async recordScreenOpened(viewerId: string): Promise<{ recordedAtMs: number }> {
    const db = this.requireDb();
    const [cachedMarker, cachedState] = await Promise.all([
      globalCache.get<{ recordedAtMs?: unknown } | null>(achievementsScreenOpenedMarkerCacheKey(viewerId)),
      globalCache.get<FirestoreMap | null>(achievementsStateCacheKey(viewerId))
    ]);
    const cachedRecordedAtMs =
      toEpochMs(cachedMarker?.recordedAtMs) ?? toEpochMs(cachedState?.achievementsScreenOpenedAt);
    if (cachedRecordedAtMs != null && Date.now() - cachedRecordedAtMs <= ACHIEVEMENTS_SCREEN_OPENED_DEDUP_MS) {
      return { recordedAtMs: cachedRecordedAtMs };
    }
    const recordedAtMs = Date.now();
    const stateRef = db.collection("users").doc(viewerId).collection("achievements").doc("state");
    const payload = {
      achievementsScreenOpenedAt: new Date(recordedAtMs),
      updatedAt: new Date(recordedAtMs)
    };
    const persistState = async (): Promise<void> => {
      try {
        await stateRef.update(payload);
      } catch {
        await stateRef.set(payload, { merge: true });
      }
    };
    await globalCache
      .set(
        achievementsScreenOpenedMarkerCacheKey(viewerId),
        { recordedAtMs },
        Math.max(ACHIEVEMENTS_SCREEN_OPENED_DEDUP_MS, 15_000)
      )
      .catch(() => undefined);
    if (cachedState && typeof cachedState === "object") {
      const cachedStateObject = cachedState as FirestoreMap;
      await globalCache
        .set(
          achievementsStateCacheKey(viewerId),
          {
            ...cachedStateObject,
            achievementsScreenOpenedAt: payload.achievementsScreenOpenedAt,
            updatedAt: payload.updatedAt
          },
          15_000
        )
        .catch(() => undefined);
      scheduleBackgroundWork(async () => {
        await persistState();
        await this.clearScreenOpenedCaches(viewerId);
      });
      return { recordedAtMs };
    }
    scheduleBackgroundWork(async () => {
      const writeStartedAt = performance.now();
      await persistState();
      recordSurfaceTimings({
        achievements_screen_opened_write_ms: performance.now() - writeStartedAt
      });
      await this.clearScreenOpenedCaches(viewerId);
    });
    return { recordedAtMs };
  }

  async takePendingDelta(viewerId: string): Promise<AchievementPendingDelta | null> {
    incrementDbOps("queries", 1);
    const key = pendingDeltaCacheKey(viewerId);
    const cached = await globalCache.get<AchievementPendingDelta>(key);
    if (!cached) return null;
    await globalCache.del(key);
    incrementDbOps("writes", 1);
    return cached;
  }

  async pushPendingDelta(viewerId: string, delta: AchievementPendingDelta): Promise<void> {
    await globalCache.set(pendingDeltaCacheKey(viewerId), delta, Math.max(1000, delta.expiresAtMs - Date.now()));
  }

  seedPendingDelta(viewerId: string, delta?: Partial<AchievementPendingDelta["payload"]>): void {
    const now = Date.now();
    void this.pushPendingDelta(viewerId, {
      deltaId: `delta-${viewerId}-${now}`,
      createdAtMs: now,
      expiresAtMs: now + 60_000,
      payload: {
        xpGained: Math.max(0, finiteInteger(delta?.xpGained, 0)),
        newTotalXP: delta?.newTotalXP ?? null,
        newLevel: delta?.newLevel ?? null,
        tier: delta?.tier ?? null,
        deltaError: delta?.deltaError ?? null
      }
    });
  }

  async getLeagueDefinitions(): Promise<AchievementLeagueDefinition[]> {
    const cached = await globalCache.get<AchievementLeagueDefinition[]>(achievementsLeagueDefinitionsCacheKey());
    if (cached !== undefined) return cached;
    const cachedBootstrap = await globalCache.get<AchievementBootstrapShellRead>(
      buildCacheKey("bootstrap", ["achievements-bootstrap-v1", "all"])
    );
    if (cachedBootstrap?.leagues?.length) {
      return cachedBootstrap.leagues;
    }
    const cachedLeaguesResponse = await globalCache.get<AchievementsLeaguesResponse>(
      buildCacheKey("bootstrap", ["achievements-leagues-v1"])
    );
    if (cachedLeaguesResponse?.leagues) {
      void globalCache
        .set(achievementsLeagueDefinitionsCacheKey(), cachedLeaguesResponse.leagues, ACHIEVEMENTS_LEAGUES_CACHE_TTL_MS)
        .catch(() => undefined);
      return cachedLeaguesResponse.leagues;
    }
    const snapshotLeagues = await this.loadLeagueDefinitionsSnapshot();
    if (snapshotLeagues) {
      return snapshotLeagues;
    }
    this.queueLeagueDefinitionsSnapshotWarm();
    return [];
  }

  async getLeaderboardRead(
    viewerId: string,
    scope: AchievementLeaderboardScope,
    leagueId?: string | null
  ): Promise<LeaderboardReadModel> {
    switch (scope) {
      case "xp_global":
        return this.getGlobalMetricLeaderboard(viewerId, scope, "xp.current");
      case "xp_league":
        return this.getLeagueXpLeaderboard(viewerId, leagueId);
      case "xp_friends":
      case "friends":
        return this.getFriendsLeaderboard(viewerId, scope, "xp.current");
      case "posts_global":
        return this.getGlobalMetricLeaderboard(viewerId, scope, "totalPosts");
      case "posts_friends":
        return this.getFriendsLeaderboard(viewerId, scope, "totalPosts");
      case "city":
        return this.getCityLeaderboard(viewerId);
      case "xp_group":
        return this.getGroupLeaderboard(viewerId);
      default:
        return {
          scope,
          entries: [],
          viewerRank: null,
          cityName: null,
          groupName: null,
          leagueId: null,
          leagueName: null,
          leagueIconUrl: null,
          leagueColor: null,
          leagueBgColor: null
        };
    }
  }

  async recordLeaderboardAck(viewerId: string, eventId: string): Promise<{ recordedAtMs: number; acknowledged: boolean }> {
    const db = this.requireDb();
    const stateRef = db.collection("users").doc(viewerId).collection("achievements").doc("state");
    const cachedState = await globalCache.get<FirestoreMap | null>(achievementsStateCacheKey(viewerId));
    const data =
      cachedState !== undefined
        ? cachedState ?? {}
        : await stateRef.get().then((stateDoc) => {
            incrementDbOps("reads", stateDoc.exists ? 1 : 0);
            return (stateDoc.data() as FirestoreMap | undefined) ?? {};
          });
    const existing = asArray<FirestoreMap>(data.pendingLeaderboardPassedEvents);
    const next = existing.filter((row) => firstNonEmptyString(row.eventId) !== eventId);
    const acknowledged = next.length !== existing.length;
    if (acknowledged) {
      const payload = {
        pendingLeaderboardPassedEvents: next,
        updatedAt: new Date()
      };
      await stateRef.set(payload, { merge: true });
    }
    if (acknowledged) {
      incrementDbOps("writes", 1);
    }
    const nextState = {
      ...data,
      pendingLeaderboardPassedEvents: next,
      updatedAt: new Date()
    };
    void globalCache.set(achievementsStateCacheKey(viewerId), nextState, 15_000).catch(() => undefined);
    if (acknowledged) {
      scheduleBackgroundWork(async () => {
        await Promise.all([
          globalCache.del(buildCacheKey("bootstrap", ["achievements-bootstrap-v1", viewerId])),
          globalCache.del(buildCacheKey("bootstrap", ["achievements-snapshot-v1", viewerId])),
          globalCache.del(buildCacheKey("bootstrap", ["achievements-status-v1", viewerId]))
        ]);
      });
    }
    return { recordedAtMs: Date.now(), acknowledged };
  }

  async claimWeeklyCapture(viewerId: string, captureId: string): Promise<AchievementClaimRewardPayload> {
    const db = this.requireDb();
    const stateRef = db.collection("users").doc(viewerId).collection("achievements").doc("state");
    const result = await db.runTransaction(async (tx) => {
      const stateDoc = await tx.get(stateRef);
      incrementDbOps("reads", stateDoc.exists ? 1 : 0);
      const data = (stateDoc.data() as FirestoreMap | undefined) ?? {};
      const weeklyCaptures = asObject(data.weeklyCaptures);
      const captures = asArray<FirestoreMap>(weeklyCaptures.captures);
      const idx = captures.findIndex((capture) => firstNonEmptyString(capture.id) === captureId);
      if (idx < 0) throw new Error("weekly_capture_not_found");
      const currentCapture = { ...captures[idx]! };
      if (!currentCapture.completed) throw new Error("weekly_capture_not_completed");
      if (currentCapture.claimed) throw new Error("weekly_capture_already_claimed");
      const xpAwarded = Math.max(0, finiteInteger(currentCapture.xpReward, 0));
      const xpState = mapStateXp(data);
      const nextXp = buildXpState(xpState.current + xpAwarded);
      captures[idx] = {
        ...currentCapture,
        claimed: true,
        claimedAt: new Date().toISOString()
      };
      tx.set(
        stateRef,
        {
          weeklyCaptures: {
            ...weeklyCaptures,
            captures,
            allClaimed: captures.every((capture) => Boolean(capture.completed) && Boolean(capture.claimed))
          },
          xp: nextXp,
          xpUpdatedAt: new Date(),
          updatedAt: new Date()
        },
        { merge: true }
      );
      incrementDbOps("writes", 1);
      return {
        xpAwarded,
        newTotalXP: nextXp.current,
        leveledUp: nextXp.level > xpState.level,
        newLevel: nextXp.level,
        tier: nextXp.tier
      };
    });
    await this.clearViewerCaches(viewerId, { includeLeaderboards: true });
    return result;
  }

  async claimBadge(
    viewerId: string,
    badgeId: string,
    source?: "static" | "competitive"
  ): Promise<AchievementClaimRewardPayload> {
    const db = this.requireDb();
    const badgeDef = (await this.loadBadgeDefinitions()).find((row) => row.id === badgeId) ?? null;
    const stateRef = db.collection("users").doc(viewerId).collection("achievements").doc("state");
    const userBadgeRef = db.collection("users").doc(viewerId).collection("badges").doc(badgeId);
    const competitiveBadgeRef = db.collection("users").doc(viewerId).collection("competitiveBadges").doc(badgeId);
    const eventsRef = db.collection("events_achievements").doc();

    const result = await db.runTransaction(async (tx) => {
      const [stateDoc, userBadgeDoc, competitiveBadgeDoc] = await Promise.all([
        tx.get(stateRef),
        tx.get(userBadgeRef),
        tx.get(competitiveBadgeRef)
      ]);
      incrementDbOps("reads", 3);
      const stateData = (stateDoc.data() as FirestoreMap | undefined) ?? {};
      const xpState = mapStateXp(stateData);
      const competitive = (competitiveBadgeDoc?.data() as CompetitiveBadgeDoc | undefined) ?? {};
      const ownershipVersion = getCompetitiveOwnershipVersion(competitive);
      const competitiveClaimedForOwnership = isCompetitiveBadgeClaimedForCurrentOwnership(competitive);
      const badgeData = (userBadgeDoc.data() as UserBadgeDoc | undefined) ?? {};
      const canClaimCompetitive =
        competitiveBadgeDoc?.exists === true && competitive.currentOwner === true && !competitiveClaimedForOwnership;
      const canClaimStatic = userBadgeDoc.exists && badgeData.earned === true && badgeData.claimed !== true;
      const resolvedSource =
        source === "competitive"
          ? "competitive"
          : source === "static"
            ? "static"
            : canClaimStatic
              ? "static"
              : "competitive";
      const xpAwarded = resolvedSource === "competitive" ? 100 : Math.max(0, getBadgeClaimReward(badgeDef));

      if (resolvedSource === "competitive") {
        if (!competitiveBadgeDoc?.exists) throw new Error("competitive_badge_not_found");
        if (!competitive.currentOwner) throw new Error("competitive_badge_not_earned");
        if (competitiveClaimedForOwnership) throw new Error("competitive_badge_already_claimed");
        const nextXp = buildXpState(xpState.current + xpAwarded);
        tx.set(
          competitiveBadgeRef,
          {
            claimed: true,
            claimedAt: new Date(),
            xpAwarded: true,
            claimedOwnershipVersion: ownershipVersion,
            xpAwardedOwnershipVersion: ownershipVersion,
            lastUpdated: new Date()
          },
          { merge: true }
        );
        tx.set(
          stateRef,
          {
            xp: nextXp,
            xpUpdatedAt: new Date(),
            updatedAt: new Date()
          },
          { merge: true }
        );
        tx.create(eventsRef, {
          userId: viewerId,
          eventType: "badge_claimed",
          metadata: {
            badgeId,
            badgeName: firstNonEmptyString(competitive.title) ?? badgeId,
            badgeSource: "competitive",
            xpAwarded
          },
          timestamp: new Date()
        });
        incrementDbOps("writes", 3);
        return {
          xpAwarded,
          newTotalXP: nextXp.current,
          leveledUp: nextXp.level > xpState.level,
          newLevel: nextXp.level,
          tier: nextXp.tier
        };
      }

      if (!userBadgeDoc.exists || !badgeData.earned) throw new Error("badge_not_earned");
      if (badgeData.claimed) throw new Error("badge_already_claimed");
      const nextXp = buildXpState(xpState.current + xpAwarded);
      tx.set(
        userBadgeRef,
        {
          claimed: true,
          claimedAt: new Date(),
          lastUpdated: new Date()
        },
        { merge: true }
      );
      tx.set(
        stateRef,
        {
          xp: nextXp,
          xpUpdatedAt: new Date(),
          updatedAt: new Date()
        },
        { merge: true }
      );
      tx.create(eventsRef, {
        userId: viewerId,
        eventType: "badge_claimed",
        metadata: {
          badgeId,
          badgeName: badgeDef?.name ?? badgeId,
          xpAwarded
        },
        timestamp: new Date()
      });
      incrementDbOps("writes", 3);
      return {
        xpAwarded,
        newTotalXP: nextXp.current,
        leveledUp: nextXp.level > xpState.level,
        newLevel: nextXp.level,
        tier: nextXp.tier
      };
    });
    await this.clearViewerCaches(viewerId, { includeLeaderboards: true });
    return result;
  }

  async claimChallenge(viewerId: string, challengeId: string): Promise<AchievementClaimRewardPayload> {
    const db = this.requireDb();
    const [stateDoc, userDoc, challengeDefs] = await Promise.all([
      this.ensureAchievementStateDoc(viewerId),
      this.loadUserDoc(viewerId),
      this.loadChallengeDefinitions()
    ]);
    const challenge = challengeDefs.find((row) => row.id === challengeId);
    if (!challenge) throw new Error("challenge_not_found");
    const challengeCounters = asObject(stateDoc?.challengeCounters);
    const claimedChallenges = asObject(stateDoc?.claimedChallenges);
    const totalPosts = await this.getCanonicalTotalPosts(viewerId, stateDoc, undefined, userDoc);
    const current =
      challenge.counterSource === "total_posts"
        ? totalPosts
        : challenge.counterSource === "following_count"
          ? Array.isArray(userDoc.following)
            ? userDoc.following.length
            : finiteInteger(userDoc.numFollowing, 0)
          : challenge.counterSource === "referral_signup_count"
            ? finiteInteger(userDoc.referralSignupCount, finiteInteger(challengeCounters.referral_signup_count, 0))
            : finiteInteger(challengeCounters[challenge.actionKey ?? ""], 0);
    if (current < challenge.target) throw new Error("challenge_not_completed");
    if (claimedChallenges[challengeId]) throw new Error("challenge_already_claimed");

    const stateRef = db.collection("users").doc(viewerId).collection("achievements").doc("state");
    const reward = Math.max(0, finiteInteger(challenge.rewardPoints, 100));
    const result = await db.runTransaction(async (tx) => {
      const liveState = await tx.get(stateRef);
      incrementDbOps("reads", liveState.exists ? 1 : 0);
      const data = (liveState.data() as FirestoreMap | undefined) ?? {};
      const liveClaimed = asObject(data.claimedChallenges);
      if (liveClaimed[challengeId]) throw new Error("challenge_already_claimed");
      const xpState = mapStateXp(data);
      const nextXp = buildXpState(xpState.current + reward);
      tx.set(
        stateRef,
        {
          xp: nextXp,
          claimedChallenges: {
            [challengeId]: new Date().toISOString()
          },
          xpUpdatedAt: new Date(),
          updatedAt: new Date()
        },
        { merge: true }
      );
      incrementDbOps("writes", 1);
      return {
        xpAwarded: reward,
        newTotalXP: nextXp.current,
        leveledUp: nextXp.level > xpState.level,
        newLevel: nextXp.level,
        tier: nextXp.tier
      };
    });
    await this.clearViewerCaches(viewerId, { includeLeaderboards: true });
    return result;
  }

  async claimIntroBonus(
    viewerId: string
  ): Promise<{ reward: AchievementClaimRewardPayload; alreadyClaimed: boolean }> {
    const INTRO_XP = 50;
    const AWARD_DOC_ID = "onboarding_intro_v1";
    const db = this.requireDb();
    const [stateDoc, userDoc] = await Promise.all([this.ensureAchievementStateDoc(viewerId), this.loadUserDoc(viewerId)]);
    const canonicalTotalPosts = await this.getCanonicalTotalPosts(viewerId, stateDoc, undefined, userDoc);

    const stateRef = db.collection("users").doc(viewerId).collection("achievements").doc("state");
    const awardRef = db.collection("users").doc(viewerId).collection("achievements_awards").doc(AWARD_DOC_ID);

    const result = await db.runTransaction(async (tx) => {
      const [awardDoc, stateSnap] = await Promise.all([tx.get(awardRef), tx.get(stateRef)]);
      incrementDbOps("reads", 2);
      const data = (stateSnap.data() as FirestoreMap | undefined) ?? {};
      const xpState = mapStateXp(data);
      const emptyReward: AchievementClaimRewardPayload = {
        xpAwarded: 0,
        newTotalXP: xpState.current,
        leveledUp: false,
        newLevel: xpState.level,
        tier: xpState.tier
      };

      if (awardDoc.exists) {
        return { reward: emptyReward, alreadyClaimed: true };
      }

      if (canonicalTotalPosts > 0) {
        tx.set(
          awardRef,
          {
            xp: 0,
            reason: "Achievements onboarding intro (skipped: already posted)",
            skipped: true,
            skippedReason: "already_posted",
            canonicalTotalPosts,
            createdAt: new Date()
          },
          { merge: true }
        );
        incrementDbOps("writes", 1);
        return { reward: emptyReward, alreadyClaimed: true };
      }

      const nextXp = buildXpState(xpState.current + INTRO_XP);
      tx.set(
        stateRef,
        {
          xp: nextXp,
          xpUpdatedAt: new Date(),
          updatedAt: new Date()
        },
        { merge: true }
      );
      tx.set(
        awardRef,
        {
          xp: INTRO_XP,
          reason: "Achievements onboarding intro",
          createdAt: new Date()
        },
        { merge: true }
      );
      incrementDbOps("writes", 2);
      return {
        reward: {
          xpAwarded: INTRO_XP,
          newTotalXP: nextXp.current,
          leveledUp: nextXp.level > xpState.level,
          newLevel: nextXp.level,
          tier: nextXp.tier
        },
        alreadyClaimed: false
      };
    });

    if (!result.alreadyClaimed && result.reward.xpAwarded > 0) {
      await this.clearViewerCaches(viewerId, { includeLeaderboards: true });
    }
    return result;
  }

  async invalidateViewerProjectionCaches(viewerId: string, opts?: { includeLeaderboards?: boolean }): Promise<void> {
    await this.clearViewerCaches(viewerId, { includeLeaderboards: opts?.includeLeaderboards === true });
  }

  async syncDynamicLeaderBadgesForViewer(viewerId: string): Promise<void> {
    try {
    const db = this.requireDb();
    const [globalRows, friendsLeaderboard, cityLeaderboard, leagueLeaderboard] = await Promise.all([
      this.loadGlobalXpCacheRows(),
      this.getFriendsLeaderboard(viewerId, "xp_friends", "xp.current"),
      this.getCityLeaderboard(viewerId),
      this.getLeagueXpLeaderboard(viewerId, null)
    ]);

    const globalWinner = globalRows[0]?.userId ?? null;
    const friendsWinner = friendsLeaderboard.entries[0]?.userId ?? null;
    const cityWinner = cityLeaderboard.entries[0]?.userId ?? null;
    const leagueWinner = leagueLeaderboard.entries[0]?.userId ?? null;
    const leagueBadgeId = leagueLeaderboard.leagueId ? `leader_top_league:${leagueLeaderboard.leagueId}` : null;

    const applyOwnership = async (badgeId: string, ownerUserId: string | null, meta: {
      title: string;
      description: string;
      badgeType: "activity" | "region";
      regionKey?: string | null;
      regionName?: string | null;
      iconKey?: string | null;
      score: number;
    }): Promise<void> => {
      const ownersSnap = await db
        .collectionGroup("competitiveBadges")
        .where("badgeKey", "==", badgeId)
        .where("currentOwner", "==", true)
        .get();
      incrementDbOps("queries", 1);
      incrementDbOps("reads", ownersSnap.docs.length);
      const now = new Date();
      const ops: Array<Promise<unknown>> = [];

      for (const doc of ownersSnap.docs) {
        const holderUserId = doc.ref.parent.parent?.id ?? "";
        if (!holderUserId || holderUserId === ownerUserId) continue;
        ops.push(
          doc.ref.set(
            {
              currentOwner: false,
              lostAt: now,
              lastOwnershipChangeAt: now,
              lastUpdated: now
            },
            { merge: true }
          )
        );
      }

      if (ownerUserId) {
        const ownerRef = db.collection("users").doc(ownerUserId).collection("competitiveBadges").doc(badgeId);
        const ownerSnap = await ownerRef.get();
        incrementDbOps("reads", ownerSnap.exists ? 1 : 0);
        const existing = (ownerSnap.data() as CompetitiveBadgeDoc | undefined) ?? {};
        const wasOwner = existing.currentOwner === true;
        const nextVersion = wasOwner ? getCompetitiveOwnershipVersion(existing) : getCompetitiveOwnershipVersion(existing) + 1;
        ops.push(
          ownerRef.set(
            {
              badgeKey: badgeId,
              title: meta.title,
              description: meta.description,
              iconKey: meta.iconKey ?? "crown",
              badgeType: meta.badgeType,
              regionKey: meta.regionKey ?? null,
              regionName: meta.regionName ?? null,
              currentOwner: true,
              earnedAt: wasOwner ? existing.earnedAt ?? now : now,
              ownershipVersion: nextVersion,
              countAtEarnTime: Math.max(0, Math.trunc(meta.score)),
              lastOwnershipChangeAt: wasOwner ? existing.lastOwnershipChangeAt ?? now : now,
              ...(wasOwner
                ? {}
                : {
                    claimed: false,
                    xpAwarded: false,
                    claimedOwnershipVersion: 0,
                    xpAwardedOwnershipVersion: 0
                  }),
              lastUpdated: now
            },
            { merge: true }
          )
        );
      }

      if (ops.length > 0) {
        await Promise.all(ops);
        incrementDbOps("writes", ops.length);
      }
    };

    await applyOwnership(DYNAMIC_LEADER_BADGE_KEYS.global, globalWinner, {
      title: "Top Globally",
      description: "Highest XP across all Locava users.",
      badgeType: "activity",
      iconKey: "globe",
      score: globalRows[0]?.xp ?? 0
    });
    await applyOwnership(DYNAMIC_LEADER_BADGE_KEYS.friends, friendsWinner, {
      title: "Top Friends",
      description: "Highest XP among this friend graph.",
      badgeType: "activity",
      iconKey: "people",
      score: friendsLeaderboard.entries[0]?.score ?? 0
    });
    await applyOwnership(DYNAMIC_LEADER_BADGE_KEYS.community, cityWinner, {
      title: "Top Community",
      description: `Highest XP in ${cityLeaderboard.cityName ?? "your city"}.`,
      badgeType: "region",
      regionKey: cityLeaderboard.cityName ?? null,
      regionName: cityLeaderboard.cityName ?? null,
      iconKey: "location",
      score: cityLeaderboard.entries[0]?.score ?? 0
    });
    if (leagueBadgeId) {
      await applyOwnership(leagueBadgeId, leagueWinner, {
        title: `Top ${leagueLeaderboard.leagueName ?? "League"}`,
        description: "Highest XP in this league.",
        badgeType: "region",
        regionKey: leagueLeaderboard.leagueId ?? null,
        regionName: leagueLeaderboard.leagueName ?? null,
        iconKey: "trophy",
        score: leagueLeaderboard.entries[0]?.score ?? 0
      });
    }

    const viewerBadgeSnap = await db.collection("users").doc(viewerId).collection("competitiveBadges").where("currentOwner", "==", true).get();
    incrementDbOps("queries", 1);
    incrementDbOps("reads", viewerBadgeSnap.docs.length);
    const staleLeagueDocs = viewerBadgeSnap.docs.filter((doc) => {
      const data = (doc.data() as CompetitiveBadgeDoc | undefined) ?? {};
      const key = firstNonEmptyString(data.badgeKey) ?? doc.id;
      return key.startsWith("leader_top_league:") && key !== leagueBadgeId;
    });
    if (staleLeagueDocs.length > 0) {
      const now = new Date();
      await Promise.all(
        staleLeagueDocs.map((doc) =>
          doc.ref.set(
            {
              currentOwner: false,
              lostAt: now,
              lastOwnershipChangeAt: now,
              lastUpdated: now
            },
            { merge: true }
          )
        )
      );
      incrementDbOps("writes", staleLeagueDocs.length);
    }

    const impactedUsers = new Set<string>([
      viewerId,
      globalWinner ?? "",
      friendsWinner ?? "",
      cityWinner ?? "",
      leagueWinner ?? ""
    ]);
    await Promise.all(
      [...impactedUsers]
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => this.clearViewerCaches(id, { includeLeaderboards: true }))
    );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const lower = msg.toLowerCase();
      if (lower.includes("failed_precondition") || lower.includes("requires an index")) {
        return;
      }
      throw error;
    }
  }

  private async getGlobalMetricLeaderboard(
    viewerId: string,
    scope: AchievementLeaderboardScope,
    metric: "xp.current" | "totalPosts"
  ): Promise<LeaderboardReadModel> {
    const [xpRows, postsRows, stateDoc, totalPosts] = await Promise.all([
      metric === "xp.current" ? this.loadGlobalXpCacheRows() : Promise.resolve(null),
      metric === "totalPosts" ? this.loadGlobalPostsCacheRows() : Promise.resolve(null),
      metric === "xp.current" ? this.ensureAchievementStateDoc(viewerId) : Promise.resolve(null),
      metric === "totalPosts" ? this.getCanonicalTotalPosts(viewerId) : Promise.resolve(null)
    ]);
    const entries =
      metric === "xp.current"
        ? (xpRows ?? []).slice(0, 20).map((row, index) => ({
            rank: index + 1,
            userId: row.userId,
            userName: row.userName,
            profilePic: row.profilePic,
            score: row.xp,
            ...(typeof row.level === "number" ? { level: row.level } : {}),
            ...(row.tier ? { tier: row.tier } : {}),
            ...(typeof row.xpUpdatedAtMs === "number" ? { xpUpdatedAtMs: row.xpUpdatedAtMs } : {})
          }))
        : (postsRows ?? []).slice(0, 20).map((row, index) => ({
            rank: index + 1,
            userId: row.userId,
            userName: row.userName,
            profilePic: row.profilePic,
            score: row.totalPosts,
            totalPosts: row.totalPosts
          }));
    const viewerMetricValue =
      metric === "xp.current"
        ? finiteInteger(asObject(stateDoc?.xp).current, 0)
        : Math.max(0, finiteInteger(totalPosts, 0));
    const viewerRank =
      metric === "xp.current"
        ? this.computeViewerRankFromXpRows(viewerId, xpRows ?? [], viewerMetricValue)
        : this.computeViewerRankFromPostRows(viewerId, postsRows ?? [], viewerMetricValue);
    return {
      scope,
      entries,
      viewerRank,
      cityName: null,
      groupName: null,
      leagueId: null,
      leagueName: null,
      leagueIconUrl: null,
      leagueColor: null,
      leagueBgColor: null
    };
  }

  private async getLeagueXpLeaderboard(viewerId: string, requestedLeagueId?: string | null): Promise<LeaderboardReadModel> {
    const [stateDoc, leagues] = await Promise.all([this.ensureAchievementStateDoc(viewerId), this.getLeagueDefinitions()]);
    const viewerXp = finiteInteger(asObject(stateDoc?.xp).current, 0);
    const league = requestedLeagueId
      ? leagues.find((row) => row.id === requestedLeagueId)
      : this.resolveLeagueForXp(leagues, viewerXp);
    if (!league) {
      return {
        scope: "xp_league",
        entries: [],
        viewerRank: null,
        cityName: null,
        groupName: null,
        leagueId: requestedLeagueId?.trim() ?? null,
        leagueName: null,
        leagueIconUrl: null,
        leagueColor: null,
        leagueBgColor: null
        };
    }
    const entriesInLeague = (await this.loadGlobalXpCacheRows())
      .filter((row) => row.xp >= league.minXP && row.xp <= league.maxXP)
      .map((row, index) => ({
        rank: index + 1,
        userId: row.userId,
        userName: row.userName,
        profilePic: row.profilePic,
        score: row.xp,
        ...(typeof row.level === "number" ? { level: row.level } : {}),
        ...(row.tier ? { tier: row.tier } : {}),
        ...(typeof row.xpUpdatedAtMs === "number" ? { xpUpdatedAtMs: row.xpUpdatedAtMs } : {})
      }));
    const entries = entriesInLeague.slice(0, 20);
    const viewerRank = entriesInLeague.find((entry) => entry.userId === viewerId)?.rank ?? null;
    return {
      scope: "xp_league",
      entries,
      viewerRank,
      cityName: null,
      groupName: null,
      leagueId: league.id,
      leagueName: league.title,
      leagueIconUrl: league.imageUrl ?? null,
      leagueColor: league.color ?? null,
      leagueBgColor: league.bgColor ?? null
    };
  }

  private async getFriendsLeaderboard(
    viewerId: string,
    scope: AchievementLeaderboardScope,
    metric: "xp.current" | "totalPosts"
  ): Promise<LeaderboardReadModel> {
    const db = this.requireDb();
    incrementDbOps("queries", 1);
    const followingSnap = await db.collection("users").doc(viewerId).collection("following").limit(150).get();
    incrementDbOps("reads", followingSnap.docs.length);
    const candidateIds = [...new Set([viewerId, ...followingSnap.docs.map((doc) => doc.id)])];
    const [userDocs, stateDocs] = await Promise.all([
      this.loadUsersByIds(candidateIds),
      this.loadStateDocsByUserIds(candidateIds)
    ]);
    const rows = candidateIds
      .map((userId) => ({
        userId,
        user: userDocs.get(userId) ?? {},
        state: stateDocs.get(userId) ?? {}
      }))
      .sort((a, b) =>
        metric === "xp.current"
          ? finiteInteger(asObject(b.state.xp).current, 0) - finiteInteger(asObject(a.state.xp).current, 0)
          : finiteInteger(b.state.totalPosts, 0) - finiteInteger(a.state.totalPosts, 0)
      )
      .slice(0, 20);
    const entries = rows.map((row, index) => this.mapLeaderboardEntry(row.userId, row.user, row.state, index + 1, metric));
    return {
      scope,
      entries,
      viewerRank: entries.find((entry) => entry.userId === viewerId)?.rank ?? null,
      cityName: null,
      groupName: null,
      leagueId: null,
      leagueName: null,
      leagueIconUrl: null,
      leagueColor: null,
      leagueBgColor: null
    };
  }

  private async getCityLeaderboard(viewerId: string): Promise<LeaderboardReadModel> {
    const userDoc = await this.loadUserDoc(viewerId);
    const cachedCityLeaderboard = await this.loadCommunityXpCacheRows(viewerId);
    const cityName =
      cachedCityLeaderboard.cityName ?? firstNonEmptyString(userDoc.city, userDoc.hometown, asObject(userDoc.location).city);
    if (!cityName) {
      return {
        scope: "city",
        entries: [],
        viewerRank: null,
        cityName: null,
        groupName: null,
        leagueId: null,
        leagueName: null,
        leagueIconUrl: null,
        leagueColor: null,
        leagueBgColor: null
        };
    }
    const entries = cachedCityLeaderboard.rows.slice(0, 20).map((row, index) => ({
      rank: row.rank ?? index + 1,
      userId: row.userId,
      userName: row.userName,
      profilePic: row.profilePic,
      score: row.xp,
      ...(typeof row.level === "number" ? { level: row.level } : {}),
      ...(row.tier ? { tier: row.tier } : {}),
      ...(typeof row.xpUpdatedAtMs === "number" ? { xpUpdatedAtMs: row.xpUpdatedAtMs } : {})
    }));
    return {
      scope: "city",
      entries,
      viewerRank: entries.find((entry) => entry.userId === viewerId)?.rank ?? null,
      cityName,
      groupName: null,
      leagueId: null,
      leagueName: null,
      leagueIconUrl: null,
      leagueColor: null,
      leagueBgColor: null
    };
  }

  private async getGroupLeaderboard(viewerId: string): Promise<LeaderboardReadModel> {
    const userDoc = await this.loadUserDoc(viewerId);
    const groupId = firstNonEmptyString(userDoc.groupId, userDoc.primaryGroupId);
    if (!groupId) {
      return {
        scope: "xp_group",
        entries: [],
        viewerRank: null,
        cityName: null,
        groupName: null,
        leagueId: null,
        leagueName: null,
        leagueIconUrl: null,
        leagueColor: null,
        leagueBgColor: null
      };
    }
    const db = this.requireDb();
    incrementDbOps("queries", 1);
    const membersSnap = await db.collection("groups").doc(groupId).collection("members").limit(100).get();
    incrementDbOps("reads", membersSnap.docs.length);
    const candidateIds = [...new Set([viewerId, ...membersSnap.docs.map((doc) => doc.id)])];
    const [userDocs, stateDocs] = await Promise.all([this.loadUsersByIds(candidateIds), this.loadStateDocsByUserIds(candidateIds)]);
    const rows = candidateIds
      .map((userId) => ({ userId, user: userDocs.get(userId) ?? {}, state: stateDocs.get(userId) ?? {} }))
      .sort((a, b) => finiteInteger(asObject(b.state.xp).current, 0) - finiteInteger(asObject(a.state.xp).current, 0))
      .slice(0, 20);
    const entries = rows.map((row, index) => this.mapLeaderboardEntry(row.userId, row.user, row.state, index + 1, "xp.current"));
    return {
      scope: "xp_group",
      entries,
      viewerRank: entries.find((entry) => entry.userId === viewerId)?.rank ?? null,
      cityName: null,
      groupName: groupId,
      leagueId: null,
      leagueName: null,
      leagueIconUrl: null,
      leagueColor: null,
      leagueBgColor: null
    };
  }

  private async loadUserDoc(viewerId: string): Promise<FirestoreMap> {
    const cached = await globalCache.get<FirestoreMap>(entityCacheKeys.userFirestoreDoc(viewerId));
    if (cached !== undefined) return cached;
    const db = this.requireDb();
    const snap = await db.collection("users").doc(viewerId).get();
    incrementDbOps("reads", snap.exists ? 1 : 0);
    const data = (snap.data() as FirestoreMap | undefined) ?? {};
    void globalCache.set(entityCacheKeys.userFirestoreDoc(viewerId), data, 20_000).catch(() => undefined);
    return data;
  }

  private async ensureAchievementStateDoc(viewerId: string): Promise<FirestoreMap | null> {
    const cached = await globalCache.get<FirestoreMap | null>(achievementsStateCacheKey(viewerId));
    if (cached !== undefined) return cached;
    const db = this.requireDb();
    const ref = db.collection("users").doc(viewerId).collection("achievements").doc("state");
    const snap = await ref.get();
    incrementDbOps("reads", snap.exists ? 1 : 0);
    if (!snap.exists) {
      throw new Error("achievement_state_missing");
    }
    const data = snap.exists ? (((snap.data() as FirestoreMap | undefined) ?? {}) as FirestoreMap) : null;
    void globalCache.set(achievementsStateCacheKey(viewerId), data, 15_000).catch(() => undefined);
    return data;
  }

  private async loadBootstrapViewerDocs(viewerId: string): Promise<{ userDoc: FirestoreMap; stateDoc: FirestoreMap | null }> {
    const [cachedUserDoc, cachedStateDoc] = await Promise.all([
      globalCache.get<FirestoreMap>(entityCacheKeys.userFirestoreDoc(viewerId)),
      globalCache.get<FirestoreMap | null>(achievementsStateCacheKey(viewerId))
    ]);
    if (cachedUserDoc !== undefined && cachedStateDoc !== undefined) {
      return {
        userDoc: cachedUserDoc,
        stateDoc: cachedStateDoc
      };
    }
    const db = this.requireDb();
    const userRef = db.collection("users").doc(viewerId);
    const stateRef = userRef.collection("achievements").doc("state");
    const [userSnap, stateSnap] = (
      typeof (db as { getAll?: unknown }).getAll === "function"
        ? await (
            db as unknown as {
              getAll: (
                ...args: [
                  FirebaseFirestore.DocumentReference,
                  FirebaseFirestore.DocumentReference,
                  { fieldMask: string[] }
                ]
              ) => Promise<FirebaseFirestore.DocumentSnapshot[]>;
            }
          ).getAll(userRef, stateRef, {
            fieldMask: [...AchievementsRepository.BOOTSTRAP_DOC_FIELD_MASK]
          })
        : await Promise.all([userRef.get(), stateRef.get()])
    ) as [FirebaseFirestore.DocumentSnapshot, FirebaseFirestore.DocumentSnapshot];
    incrementDbOps("reads", userSnap.exists ? 1 : 0);
    incrementDbOps("reads", stateSnap.exists ? 1 : 0);
    if (!stateSnap.exists) {
      throw new Error("achievement_state_missing");
    }
    const userDoc = (userSnap.data() as FirestoreMap | undefined) ?? {};
    const stateDoc = ((stateSnap.data() as FirestoreMap | undefined) ?? {}) as FirestoreMap;
    void globalCache.set(entityCacheKeys.userFirestoreDoc(viewerId), userDoc, 20_000).catch(() => undefined);
    void globalCache.set(achievementsStateCacheKey(viewerId), stateDoc, 15_000).catch(() => undefined);
    return { userDoc, stateDoc };
  }

  private async loadProgressDocs(viewerId: string): Promise<Map<string, FirestoreMap>> {
    const cached = await globalCache.get<Array<[string, FirestoreMap]>>(achievementsProgressCacheKey(viewerId));
    if (cached !== undefined) return new Map(cached);
    const db = this.requireDb();
    const snap = await db.collection("users").doc(viewerId).collection("progress").get();
    incrementDbOps("queries", 1);
    incrementDbOps("reads", snap.docs.length);
    const map = new Map<string, FirestoreMap>(snap.docs.map((doc) => [doc.id, ((doc.data() as FirestoreMap | undefined) ?? {})]));
    void globalCache.set(achievementsProgressCacheKey(viewerId), [...map.entries()], 15_000).catch(() => undefined);
    return map;
  }

  private async loadProgressDocsByIds(viewerId: string, docIds: string[]): Promise<Map<string, FirestoreMap>> {
    const uniqueDocIds = [...new Set(docIds.map((id) => id.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (uniqueDocIds.length === 0) return new Map();
    const cached = await globalCache.get<Array<[string, FirestoreMap]>>(
      achievementsProgressSubsetCacheKey(viewerId, uniqueDocIds)
    );
    if (cached !== undefined) return new Map(cached);
    const db = this.requireDb();
    const refs = uniqueDocIds.map((docId) => db.collection("users").doc(viewerId).collection("progress").doc(docId));
    const snaps = await db.getAll(...refs);
    incrementDbOps("queries", 1);
    incrementDbOps("reads", snaps.filter((snap) => snap.exists).length);
    const map = new Map<string, FirestoreMap>();
    for (const snap of snaps) {
      if (!snap.exists) continue;
      map.set(snap.id, ((snap.data() as FirestoreMap | undefined) ?? {}));
    }
    void globalCache.set(
      achievementsProgressSubsetCacheKey(viewerId, uniqueDocIds),
      [...map.entries()],
      15_000
    ).catch(() => undefined);
    return map;
  }

  private async loadUserBadgeDocs(viewerId: string): Promise<Map<string, UserBadgeDoc>> {
    const cached = await globalCache.get<Array<[string, UserBadgeDoc]>>(achievementsBadgesCacheKey(viewerId));
    if (cached !== undefined) return new Map(cached);
    const db = this.requireDb();
    let snap;
    incrementDbOps("queries", 1);
    try {
      snap = await db.collection("users").doc(viewerId).collection("badges").where("earned", "==", true).get();
    } catch {
      snap = await db.collection("users").doc(viewerId).collection("badges").get();
    }
    incrementDbOps("reads", snap.docs.length);
    const map = new Map<string, UserBadgeDoc>(snap.docs.map((doc) => [doc.id, ((doc.data() as UserBadgeDoc | undefined) ?? {})]));
    void globalCache.set(achievementsBadgesCacheKey(viewerId), [...map.entries()], 15_000).catch(() => undefined);
    return map;
  }

  private async loadCompetitiveBadgeDocs(viewerId: string): Promise<Map<string, CompetitiveBadgeDoc>> {
    const cached = await globalCache.get<Array<[string, CompetitiveBadgeDoc]>>(achievementsCompetitiveBadgesCacheKey(viewerId));
    if (cached !== undefined) return new Map(cached);
    const db = this.requireDb();
    incrementDbOps("queries", 2);
    let ownedDocs: Array<{ id: string; data: () => unknown }> = [];
    let claimedDocs: Array<{ id: string; data: () => unknown }> = [];
    try {
      ownedDocs = (
        await db.collection("users").doc(viewerId).collection("competitiveBadges").where("currentOwner", "==", true).get()
      ).docs;
      claimedDocs = (
        await db.collection("users").doc(viewerId).collection("competitiveBadges").where("claimed", "==", true).get()
      ).docs;
    } catch {
      const fallback = await db.collection("users").doc(viewerId).collection("competitiveBadges").get();
      ownedDocs = fallback.docs;
      claimedDocs = [];
    }
    incrementDbOps("reads", ownedDocs.length + claimedDocs.length);
    const docs = [...ownedDocs, ...claimedDocs];
    const map = new Map<string, CompetitiveBadgeDoc>(docs.map((doc) => [doc.id, ((doc.data() as CompetitiveBadgeDoc | undefined) ?? {})]));
    void globalCache.set(achievementsCompetitiveBadgesCacheKey(viewerId), [...map.entries()], 15_000).catch(() => undefined);
    return map;
  }

  private async loadClaimableUserBadgeDocs(viewerId: string): Promise<Map<string, UserBadgeDoc>> {
    const db = this.requireDb();
    incrementDbOps("queries", 1);
    let snap;
    try {
      snap = await db
        .collection("users")
        .doc(viewerId)
        .collection("badges")
        .where("earned", "==", true)
        .where("claimed", "==", false)
        .get();
    } catch {
      snap = await db.collection("users").doc(viewerId).collection("badges").where("earned", "==", true).get();
    }
    incrementDbOps("reads", snap.docs.length);
    return new Map(snap.docs.map((doc) => [doc.id, ((doc.data() as UserBadgeDoc | undefined) ?? {})]));
  }

  private async loadClaimableCompetitiveBadgeDocs(viewerId: string): Promise<Map<string, CompetitiveBadgeDoc>> {
    const db = this.requireDb();
    incrementDbOps("queries", 1);
    let snap;
    try {
      snap = await db
        .collection("users")
        .doc(viewerId)
        .collection("competitiveBadges")
        .where("currentOwner", "==", true)
        .get();
    } catch {
      snap = await db.collection("users").doc(viewerId).collection("competitiveBadges").where("currentOwner", "==", true).get();
    }
    incrementDbOps("reads", snap.docs.length);
    const docs = snap.docs.filter((doc) => {
      const data = ((doc.data() as CompetitiveBadgeDoc | undefined) ?? {}) as CompetitiveBadgeDoc;
      return data.currentOwner === true && !isCompetitiveBadgeClaimedForCurrentOwnership(data);
    });
    return new Map(docs.map((doc) => [doc.id, ((doc.data() as CompetitiveBadgeDoc | undefined) ?? {})]));
  }

  private async loadBadgeDefinitions(): Promise<BadgeDefinitionRead[]> {
    const cached = await globalCache.get<BadgeDefinitionRead[]>(achievementsBadgeDefinitionsCacheKey());
    if (cached !== undefined) return cached;
    const db = this.requireDb();
    incrementDbOps("queries", 1);
    let snap;
    try {
      snap = await db.collection("achievements").orderBy("order", "asc").get();
    } catch {
      snap = await db.collection("achievements").get();
    }
    incrementDbOps("reads", snap.docs.length);
    const defs = snap.docs
      .map((doc) => normalizeBadgeDefinition(doc.id, ((doc.data() as FirestoreMap | undefined) ?? {})))
      .filter((row) => row.active !== false)
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    void globalCache.set(achievementsBadgeDefinitionsCacheKey(), defs, 120_000).catch(() => undefined);
    return defs;
  }

  private async loadBootstrapBadgeDefinitions(limit: number): Promise<BadgeDefinitionRead[]> {
    const allCached = await globalCache.get<BadgeDefinitionRead[]>(achievementsBadgeDefinitionsCacheKey());
    if (allCached !== undefined) {
      return allCached.slice(0, limit);
    }
    const db = this.requireDb();
    incrementDbOps("queries", 1);
    let snap;
    try {
      snap = await db.collection("achievements").orderBy("order", "asc").limit(limit).get();
    } catch {
      snap = await db.collection("achievements").limit(limit).get();
    }
    incrementDbOps("reads", snap.docs.length);
    return snap.docs
      .map((doc) => normalizeBadgeDefinition(doc.id, ((doc.data() as FirestoreMap | undefined) ?? {})))
      .filter((row) => row.active !== false)
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  }

  private async loadBadgeDefinitionsByIds(ids: string[]): Promise<BadgeDefinitionRead[]> {
    const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) return [];
    const allCached = await globalCache.get<BadgeDefinitionRead[]>(achievementsBadgeDefinitionsCacheKey());
    if (allCached !== undefined) {
      const byId = new Map(allCached.map((row) => [row.id, row]));
      return uniqueIds.map((id) => byId.get(id)).filter((row): row is BadgeDefinitionRead => Boolean(row));
    }
    const db = this.requireDb();
    incrementDbOps("queries", 1);
    const refs = uniqueIds.map((id) => db.collection("achievements").doc(id));
    const snaps = await db.getAll(...refs);
    incrementDbOps("reads", snaps.filter((snap) => snap.exists).length);
    return snaps
      .filter((snap) => snap.exists)
      .map((snap) => normalizeBadgeDefinition(snap.id, ((snap.data() as FirestoreMap | undefined) ?? {})))
      .filter((row) => row.active !== false);
  }

  private async loadChallengeDefinitions(): Promise<AchievementChallengeDefinition[]> {
    const cached = await globalCache.get<AchievementChallengeDefinition[]>(achievementsChallengeDefinitionsCacheKey());
    if (cached !== undefined) return cached;
    const db = this.requireDb();
    incrementDbOps("queries", 1);
    let snap;
    try {
      snap = await db.collection("achievementChallenges").where("active", "==", true).orderBy("order", "asc").get();
    } catch {
      try {
        snap = await db.collection("achievementChallenges").get();
      } catch {
        snap = null;
      }
    }
    const defs =
      snap && snap.docs.length > 0
        ? snap.docs
            .map((doc) => normalizeChallengeDefinition(doc.id, ((doc.data() as FirestoreMap | undefined) ?? {})))
            .filter((row) => row.active)
            .sort((a, b) => a.order - b.order)
        : [];
    if (snap) incrementDbOps("reads", snap.docs.length);
    if (defs.length === 0) {
      throw new Error("achievement_challenge_definitions_missing");
    }
    void globalCache.set(achievementsChallengeDefinitionsCacheKey(), defs, 120_000).catch(() => undefined);
    return defs;
  }

  private async getEarnedStaticBadgeCount(viewerId: string): Promise<number> {
    const cached = await globalCache.get<number>(achievementsEarnedBadgeCountCacheKey(viewerId));
    if (typeof cached === "number" && Number.isFinite(cached) && cached >= 0) {
      return Math.floor(cached);
    }
    const db = this.requireDb();
    incrementDbOps("queries", 1);
    try {
      const snap = await db.collection("users").doc(viewerId).collection("badges").where("earned", "==", true).count().get();
      const count = Math.max(0, Math.floor(Number(snap.data().count ?? 0)));
      void globalCache.set(achievementsEarnedBadgeCountCacheKey(viewerId), count, 15_000).catch(() => undefined);
      return count;
    } catch {
      const count = (await this.loadUserBadgeDocs(viewerId)).size;
      void globalCache.set(achievementsEarnedBadgeCountCacheKey(viewerId), count, 15_000).catch(() => undefined);
      return count;
    }
  }

  private async getActiveStaticBadgeCount(): Promise<number> {
    const cached = await globalCache.get<number>(achievementsActiveBadgeCountCacheKey());
    if (typeof cached === "number" && Number.isFinite(cached) && cached >= 0) {
      return Math.floor(cached);
    }
    const db = this.requireDb();
    incrementDbOps("queries", 1);
    try {
      const snap = await db.collection("achievements").where("active", "==", true).count().get();
      const count = Math.max(0, Math.floor(Number(snap.data().count ?? 0)));
      void globalCache.set(achievementsActiveBadgeCountCacheKey(), count, 120_000).catch(() => undefined);
      return count;
    } catch {
      const defs = await this.loadBadgeDefinitions();
      const count = defs.length;
      void globalCache.set(achievementsActiveBadgeCountCacheKey(), count, 120_000).catch(() => undefined);
      return count;
    }
  }

  private async loadUsersByIds(userIds: string[]): Promise<Map<string, FirestoreMap>> {
    const uniqueIds = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();
    const db = this.requireDb();
    const chunks: string[][] = [];
    for (let i = 0; i < uniqueIds.length; i += 10) chunks.push(uniqueIds.slice(i, i + 10));
    incrementDbOps("queries", chunks.length);
    const snaps = await Promise.all(
      chunks.map((chunk) => db.collection("users").where(FieldPath.documentId(), "in", chunk).get())
    );
    const map = new Map<string, FirestoreMap>();
    for (const snap of snaps) {
      incrementDbOps("reads", snap.docs.length);
      snap.docs.forEach((doc) => {
        map.set(doc.id, ((doc.data() as FirestoreMap | undefined) ?? {}));
      });
    }
    return map;
  }

  private async loadStateDocsByUserIds(userIds: string[]): Promise<Map<string, FirestoreMap>> {
    const db = this.requireDb();
    const refs = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))].map((userId) =>
      db.collection("users").doc(userId).collection("achievements").doc("state")
    );
    if (refs.length === 0) return new Map();
    incrementDbOps("queries", 1);
    const snaps = await db.getAll(...refs);
    incrementDbOps("reads", snaps.filter((snap) => snap.exists).length);
    return new Map(
      snaps
        .filter((snap) => snap.exists)
        .map((snap) => [snap.ref.parent.parent?.id ?? "", ((snap.data() as FirestoreMap | undefined) ?? {})] as const)
        .filter(([userId]) => Boolean(userId))
    );
  }

  private async getWeeklyExploration(
    viewerId: string,
    opts?: { maxPosts?: number }
  ): Promise<AchievementWeeklyExploration> {
    const maxPosts = Math.min(WEEKLY_STREAK_POST_LIMIT, Math.max(30, opts?.maxPosts ?? WEEKLY_STREAK_POST_LIMIT));
    const cacheKey = achievementsWeeklyExplorationCacheKey(viewerId, maxPosts);
    const cached = await globalCache.get<AchievementWeeklyExploration>(cacheKey);
    if (cached !== undefined) return cached;
    const posts = await this.loadRecentPostsForWeeklyExploration(viewerId, maxPosts);
    const exploration = computeWeeklyExplorationFromPostRows(posts);
    void globalCache.set(cacheKey, exploration, 30_000).catch(() => undefined);
    return exploration;
  }

  private async loadRecentPostsForWeeklyExploration(
    viewerId: string,
    maxPosts: number
  ): Promise<Array<{ id: string; createdAt?: unknown; time?: unknown; timestamp?: unknown; activities?: unknown }>> {
    const db = this.requireDb();
    incrementDbOps("queries", 1);
    let snap;
    try {
      snap = await db.collection("posts").where("userId", "==", viewerId).orderBy("createdAt", "desc").limit(maxPosts).get();
    } catch {
      snap = await db.collection("posts").where("userId", "==", viewerId).limit(maxPosts).get();
    }
    incrementDbOps("reads", snap.docs.length);
    if (snap.docs.length === 0) {
      incrementDbOps("queries", 1);
      const ownerSnap = await db.collection("posts").where("ownerId", "==", viewerId).limit(maxPosts).get();
      incrementDbOps("reads", ownerSnap.docs.length);
      return ownerSnap.docs.map((doc) => ({ id: doc.id, ...(((doc.data() as FirestoreMap | undefined) ?? {}) as FirestoreMap) }));
    }
    return snap.docs.map((doc) => ({ id: doc.id, ...(((doc.data() as FirestoreMap | undefined) ?? {}) as FirestoreMap) }));
  }

  private computeBadgeProgressValue(
    definition: BadgeDefinitionRead,
    stateDoc: FirestoreMap | null,
    progressDocs: Map<string, FirestoreMap>
  ): number {
    const statKey = definition.statKey;
    if (definition.ruleType === "StreakDays" || statKey === "Streak Days") {
      return Math.max(0, finiteInteger(asObject(stateDoc?.streak).current, 0));
    }
    if (statKey === "Posts Created" || statKey === "Total Posts") {
      return Math.max(
        0,
        finiteInteger(progressDocs.get("total_posts")?.value, finiteInteger(stateDoc?.totalPosts, 0))
      );
    }
    if (statKey === "Unique Spots" || statKey === "Places Visited") {
      const arr = asArray(progressDocs.get("unique_spots")?.value);
      return arr.length;
    }
    if (statKey === "weekly_captures_completed" || definition.ruleType === "WeeklyCaptureCompletion") {
      return Math.max(0, finiteInteger(progressDocs.get("weekly_captures_completed")?.value, 0));
    }
    if (definition.activityType) {
      const key = `activity_${definition.activityType}`;
      return Math.max(0, finiteInteger(progressDocs.get(key)?.value, 0));
    }
    if (statKey.startsWith("activity_")) {
      return Math.max(0, finiteInteger(progressDocs.get(statKey)?.value, 0));
    }
    const normalizedKey = statKey.toLowerCase().replace(/\s+/g, "_");
    const rawValue = progressDocs.get(normalizedKey)?.value ?? progressDocs.get(statKey)?.value;
    if (Array.isArray(rawValue)) return rawValue.length;
    return Math.max(0, finiteInteger(rawValue, 0));
  }

  private resolveLeagueForXp(leagues: AchievementLeagueDefinition[], xp: number): AchievementLeagueDefinition | null {
    const sorted = [...leagues].sort((a, b) => a.order - b.order);
    return sorted.find((league) => xp >= league.minXP && xp <= league.maxXP) ?? sorted[sorted.length - 1] ?? null;
  }

  private async getCanonicalTotalPosts(
    viewerId: string,
    stateDoc?: FirestoreMap | null,
    progressDocs?: Map<string, FirestoreMap>,
    userDoc?: FirestoreMap | null
  ): Promise<number> {
    const stateTotal = Math.max(0, finiteInteger(stateDoc?.totalPosts, 0));
    const progressTotal = Math.max(0, finiteInteger(progressDocs?.get("total_posts")?.value, 0));
    const userTotal = Math.max(
      0,
      finiteInteger(userDoc?.numPosts, 0),
      finiteInteger(userDoc?.postsCount, 0),
      finiteInteger(userDoc?.postCount, 0)
    );
    const cached = await globalCache.get<number>(entityCacheKeys.userPostCount(viewerId));
    if (typeof cached === "number" && Number.isFinite(cached)) return Math.floor(cached);
    const verifiedEmbeddedCount = this.readVerifiedEmbeddedUserPostCount(userDoc);
    if (typeof verifiedEmbeddedCount === "number") {
      void globalCache.set(entityCacheKeys.userPostCount(viewerId), verifiedEmbeddedCount, 30_000).catch(() => undefined);
      return verifiedEmbeddedCount;
    }
    try {
      const db = this.requireDb();
      incrementDbOps("queries", 1);
      const snap = await db.collection("posts").where("userId", "==", viewerId).count().get();
      const count = Math.max(0, finiteInteger(snap.data().count, 0));
      void globalCache.set(entityCacheKeys.userPostCount(viewerId), count, 30_000).catch(() => undefined);
      if (count !== userTotal) {
        void db
          .collection("users")
          .doc(viewerId)
          .set(
            {
              numPosts: count,
              postCount: count,
              postsCount: count,
              postCountVerifiedAtMs: Date.now(),
              postCountVerifiedValue: count
            },
            { merge: true }
          )
          .catch(() => undefined);
      }
      return count;
    } catch {
      return Math.max(stateTotal, progressTotal, userTotal);
    }
  }

  private readVerifiedEmbeddedUserPostCount(userDoc?: FirestoreMap | null): number | null {
    const embeddedCount = Math.max(
      0,
      finiteInteger(userDoc?.numPosts, 0),
      finiteInteger(userDoc?.postsCount, 0),
      finiteInteger(userDoc?.postCount, 0)
    );
    const verifiedCount = finiteInteger(userDoc?.postCountVerifiedValue, -1);
    const verifiedAtMs = finiteInteger(userDoc?.postCountVerifiedAtMs, 0);
    const verifiedIsFresh =
      verifiedAtMs > 0 && Date.now() - verifiedAtMs <= AchievementsRepository.VERIFIED_POST_COUNT_TTL_MS;
    if (!verifiedIsFresh || verifiedCount < 0 || verifiedCount !== embeddedCount) {
      return null;
    }
    return embeddedCount;
  }

  private mapLeaderboardEntry(
    userId: string,
    userDoc: FirestoreMap,
    stateDoc: FirestoreMap,
    rank: number,
    metric: "xp.current" | "totalPosts"
  ): AchievementLeaderboardEntryRead {
    const xp = mapStateXp(stateDoc);
    const totalPosts = Math.max(0, finiteInteger(stateDoc.totalPosts, finiteInteger(userDoc.numPosts, 0)));
    const score = metric === "xp.current" ? xp.current : totalPosts;
    return {
      rank,
      userId,
      userName: firstNonEmptyString(userDoc.name, userDoc.displayName, userDoc.username) ?? "Locava user",
      profilePic: firstNonEmptyString(userDoc.profilePic, userDoc.profilePicSmall),
      score,
      totalPosts,
      level: xp.level,
      tier: xp.tier,
      xpUpdatedAtMs: undefined
    };
  }

  private async getViewerRankForMetric(
    viewerId: string,
    metric: "xp.current" | "totalPosts",
    viewerValue?: number
  ): Promise<number | null> {
    const resolvedViewerValue =
      viewerValue ??
      (metric === "xp.current"
        ? finiteInteger(asObject((await this.ensureAchievementStateDoc(viewerId))?.xp).current, 0)
        : await this.getCanonicalTotalPosts(viewerId));
    if (metric === "xp.current") {
      const rows = await this.loadGlobalXpCacheRows();
      const exact = rows.find((row) => row.userId === viewerId);
      if (exact?.rank) return exact.rank;
      return Math.max(1, rows.filter((row) => row.xp > resolvedViewerValue).length + 1);
    }
    const rows = await this.loadGlobalPostsCacheRows();
    const exact = rows.find((row) => row.userId === viewerId);
    if (exact?.rank) return exact.rank;
    return Math.max(1, rows.filter((row) => row.totalPosts > resolvedViewerValue).length + 1);
  }

  private computeViewerRankFromXpRows(
    viewerId: string,
    rows: Array<{ userId: string; xp: number; rank?: number }>,
    viewerValue: number
  ): number | null {
    const exact = rows.find((row) => row.userId === viewerId);
    if (exact?.rank) return exact.rank;
    return Math.max(1, rows.filter((row) => row.xp > viewerValue).length + 1);
  }

  private computeViewerRankFromPostRows(
    viewerId: string,
    rows: Array<{ userId: string; totalPosts: number; rank?: number }>,
    viewerValue: number
  ): number | null {
    const exact = rows.find((row) => row.userId === viewerId);
    if (exact?.rank) return exact.rank;
    return Math.max(1, rows.filter((row) => row.totalPosts > viewerValue).length + 1);
  }

  private async loadCacheDoc<T>(docId: string): Promise<T | null> {
    const db = this.requireDb();
    incrementDbOps("queries", 1);
    const snap = await db.collection("cache").doc(docId).get();
    incrementDbOps("reads", snap.exists ? 1 : 0);
    if (!snap.exists) return null;
    return ((snap.data() as T | undefined) ?? null) as T | null;
  }

  private async loadLeagueDefinitionsSnapshot(): Promise<AchievementLeagueDefinition[] | null> {
    type LeagueCacheDoc = FirestoreMap & {
      leagues?: unknown;
      items?: unknown;
      definitions?: unknown;
    };
    const cached = await this.loadCacheDoc<LeagueCacheDoc>(ACHIEVEMENTS_LEAGUES_CACHE_DOC_ID);
    if (!cached) return null;
    const source = Array.isArray(cached.leagues)
      ? cached.leagues
      : Array.isArray(cached.items)
        ? cached.items
        : Array.isArray(cached.definitions)
          ? cached.definitions
          : [];
    const leagues = asArray<FirestoreMap>(source)
      .map((row, index) => mapLeagueCacheRow(row, `league-${index + 1}`))
      .filter((row) => row.active)
      .sort((a, b) => a.order - b.order);
    void globalCache.set(achievementsLeagueDefinitionsCacheKey(), leagues, ACHIEVEMENTS_LEAGUES_CACHE_TTL_MS).catch(() => undefined);
    return leagues;
  }

  private queueLeagueDefinitionsSnapshotWarm(): void {
    if (this.leagueSnapshotWarmScheduled) return;
    this.leagueSnapshotWarmScheduled = true;
    scheduleBackgroundWork(async () => {
      try {
        await this.refreshLeagueDefinitionsSnapshot();
      } finally {
        this.leagueSnapshotWarmScheduled = false;
      }
    });
  }

  private async refreshLeagueDefinitionsSnapshot(): Promise<AchievementLeagueDefinition[]> {
    const db = this.requireDb();
    let snap;
    try {
      snap = await db.collection("leagues").where("active", "==", true).orderBy("order", "asc").get();
    } catch {
      snap = await db.collection("leagues").get();
    }
    const leagues = snap.docs
      .map((doc) => mapLeagueDocument(doc.id, (doc.data() as FirestoreMap) ?? {}))
      .filter((row) => row.active)
      .sort((a, b) => a.order - b.order);
    const response: AchievementsLeaguesResponse = {
      routeName: "achievements.leagues.get",
      leagues,
      degraded: false,
      fallbacks: []
    };
    await Promise.all([
      globalCache.set(achievementsLeagueDefinitionsCacheKey(), leagues, ACHIEVEMENTS_LEAGUES_CACHE_TTL_MS),
      globalCache.set(buildCacheKey("bootstrap", ["achievements-leagues-v1"]), response, ACHIEVEMENTS_LEAGUES_CACHE_TTL_MS),
      db.collection("cache").doc(ACHIEVEMENTS_LEAGUES_CACHE_DOC_ID).set(
        {
          leagues,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: Date.now()
        },
        { merge: true }
      )
    ]);
    return leagues;
  }

  private async loadGlobalXpCacheRows(): Promise<
    Array<{
      userId: string;
      userName: string;
      profilePic: string | null;
      xp: number;
      level: number | null;
      tier: string | null;
      xpUpdatedAtMs: number | undefined;
      rank?: number;
    }>
  > {
    type CacheRow = FirestoreMap & {
      userId?: string;
      userName?: string;
      userPic?: string;
      xp?: unknown;
      level?: unknown;
      tier?: unknown;
      xpUpdatedAtMs?: unknown;
      rank?: unknown;
    };
    type CacheDoc = { entries?: CacheRow[] };
    const cached = await this.loadCacheDoc<CacheDoc>("global_xp_leaderboard_v2");
    return asArray<CacheRow>(cached?.entries)
      .map((row, index) => ({
        userId: firstNonEmptyString(row.userId) ?? "",
        userName: firstNonEmptyString(row.userName) ?? "Locava user",
        profilePic: firstNonEmptyString(row.userPic),
        xp: Math.max(0, finiteInteger(row.xp, 0)),
        level: positiveIntegerOrNull(row.level),
        tier: firstNonEmptyString(row.tier),
        xpUpdatedAtMs: positiveIntegerOrNull(row.xpUpdatedAtMs) ?? undefined,
        rank: Math.max(1, finiteInteger(row.rank, index + 1))
      }))
      .filter((row) => Boolean(row.userId))
      .sort((a, b) => b.xp - a.xp || (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
  }

  private async loadGlobalPostsCacheRows(): Promise<
    Array<{
      userId: string;
      userName: string;
      profilePic: string | null;
      totalPosts: number;
      rank?: number;
    }>
  > {
    type CacheRow = FirestoreMap & {
      userId?: string;
      userName?: string;
      userPic?: string;
      totalPosts?: unknown;
      rank?: unknown;
    };
    type CacheDoc = { leaderboard?: CacheRow[] };
    const cached =
      (await this.loadCacheDoc<CacheDoc>("global_posts_leaderboard_200")) ??
      (await this.loadCacheDoc<CacheDoc>("global_posts_leaderboard_100"));
    return asArray<CacheRow>(cached?.leaderboard)
      .map((row, index) => ({
        userId: firstNonEmptyString(row.userId) ?? "",
        userName: firstNonEmptyString(row.userName) ?? "Locava user",
        profilePic: firstNonEmptyString(row.userPic),
        totalPosts: Math.max(0, finiteInteger(row.totalPosts, 0)),
        rank: Math.max(1, finiteInteger(row.rank, index + 1))
      }))
      .filter((row) => Boolean(row.userId))
      .sort(
        (a, b) =>
          b.totalPosts - a.totalPosts || (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)
      );
  }

  private async loadCommunityXpCacheRows(viewerId: string): Promise<{
    cityName: string | null;
    rows: Array<{
      userId: string;
      userName: string;
      profilePic: string | null;
      xp: number;
      level: number | null;
      tier: string | null;
      xpUpdatedAtMs: number | undefined;
      rank?: number;
      isCurrentUser: boolean;
    }>;
  }> {
    type CacheRow = FirestoreMap & {
      userId?: string;
      userName?: string;
      userPic?: string;
      xp?: unknown;
      level?: unknown;
      tier?: unknown;
      xpUpdatedAtMs?: unknown;
      rank?: unknown;
      isCurrentUser?: unknown;
    };
    type CacheDoc = {
      cityName?: unknown;
      leaderboard?: CacheRow[];
    };
    const cached = await this.loadCacheDoc<CacheDoc>(`community_xp_leaderboard_v2_${viewerId}`);
    return {
      cityName: firstNonEmptyString(cached?.cityName),
      rows: asArray<CacheRow>(cached?.leaderboard)
        .map((row, index) => ({
          userId: firstNonEmptyString(row.userId) ?? "",
          userName: firstNonEmptyString(row.userName) ?? "Locava user",
          profilePic: firstNonEmptyString(row.userPic),
          xp: Math.max(0, finiteInteger(row.xp, 0)),
          level: positiveIntegerOrNull(row.level),
          tier: firstNonEmptyString(row.tier),
          xpUpdatedAtMs: positiveIntegerOrNull(row.xpUpdatedAtMs) ?? undefined,
          rank: Math.max(1, finiteInteger(row.rank, index + 1)),
          isCurrentUser: row.isCurrentUser === true
        }))
        .filter((row) => Boolean(row.userId))
        .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
    };
  }

  private async clearViewerCaches(viewerId: string, opts: { includeLeaderboards: boolean }): Promise<void> {
    const keys = [
      achievementsStateCacheKey(viewerId),
      achievementsProgressCacheKey(viewerId),
      achievementsBadgesCacheKey(viewerId),
      achievementsCompetitiveBadgesCacheKey(viewerId),
      achievementsEarnedBadgeCountCacheKey(viewerId),
      achievementsWeeklyExplorationCacheKey(viewerId, WEEKLY_STREAK_POST_LIMIT),
      buildCacheKey("bootstrap", ["achievements-hero-v1", viewerId]),
      buildCacheKey("bootstrap", ["achievements-snapshot-v1", viewerId]),
      buildCacheKey("bootstrap", ["achievements-status-v1", viewerId]),
      buildCacheKey("bootstrap", ["achievements-badges-v1", viewerId]),
      entityCacheKeys.userPostCount(viewerId)
    ];
    if (opts.includeLeaderboards) {
      keys.push(
        buildCacheKey("bootstrap", ["achievements-lb-v1", viewerId, "xp_global", ""]),
        buildCacheKey("bootstrap", ["achievements-lb-v1", viewerId, "xp_friends", ""]),
        buildCacheKey("bootstrap", ["achievements-lb-v1", viewerId, "xp_group", ""]),
        buildCacheKey("bootstrap", ["achievements-lb-v1", viewerId, "posts_global", ""]),
        buildCacheKey("bootstrap", ["achievements-lb-v1", viewerId, "posts_friends", ""]),
        buildCacheKey("bootstrap", ["achievements-lb-v1", viewerId, "friends", ""]),
        buildCacheKey("bootstrap", ["achievements-lb-v1", viewerId, "city", ""])
      );
      const leagues = await globalCache.get<AchievementLeagueDefinition[]>(achievementsLeagueDefinitionsCacheKey());
      (leagues ?? []).forEach((league) => {
        keys.push(buildCacheKey("bootstrap", ["achievements-lb-v1", viewerId, "xp_league", league.id]));
      });
    }
    await Promise.all([...new Set(keys)].map((key) => globalCache.del(key)));
    await invalidateRouteCacheByTags([
      `route:profile.achievements:${viewerId}`,
      `route:profile.bootstrap:${viewerId}`,
    ]).catch(() => []);
  }

  private async clearScreenOpenedCaches(viewerId: string): Promise<void> {
    const keys = [
      buildCacheKey("bootstrap", ["achievements-bootstrap-v1", viewerId]),
      buildCacheKey("bootstrap", ["achievements-snapshot-v1", viewerId]),
      buildCacheKey("bootstrap", ["achievements-snapshot-shell-v1", viewerId]),
      buildCacheKey("bootstrap", ["achievements-status-v1", viewerId])
    ];
    await Promise.all(keys.map((key) => globalCache.del(key)));
  }
}

export const achievementsRepository = new AchievementsRepository();
