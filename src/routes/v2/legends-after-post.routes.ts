import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { LegendsAfterPostParamsSchema, legendsAfterPostContract } from "../../contracts/surfaces/legends-after-post.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { incrementDbOps, setRouteName } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { achievementCelebrationsService } from "../../services/surfaces/achievement-celebrations.service.js";

type FirestoreMap = Record<string, unknown>;

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
        status: "failed",
        xpSettled: false,
        xpDelta: 0,
        xpClaim: null,
        leaguePassCelebration: null,
        pendingCelebrations: [],
        pollAfterMs: 0,
        awards: []
      });
    }
    const params = LegendsAfterPostParamsSchema.parse(request.params);
    const resSnap = await db.collection("legendPostResults").doc(params.postId).get();
    incrementDbOps("reads", resSnap.exists ? 1 : 0);
    if (!resSnap.exists) {
      return success({
        routeName: legendsAfterPostContract.routeName,
        postId: params.postId,
        status: "processing",
        pollAfterMs: 500,
        awards: []
      });
    }
    const row = (resSnap.data() as FirestoreMap | undefined) ?? {};
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
    const statusRaw = String(row.status ?? "processing");
    const status = statusRaw === "complete" || statusRaw === "failed" || statusRaw === "processing" ? statusRaw : "processing";
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
    return success({
      routeName: legendsAfterPostContract.routeName,
      postId: params.postId,
      status,
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
      pollAfterMs: status === "processing" ? 500 : 0,
      awards,
      rewards
    });
  });
}

