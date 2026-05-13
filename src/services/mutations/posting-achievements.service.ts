import { FieldValue } from "firebase-admin/firestore";
import {
  type AchievementDelta,
  type AchievementLeaguePassCelebration,
  type AchievementSnapshot
} from "../../contracts/entities/achievement-entities.contract.js";
import { achievementsRepository, computeWeeklyExplorationFromPostRows } from "../../repositories/surfaces/achievements.repository.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { achievementCelebrationsService } from "../surfaces/achievement-celebrations.service.js";
import {
  asArray,
  asObject,
  buildXpState,
  finiteInteger,
  firstNonEmptyString,
  getDateString,
  normalizeActivityId,
  toIsoString
} from "../surfaces/achievements-core.js";

type FirestoreMap = Record<string, unknown>;

type BadgeDefinitionRead = {
  id: string;
  name: string;
  description: string;
  statKey: string;
  targetNumber: number;
  ruleType?: string;
  activityType?: string;
  active?: boolean;
};

const POST_CREATE_XP = 50;
const POST_STREAK_SCAN_LIMIT = 500;

function buildMinimalDelta(params: {
  currentXP: number;
  currentLevel: number;
  tier: string;
  xpGained: number;
  deltaError?: string | null;
}): AchievementDelta {
  const xpState = buildXpState(params.currentXP);
  return {
    xpGained: params.xpGained,
    newTotalXP: params.currentXP,
    leveledUp: xpState.level > params.currentLevel,
    newLevel: xpState.level,
    tier: params.tier || xpState.tier,
    progressBumps: [],
    weeklyCapture: null,
    newlyUnlockedBadges: [],
    uiEvents: params.xpGained > 0 ? ["XP_TOAST"] : [],
    competitiveBadgeUnlocks: [],
    leaguePassCelebration: null,
    postSuccessMessage: null,
    ...(params.deltaError ? { deltaError: params.deltaError } : {})
  };
}

function parseLeaguePassCelebration(value: unknown): AchievementLeaguePassCelebration | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<AchievementLeaguePassCelebration>;
  const celebrationId = typeof row.celebrationId === "string" ? row.celebrationId.trim() : "";
  if (!celebrationId) return null;
  return {
    shouldShow: row.shouldShow === true,
    leaderboardKey: typeof row.leaderboardKey === "string" && row.leaderboardKey.trim() ? row.leaderboardKey.trim() : "xp_global",
    previousRank: typeof row.previousRank === "number" && Number.isFinite(row.previousRank) ? Math.max(1, Math.trunc(row.previousRank)) : null,
    newRank: typeof row.newRank === "number" && Number.isFinite(row.newRank) ? Math.max(1, Math.trunc(row.newRank)) : null,
    peoplePassed: typeof row.peoplePassed === "number" && Number.isFinite(row.peoplePassed) ? Math.max(0, Math.trunc(row.peoplePassed)) : 0,
    previousLeague: typeof row.previousLeague === "string" ? row.previousLeague : null,
    newLeague: typeof row.newLeague === "string" ? row.newLeague : null,
    celebrationId,
    xpDelta: typeof row.xpDelta === "number" && Number.isFinite(row.xpDelta) ? Math.max(0, Math.trunc(row.xpDelta)) : undefined,
    previousXp: typeof row.previousXp === "number" && Number.isFinite(row.previousXp) ? Math.max(0, Math.trunc(row.previousXp)) : undefined,
    newXp: typeof row.newXp === "number" && Number.isFinite(row.newXp) ? Math.max(0, Math.trunc(row.newXp)) : undefined,
    source: typeof row.source === "string" ? row.source : null,
    sourcePostId: typeof row.sourcePostId === "string" ? row.sourcePostId : null,
    createdAtMs: typeof row.createdAtMs === "number" && Number.isFinite(row.createdAtMs) ? Math.max(0, Math.trunc(row.createdAtMs)) : undefined,
    consumedAtMs:
      typeof row.consumedAtMs === "number" && Number.isFinite(row.consumedAtMs) ? Math.max(0, Math.trunc(row.consumedAtMs)) : null
  };
}

