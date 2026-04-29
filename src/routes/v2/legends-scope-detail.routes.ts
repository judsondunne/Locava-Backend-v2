import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import {
  LegendsScopeDetailParamsSchema,
  legendsScopeDetailContract
} from "../../contracts/surfaces/legends-scope-detail.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { incrementDbOps, setRouteName } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { legendRepository } from "../../domains/legends/legend.repository.js";

type FirestoreMap = Record<string, unknown>;

function finiteInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return fallback;
}

export async function registerV2LegendsScopeDetailRoutes(app: FastifyInstance): Promise<void> {
  app.get(legendsScopeDetailContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Legends v2 surface is not enabled for this viewer"));
    }
    setRouteName(legendsScopeDetailContract.routeName);
    const db = getFirestoreSourceClient();
    if (!db) {
      return reply.status(503).send(failure("source_of_truth_required", "Firestore unavailable"));
    }
    const params = LegendsScopeDetailParamsSchema.parse(request.params);
    const scopeRef = legendRepository.scopeRef(params.scopeId);
    const statRef = legendRepository.userStatRef(params.scopeId, viewer.viewerId);
    const snaps = await db.getAll(scopeRef, statRef);
    const scopeSnap = snaps[0];
    const statSnap = snaps[1];
    if (!scopeSnap || !statSnap) {
      return reply.status(503).send(failure("source_of_truth_required", "Firestore read unavailable"));
    }
    incrementDbOps("reads", (scopeSnap.exists ? 1 : 0) + (statSnap.exists ? 1 : 0));
    if (!scopeSnap.exists) {
      return reply.status(404).send(failure("legend_scope_not_found", "Legend scope not found"));
    }
    const scope = ((scopeSnap.data() as FirestoreMap | undefined) ?? {}) as FirestoreMap;
    const stat = ((statSnap.data() as FirestoreMap | undefined) ?? {}) as FirestoreMap;
    const leaderCount = Math.max(0, finiteInt(scope.leaderCount, 0));
    const viewerCount = Math.max(0, finiteInt(stat.count, 0));
    const deltaToLeader = Math.max(0, leaderCount - viewerCount);
    const topUsers = Array.isArray(scope.topUsers)
      ? scope.topUsers
          .map((row) => ({
            userId: String((row as any)?.userId ?? ""),
            count: Math.max(0, finiteInt((row as any)?.count, 0))
          }))
          .filter((r) => Boolean(r.userId))
          .slice(0, 5)
      : [];
    const viewerRank = stat.rankSnapshot == null ? null : Math.max(1, finiteInt(stat.rankSnapshot, 1));
    return success({
      routeName: legendsScopeDetailContract.routeName,
      scope: {
        scopeId: params.scopeId,
        scopeType: String(scope.scopeType ?? "cell"),
        title: String(scope.title ?? "Local Legend"),
        subtitle: String(scope.subtitle ?? ""),
        totalPosts: Math.max(0, finiteInt(scope.totalPosts, 0)),
        leaderUserId: typeof scope.leaderUserId === "string" ? scope.leaderUserId : null,
        leaderCount,
        topUsers
      },
      topUsers,
      viewerRank,
      viewerCount,
      deltaToLeader
    });
  });
}

