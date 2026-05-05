import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { LegendsAfterPostParamsSchema, legendsAfterPostContract } from "../../contracts/surfaces/legends-after-post.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { incrementDbOps, setRouteName } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { achievementCelebrationsService } from "../../services/surfaces/achievement-celebrations.service.js";

type FirestoreMap = Record<string, unknown>;
function isSupportedScopeId(scopeId: string): boolean {
  if (scopeId.startsWith("activity:")) return true;
  if (scopeId.startsWith("place:state:") || scopeId.startsWith("place:country:")) return true;
  if (scopeId.startsWith("placeActivity:state:") || scopeId.startsWith("placeActivity:country:")) return true;
  return false;
}

function asObject(value: unknown): FirestoreMap {
  if (value && typeof value === "object") return value as FirestoreMap;
  return {};
}

function finiteInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return fallback;
}

function parseScope(scopeId: string): { scopeKey: string | null; activityKey: string | null } {
  const parts = String(scopeId ?? "").split(":").map((v) => v.trim());
  if (parts[0] === "placeActivity") {
    return { scopeKey: parts.slice(0, 3).join(":"), activityKey: parts[3] ?? null };
  }
  if (parts[0] === "activity") {
    return { scopeKey: "activity:global", activityKey: parts[1] ?? null };
  }
  if (parts[0] === "place") {
    return { scopeKey: parts.slice(0, 3).join(":"), activityKey: null };
  }
  return { scopeKey: scopeId || null, activityKey: null };
}