function toAwardedDelta(value: unknown): AchievementDelta | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<AchievementDelta>;
  if (typeof row.xpGained !== "number" || typeof row.newTotalXP !== "number" || !Array.isArray(row.progressBumps)) {
    return null;
  }
  return {
    xpGained: Math.max(0, finiteInteger(row.xpGained, 0)),
    newTotalXP: Math.max(0, finiteInteger(row.newTotalXP, 0)),
    leveledUp: row.leveledUp === true,
    ...(typeof row.newLevel === "number" ? { newLevel: Math.max(1, finiteInteger(row.newLevel, 1)) } : {}),
    ...(typeof row.tier === "string" && row.tier.trim() ? { tier: row.tier.trim() } : {}),
    progressBumps: row.progressBumps,
    weeklyCapture: row.weeklyCapture ?? null,
    newlyUnlockedBadges: Array.isArray(row.newlyUnlockedBadges) ? row.newlyUnlockedBadges.map((entry) => String(entry)) : [],
    uiEvents: Array.isArray(row.uiEvents) ? row.uiEvents : [],
    competitiveBadgeUnlocks: Array.isArray(row.competitiveBadgeUnlocks) ? row.competitiveBadgeUnlocks : [],
    leaguePassCelebration: parseLeaguePassCelebration(row.leaguePassCelebration),
    postSuccessMessage: typeof row.postSuccessMessage === "string" ? row.postSuccessMessage : null,
    deltaError: typeof row.deltaError === "string" ? row.deltaError : undefined
  };
}

function computeBadgeProgressValue(
  definition: BadgeDefinitionRead,
  stateDoc: FirestoreMap,
  progressDocs: Map<string, FirestoreMap>
): number {
  const statKey = definition.statKey;
  if (definition.ruleType === "StreakDays" || statKey === "Streak Days") {
    return Math.max(0, finiteInteger(asObject(stateDoc.streak).current, 0));
  }
  if (statKey === "Posts Created" || statKey === "Total Posts") {
    return Math.max(0, finiteInteger(progressDocs.get("total_posts")?.value, finiteInteger(stateDoc.totalPosts, 0)));
  }
  if (statKey === "Unique Spots" || statKey === "Places Visited") {
    return asArray(progressDocs.get("unique_spots")?.value).length;
  }
  if (statKey === "weekly_captures_completed" || definition.ruleType === "WeeklyCaptureCompletion") {
    return Math.max(0, finiteInteger(progressDocs.get("weekly_captures_completed")?.value, 0));
  }
  if (definition.activityType) {
    return Math.max(0, finiteInteger(progressDocs.get(`activity_${definition.activityType}`)?.value, 0));
  }
  if (statKey.startsWith("activity_")) {
    return Math.max(0, finiteInteger(progressDocs.get(statKey)?.value, 0));
  }
  const normalizedKey = statKey.toLowerCase().replace(/\s+/g, "_");
  const rawValue = progressDocs.get(normalizedKey)?.value ?? progressDocs.get(statKey)?.value;
  if (Array.isArray(rawValue)) return rawValue.length;
  return Math.max(0, finiteInteger(rawValue, 0));
}

async function loadRecentPosts(userId: string): Promise<Array<{ createdAt?: unknown; time?: unknown; timestamp?: unknown; activities?: unknown }>> {
  const db = getFirestoreSourceClient();
  if (!db) return [];
  let snap;
  try {
    snap = await db.collection("posts").where("userId", "==", userId).orderBy("createdAt", "desc").limit(POST_STREAK_SCAN_LIMIT).get();
  } catch {
    snap = await db.collection("posts").where("userId", "==", userId).limit(POST_STREAK_SCAN_LIMIT).get();
  }
  if (snap.docs.length === 0) {
    const ownerSnap = await db.collection("posts").where("ownerId", "==", userId).limit(POST_STREAK_SCAN_LIMIT).get();
    return ownerSnap.docs.map((doc) => ((doc.data() as FirestoreMap | undefined) ?? {}));
  }
  return snap.docs.map((doc) => ((doc.data() as FirestoreMap | undefined) ?? {}));
}

