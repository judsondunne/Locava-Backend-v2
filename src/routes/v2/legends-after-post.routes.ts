import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { LegendsAfterPostParamsSchema, legendsAfterPostContract } from "../../contracts/surfaces/legends-after-post.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { incrementDbOps, setRouteName } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

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
      pollAfterMs: status === "processing" ? 500 : 0,
      awards,
      rewards
    });
  });
}