export async function registerV2LegendsAfterPostRoutes(app: FastifyInstance): Promise<void> {
  app.get(legendsAfterPostContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("posting", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Legends v2 surface is not enabled for this viewer"));
    }
    setRouteName(legendsAfterPostContract.routeName);
    const db = getFirestoreSourceClient();
    if (!db) {
      return success({
        routeName: legendsAfterPostContract.routeName,
        postId: "",
        status: "error",
        hasNewAwards: false,
        shouldShowAwardScreen: false,
        retryAfterMs: 0,
        xpSettled: false,
        xpDelta: 0,
        xpClaim: null,
        leaguePassCelebration: null,
        pendingCelebrations: [],
        awards: []
      });
    }
    const params = LegendsAfterPostParamsSchema.parse(request.params);
    request.log.info({
      event: "legends_afterpost_lookup_start",
      viewerId: viewer.viewerId,
      postId: params.postId
    });
    const resSnap = await db.collection("legendPostResults").doc(params.postId).get();
    incrementDbOps("reads", resSnap.exists ? 1 : 0);
    const startedAt = Date.now();
    if (!resSnap.exists) {
      const processedSnap = await db.collection("legendProcessedPosts").doc(params.postId).get();
      incrementDbOps("reads", processedSnap.exists ? 1 : 0);
      const stageId = processedSnap.exists ? String((processedSnap.data() as FirestoreMap | undefined)?.stageId ?? "") : "";
      const stageSnap = stageId ? await db.collection("legendPostStages").doc(stageId).get() : null;
      incrementDbOps("reads", stageSnap?.exists ? 1 : 0);
      const reasonIfEmpty = !processedSnap.exists
        ? "missing_post"
        : !stageSnap?.exists
          ? "stage_missing"
          : "computation_timeout";
      request.log.info({
        event: "legends_afterpost_missing_diagnostics",
        postId: params.postId,
        viewerId: viewer.viewerId,
        legendPostResultsExists: false,
        legendProcessedPostExists: processedSnap.exists,
        stageId: stageId || null,
        stageExists: Boolean(stageSnap?.exists),
        reasonIfEmpty
      });
      request.log.info({
        event: "legends_afterpost_summary",
        postId: params.postId,
        viewerId: viewer.viewerId,
        postFound: false,
        stagedPostFound: Boolean(stageSnap?.exists),
        finalizedPostFound: processedSnap.exists,
        eventCreated: false,
        eventReturned: false,
        reasonIfEmpty,
        latencyMs: Date.now() - startedAt
      });
      return success({
        routeName: legendsAfterPostContract.routeName,
        postId: params.postId,
        status: "pending",
        hasNewAwards: false,
        shouldShowAwardScreen: false,
        retryAfterMs: 500,
        awards: [],
        reasonIfEmpty
      });
    }
    const row = (resSnap.data() as FirestoreMap | undefined) ?? {};
    request.log.info({
      event: "legends_afterpost_result_row_loaded",
      postId: params.postId,
      viewerId: viewer.viewerId,
      status: String(row.status ?? "pending"),
      awardIdsCount: Array.isArray(row.awardIds) ? row.awardIds.length : 0,
      awardsCount: Array.isArray(row.awards) ? row.awards.length : 0,
      hasRewardsObject: Boolean(row.rewards && typeof row.rewards === "object")
    });
    const awardSnap = await db.collection("users").doc(viewer.viewerId).collection("achievements_awards").doc(params.postId).get();
    incrementDbOps("reads", awardSnap.exists ? 1 : 0);
    const awardRow = (awardSnap.data() as FirestoreMap | undefined) ?? {};
    const deltaRow = asObject(awardRow.delta);
    const leaguePassCelebration =
      deltaRow && typeof deltaRow === "object" && deltaRow.leaguePassCelebration && typeof deltaRow.leaguePassCelebration === "object"
        ? (deltaRow.leaguePassCelebration as Record<string, unknown>)
        : null;
    const pendingCelebrations = await achievementCelebrationsService.getPendingCelebrations(viewer.viewerId);
    const fromPending =
      pendingCelebrations.length > 0 && !leaguePassCelebration
        ? pendingCelebrations[0]
        : null;
    const directCelebration = leaguePassCelebration
      ? {
          shouldShow: leaguePassCelebration.shouldShow === true,
          leaderboardKey: String(leaguePassCelebration.leaderboardKey ?? "xp_global"),
          previousRank:
            typeof leaguePassCelebration.previousRank === "number" ? Math.max(1, finiteInt(leaguePassCelebration.previousRank, 1)) : null,
          newRank: typeof leaguePassCelebration.newRank === "number" ? Math.max(1, finiteInt(leaguePassCelebration.newRank, 1)) : null,
          peoplePassed: Math.max(0, finiteInt(leaguePassCelebration.peoplePassed, 0)),
          previousLeague: typeof leaguePassCelebration.previousLeague === "string" ? leaguePassCelebration.previousLeague : null,
          newLeague: typeof leaguePassCelebration.newLeague === "string" ? leaguePassCelebration.newLeague : null,
          celebrationId: String(leaguePassCelebration.celebrationId ?? ""),
          xpDelta: Math.max(0, finiteInt(leaguePassCelebration.xpDelta, 0)),
          previousXp: Math.max(0, finiteInt(leaguePassCelebration.previousXp, 0)),
          newXp: Math.max(0, finiteInt(leaguePassCelebration.newXp, 0)),
          source: typeof leaguePassCelebration.source === "string" ? leaguePassCelebration.source : null,
          sourcePostId: typeof leaguePassCelebration.sourcePostId === "string" ? leaguePassCelebration.sourcePostId : params.postId,
          entries: Array.isArray(leaguePassCelebration.entries)
            ? leaguePassCelebration.entries
                .map((entry) => asObject(entry))
                .map((entry) => ({
                  userId: String(entry.userId ?? ""),
                  userName: String(entry.userName ?? "Explorer"),
                  userPic: typeof entry.userPic === "string" ? entry.userPic : null,
                  rank: Math.max(1, finiteInt(entry.rank, 1)),
                  xp: Math.max(0, finiteInt(entry.xp, 0)),
                  isCurrentUser: entry.isCurrentUser === true
                }))
                .filter((entry) => entry.userId.length > 0)
            : undefined,
          createdAtMs: Math.max(0, finiteInt(leaguePassCelebration.createdAtMs, Date.now())),
          consumedAtMs:
            typeof leaguePassCelebration.consumedAtMs === "number" ? Math.max(0, finiteInt(leaguePassCelebration.consumedAtMs, 0)) : null
        }
      : null;
    const statusRaw = String(row.status ?? "pending");
    const status = statusRaw === "ready" || statusRaw === "none" || statusRaw === "error" || statusRaw === "pending" ? statusRaw : "pending";
    const awards = Array.isArray(row.awards) ? (row.awards as any[]).map((a) => asObject(a)).map((a) => ({
      awardId: String(a.awardId ?? ""),
      awardType: String(a.awardType ?? ""),
      scopeId: String(a.scopeId ?? ""),
      scopeType: String(a.scopeType ?? ""),
      title: String(a.title ?? ""),
      subtitle: String(a.subtitle ?? ""),
      postId: String(a.postId ?? params.postId),
      previousRank: a.previousRank == null ? null : Math.max(1, finiteInt(a.previousRank, 1)),
      newRank: a.newRank == null ? null : Math.max(1, finiteInt(a.newRank, 1)),
      userCount: Math.max(0, finiteInt(a.userCount, 0)),
      leaderCount: Math.max(0, finiteInt(a.leaderCount, 0)),
      deltaToLeader: Math.max(0, finiteInt(a.deltaToLeader, 0)),
      createdAt: a.createdAt,
      seen: a.seen === true
    })).filter((a) => Boolean(a.awardId) && Boolean(a.awardType) && Boolean(a.scopeId) && Boolean(a.scopeType) && Boolean(a.title)) : [];
    const unseenAwards = awards.filter((a) => a.seen !== true && isSupportedScopeId(a.scopeId));
    if (unseenAwards.length > 0 && typeof (db as { batch?: unknown }).batch === "function") {
      const batch = db.batch();
      for (const award of unseenAwards.slice(0, 20)) {
        if (!award.awardId) continue;
        batch.set(
          db.collection("users").doc(viewer.viewerId).collection("legendAwards").doc(award.awardId),
          { seen: true, seenAt: Date.now() },
          { merge: true }
        );
      }
      await batch.commit().catch(() => {});
    }
    const rewards =
      row.rewards && typeof row.rewards === "object"
        ? (row.rewards as Record<string, unknown>)
        : {
            postId: params.postId,
            viewerId: viewer.viewerId,
            hasRewards: false,
            earnedFirstLegends: [],
            earnedRankLegends: [],
            rankChanges: [],
            closeTargets: [],
            overtakenUsers: [],
            displayCards: []
          };
    const displayCards = Array.isArray((rewards as { displayCards?: unknown }).displayCards)
      ? ((rewards as { displayCards: Array<Record<string, unknown>> }).displayCards)
      : [];
    const firstCard = displayCards[0] ?? null;
    const topAward = awards[0] ?? null;
    const parsed = parseScope(topAward?.scopeId ?? "");
    const currentRank = topAward?.newRank ?? (typeof firstCard?.rank === "number" ? Math.max(1, finiteInt(firstCard.rank, 1)) : null);
    const previousRank = topAward?.previousRank ?? null;
    const distanceToLegend = topAward ? Math.max(0, finiteInt(topAward.deltaToLeader, 0)) : null;
    const becameLegend = Boolean(currentRank === 1 && previousRank !== 1);
    const podiumRank = currentRank != null && currentRank <= 3 ? currentRank : null;
    const eventReturned = awards.length > 0 || displayCards.length > 0;
    const reasonIfEmpty = eventReturned
      ? null
      : status === "pending"
        ? "computation_timeout"
        : "not_top_or_close";
    request.log.info({
      event: "legends_afterpost_summary",
      postId: params.postId,
      viewerId: viewer.viewerId,
      activityKey: parsed.activityKey,
      scopeKey: parsed.scopeKey,
      scopeLabel: topAward?.subtitle ?? null,
      postFound: true,
      stagedPostFound: true,
      finalizedPostFound: true,
      eventCreated: Boolean(awards.length > 0),
      eventReturned,
      unseenAwardCount: unseenAwards.length,
      becameLegend,
      currentRank,
      podiumRank,
      distanceToLegend,
      reasonIfEmpty,
      latencyMs: Date.now() - startedAt
    });
    return success({
      routeName: legendsAfterPostContract.routeName,
      postId: params.postId,
      status,
      hasNewAwards: unseenAwards.length > 0,
      shouldShowAwardScreen: unseenAwards.length > 0,
      retryAfterMs: status === "pending" ? 500 : 0,
      processedAt: row.processedAt ?? row.completedAt ?? null,
      xpSettled: awardSnap.exists && (awardRow.delta != null || finiteInt(awardRow.xp, 0) > 0),
      xpDelta: Math.max(0, finiteInt(deltaRow.xpGained ?? awardRow.xp, 0)),
      xpClaim: awardSnap.exists
        ? {
            xpGained: Math.max(0, finiteInt(deltaRow.xpGained ?? awardRow.xp, 0)),
            newTotalXP: deltaRow.newTotalXP == null ? null : Math.max(0, finiteInt(deltaRow.newTotalXP, 0)),
            newLevel: deltaRow.newLevel == null ? null : Math.max(1, finiteInt(deltaRow.newLevel, 1)),
            tier: typeof deltaRow.tier === "string" ? String(deltaRow.tier) : null
          }
        : null,
      leaguePassCelebration: directCelebration ?? fromPending,
      pendingCelebrations,
      awards: unseenAwards,
      rewards,
      reasonIfEmpty,
      legendStatus: {
        activityKey: parsed.activityKey,
        activityLabel: typeof firstCard?.activityLabel === "string" ? firstCard.activityLabel : null,
        scopeKey: parsed.scopeKey,
        scopeLabel: topAward?.subtitle ?? null,
        currentRank,
        previousRank,
        podiumRank,
        distanceToLegend,
        becameLegend
      }
    });
  });
}