export class PostingAchievementsService {
  private schedulePostCreatedEnrichment(params: {
    userId: string;
    postId: string;
    transactionalDelta: AchievementDelta;
  }): void {
    void this.finishPostCreatedEnrichment(params).catch((error) => {
      console.warn("[posting.achievements] enrichment failed", {
        userId: params.userId,
        postId: params.postId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  private async finishPostCreatedEnrichment(params: {
    userId: string;
    postId: string;
    transactionalDelta: AchievementDelta;
  }): Promise<void> {
    const db = getFirestoreSourceClient();
    if (!db) {
      throw new Error("firestore_unavailable_for_post_achievements_enrichment");
    }
    const awardRef = db.collection("users").doc(params.userId).collection("achievements_awards").doc(params.postId);
    const achievementsRef = db.collection("users").doc(params.userId).collection("achievements").doc("state");
    const progressRef = db.collection("users").doc(params.userId).collection("progress");
    const [stateSnap, progressSnap, badgeDefsSnap, userBadgesSnap, recentPosts] = await Promise.all([
      achievementsRef.get(),
      progressRef.get(),
      db.collection("achievements").orderBy("order", "asc").get().catch(() => db.collection("achievements").get()),
      db.collection("users").doc(params.userId).collection("badges").get(),
      loadRecentPosts(params.userId)
    ]);

    const stateData = (stateSnap.data() as FirestoreMap | undefined) ?? {};
    const progressDocs = new Map<string, FirestoreMap>(
      progressSnap.docs.map((doc) => [doc.id, ((doc.data() as FirestoreMap | undefined) ?? {}) as FirestoreMap])
    );
    const userBadges = new Map<string, FirestoreMap>(
      userBadgesSnap.docs.map((doc) => [doc.id, ((doc.data() as FirestoreMap | undefined) ?? {}) as FirestoreMap])
    );

    const weeklyExploration = computeWeeklyExplorationFromPostRows(recentPosts);
    const weeklyExplorationPostCount = Object.values(weeklyExploration.postCountByDate).reduce((sum, count) => sum + count, 0);

    const badgeBatch = db.batch();
    const newlyUnlockedBadges: string[] = [];
    const badgeDefs: Array<FirestoreMap & BadgeDefinitionRead> = badgeDefsSnap.docs
      .map((doc) => ({ id: doc.id, ...(((doc.data() as FirestoreMap | undefined) ?? {}) as FirestoreMap) }) as FirestoreMap & BadgeDefinitionRead)
      .filter((row) => row.active !== false);

    for (const def of badgeDefs) {
      const current = computeBadgeProgressValue(def, stateData, progressDocs);
      const badgeRef = db.collection("users").doc(params.userId).collection("badges").doc(def.id);
      const existing = userBadges.get(def.id) ?? {};
      const earned = existing.earned === true;
      if (current >= Math.max(1, finiteInteger(def.targetNumber, 1)) && !earned) {
        newlyUnlockedBadges.push(def.id);
        badgeBatch.set(
          badgeRef,
          {
            badgeId: def.id,
            earned: true,
            claimed: false,
            earnedAt: FieldValue.serverTimestamp(),
            claimedAt: null,
            progress: {
              current,
              target: Math.max(1, finiteInteger(def.targetNumber, 1))
            },
            visible: true,
            shareCount: Math.max(0, finiteInteger(existing.shareCount, 0)),
            lastUpdated: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      } else {
        badgeBatch.set(
          badgeRef,
          {
            badgeId: def.id,
            earned,
            claimed: existing.claimed === true,
            progress: {
              current,
              target: Math.max(1, finiteInteger(def.targetNumber, 1))
            },
            visible: existing.visible !== false,
            shareCount: Math.max(0, finiteInteger(existing.shareCount, 0)),
            lastUpdated: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      }
    }

    badgeBatch.set(
      achievementsRef,
      {
        weeklyExploration,
        totalPosts: Math.max(Math.max(0, finiteInteger(stateData.totalPosts, 0)), weeklyExplorationPostCount),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    const delta: AchievementDelta = {
      ...params.transactionalDelta,
      newlyUnlockedBadges,
      uiEvents: [
        ...params.transactionalDelta.uiEvents,
        ...newlyUnlockedBadges.map(() => "BADGE_UNLOCK_MODAL" as const)
      ]
    };

    badgeBatch.set(
      awardRef,
      {
        delta,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    await badgeBatch.commit();

    achievementsRepository.seedPendingDelta(params.userId, {
      xpGained: delta.xpGained,
      newTotalXP: delta.newTotalXP,
      newLevel: delta.newLevel ?? null,
      tier: delta.tier ?? null,
      deltaError: delta.deltaError ?? null
    });
    await achievementsRepository.invalidateViewerProjectionCaches(params.userId, { includeLeaderboards: true });
  }

  async processPostCreated(params: {
    viewerId: string;
    userId: string;
    postId: string;
    activities: string[];
    lat?: number | string;
    long?: number | string;
    address?: string;
    requestAward?: boolean;
  }): Promise<AchievementDelta> {
    const db = getFirestoreSourceClient();
    if (!db) {
      throw new Error("firestore_unavailable_for_post_achievements");
    }

    const normalizedActivities = [...new Set((params.activities ?? []).map((value) => normalizeActivityId(value)).filter(Boolean))];
    console.info("POST_REWARD_CALC_STARTED", {
      postId: params.postId,
      userId: params.userId,
      activities: normalizedActivities,
      requestAward: params.requestAward === true
    });
    const awardRef = db.collection("users").doc(params.userId).collection("achievements_awards").doc(params.postId);
    const achievementsRef = db.collection("users").doc(params.userId).collection("achievements").doc("state");
    const progressRef = db.collection("users").doc(params.userId).collection("progress");
    const today = getDateString(new Date());
    const celebrationId = `league_pass_post_${params.postId}`;

    const transactional = await db.runTransaction(async (tx) => {
      const progressDocRefs = [
        progressRef.doc("total_posts"),
        progressRef.doc("unique_spots"),
        ...normalizedActivities.map((activity) => progressRef.doc(`activity_${activity}`))
      ];
      const [awardDoc, stateDoc, ...progressDocs] = await Promise.all([
        tx.get(awardRef),
        tx.get(achievementsRef),
        ...progressDocRefs.map((ref) => tx.get(ref))
      ]);

      const stateData = (stateDoc.data() as FirestoreMap | undefined) ?? {};
      const currentXP = Math.max(0, finiteInteger(asObject(stateData.xp).current, 0));
      const currentLevel = Math.max(1, finiteInteger(asObject(stateData.xp).level, 1));
      const currentTier = firstNonEmptyString(asObject(stateData.xp).tier) ?? buildXpState(currentXP).tier;

      if (awardDoc.exists) {
        const existingAwardXp = params.requestAward === true ? Math.max(0, finiteInteger((awardDoc.data() as FirestoreMap | undefined)?.xp, POST_CREATE_XP)) : 0;
        console.info("[xp_award_result]", {
          event: "xp_award_result",
          viewerId: params.viewerId,
          userId: params.userId,
          postId: params.postId,
          source: "post_create",
          xpBefore: currentXP,
          xpAfter: currentXP,
          xpDelta: existingAwardXp,
          awardCreated: false,
          alreadyAwarded: true,
          reasonSkipped: "idempotent_existing_award"
        });
        console.info("POST_REWARD_ALREADY_PROCESSED", {
          postId: params.postId,
          userId: params.userId,
          source: "post_create"
        });
        return {
          idempotent: true,
          delta:
            toAwardedDelta((awardDoc.data() as FirestoreMap | undefined)?.delta) ??
            buildMinimalDelta({
              currentXP,
              currentLevel,
              tier: currentTier,
              xpGained: existingAwardXp
            })
        };
      }

      const xpState = buildXpState(currentXP + POST_CREATE_XP);
      const rawStreak = asObject(stateData.streak);
      const lastQualifiedDate = toIsoString(rawStreak.lastQualifiedAt)?.slice(0, 10) ?? "";
      const streakCurrent = Math.max(0, finiteInteger(rawStreak.current, 0));
      const streakLongest = Math.max(0, finiteInteger(rawStreak.longest, 0));
      const nextStreakCurrent = lastQualifiedDate === today ? streakCurrent : streakCurrent + 1;
      const nextStreakLongest = Math.max(streakLongest, nextStreakCurrent);

      const totalPostsPrevious = Math.max(
        0,
        finiteInteger((progressDocs[0]?.data() as FirestoreMap | undefined)?.value, finiteInteger(stateData.totalPosts, 0))
      );
      const totalPostsNext = totalPostsPrevious + 1;
      const uniqueSpotsPrevious = asArray((progressDocs[1]?.data() as FirestoreMap | undefined)?.value).map((value) => String(value ?? ""));
      const uniqueSpotsNext = uniqueSpotsPrevious.includes(params.postId) ? uniqueSpotsPrevious : [...uniqueSpotsPrevious, params.postId];

      tx.set(
        awardRef,
        {
          type: "post_create",
          xp: POST_CREATE_XP,
          celebrationId,
          activities: normalizedActivities,
          location: {
            lat: params.lat ?? null,
            long: params.long ?? null,
            address: params.address ?? ""
          },
          createdAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      tx.set(
        achievementsRef,
        {
          xp: xpState,
          streak: {
            ...rawStreak,
            current: nextStreakCurrent,
            longest: nextStreakLongest,
            lastQualifiedAt: new Date().toISOString()
          },
          xpUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      tx.set(
        progressRef.doc("total_posts"),
        {
          key: "total_posts",
          value: totalPostsNext,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      tx.set(
        progressRef.doc("unique_spots"),
        {
          key: "unique_spots",
          value: uniqueSpotsNext,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      const progressBumps: AchievementDelta["progressBumps"] = [
        { key: "total_posts", label: "Posts", prev: totalPostsPrevious, next: totalPostsNext },
        { key: "unique_spots", label: "Unique spots", prev: uniqueSpotsPrevious.length, next: uniqueSpotsNext.length }
      ];

      normalizedActivities.forEach((activity, index) => {
        const doc = progressDocs[index + 2];
        const previous = Math.max(0, finiteInteger((doc?.data() as FirestoreMap | undefined)?.value, 0));
        const next = previous + 1;
        tx.set(
          progressRef.doc(`activity_${activity}`),
          {
            key: `activity_${activity}`,
            value: next,
            metadata: { activityType: activity },
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
        progressBumps.push({
          key: `activity_${activity}`,
          label: activity.split("_").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" "),
          prev: previous,
          next,
          target: 10
        });
      });

      return {
        idempotent: false,
        delta: {
          xpGained: POST_CREATE_XP,
          newTotalXP: xpState.current,
          leveledUp: xpState.level > currentLevel,
          newLevel: xpState.level,
          tier: xpState.tier,
          progressBumps,
          weeklyCapture: null,
          newlyUnlockedBadges: [],
          uiEvents: [
            "XP_TOAST",
            ...(xpState.level > currentLevel ? (["LEVEL_UP_MODAL"] as const) : []),
            ...progressBumps.map(() => "ACHIEVEMENT_PROGRESS_TOAST" as const)
          ],
          competitiveBadgeUnlocks: [],
          postSuccessMessage: null
        } satisfies AchievementDelta
      };
    });

    if (transactional.idempotent) {
      return transactional.delta;
    }
    console.info("[xp_award_result]", {
      event: "xp_award_result",
      viewerId: params.viewerId,
      userId: params.userId,
      postId: params.postId,
      source: "post_create",
      xpBefore: Math.max(0, transactional.delta.newTotalXP - transactional.delta.xpGained),
      xpAfter: transactional.delta.newTotalXP,
      xpDelta: transactional.delta.xpGained,
      awardCreated: true,
      alreadyAwarded: false,
      reasonSkipped: null
    });
    console.info("POST_REWARD_CALC_SUCCESS", {
      postId: params.postId,
      userId: params.userId,
      xpGained: transactional.delta.xpGained,
      newTotalXP: transactional.delta.newTotalXP,
      leveledUp: transactional.delta.leveledUp === true
    });
    console.info("POST_REWARD_ACTIVITY_DELTA_APPLIED", {
      postId: params.postId,
      userId: params.userId,
      progressBumps: (transactional.delta.progressBumps ?? []).map((b) => ({
        key: b.key,
        prev: b.prev,
        next: b.next
      }))
    });
    achievementsRepository.seedPendingDelta(params.userId, {
      xpGained: transactional.delta.xpGained,
      newTotalXP: transactional.delta.newTotalXP,
      newLevel: transactional.delta.newLevel ?? null,
      tier: transactional.delta.tier ?? null,
      deltaError: transactional.delta.deltaError ?? null
    });
    await achievementsRepository.invalidateViewerProjectionCaches(params.userId, { includeLeaderboards: true });
    const leaguePassCelebration = await achievementCelebrationsService.createLeaguePassCelebration({
      userId: params.userId,
      postId: params.postId,
      xpDelta: transactional.delta.xpGained,
      previousXp: Math.max(0, transactional.delta.newTotalXP - transactional.delta.xpGained),
      newXp: transactional.delta.newTotalXP,
      source: "post_create",
      requestedCelebrationId: celebrationId
    });
    if (leaguePassCelebration) {
      transactional.delta = {
        ...transactional.delta,
        leaguePassCelebration
      };
    }
    this.schedulePostCreatedEnrichment({
      userId: params.userId,
      postId: params.postId,
      transactionalDelta: transactional.delta
    });
    return transactional.delta;
  }
}

export const postingAchievementsService = new PostingAchievementsService();
