import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { legendsMeBootstrapContract } from "../../contracts/surfaces/legends-me-bootstrap.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { failure, success } from "../../lib/response.js";
import { incrementDbOps, setRouteName } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { legendRepository } from "../../domains/legends/legend.repository.js";

type FirestoreMap = Record<string, unknown>;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return fallback;
}

export async function registerV2LegendsMeBootstrapRoutes(app: FastifyInstance): Promise<void> {
  app.get(legendsMeBootstrapContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("achievements", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Legends v2 surface is not enabled for this viewer"));
    }
    setRouteName(legendsMeBootstrapContract.routeName);
    const db = getFirestoreSourceClient();
    if (!db) {
      return success({
        routeName: legendsMeBootstrapContract.routeName,
        activeLegends: [],
        closeToLegends: [],
        recentAwards: [],
        totals: { activeLegendCount: 0, firstFinderCount: 0, topThreeCount: 0 }
      });
    }

    const stateRef = legendRepository.userLegendsStateRef(viewer.viewerId);
    const stateSnap = await stateRef.get();
    incrementDbOps("reads", stateSnap.exists ? 1 : 0);
    const state = (stateSnap.data() as FirestoreMap | undefined) ?? {};
    const activeScopeIds = asArray(state.activeScopeIds).map((v) => String(v ?? "")).filter(Boolean).slice(0, 4);
    const closeScopeIds = asArray(state.closeScopeIds).map((v) => String(v ?? "")).filter(Boolean).slice(0, 4);
    const recentAwardIds = asArray(state.recentAwardIds).map((v) => String(v ?? "")).filter(Boolean).slice(0, 8);
    const defense = (state.defense as FirestoreMap | undefined) ?? {};
    const atRiskScopeIds = asArray(defense.atRiskScopeIds).map((v) => String(v ?? "")).filter(Boolean).slice(0, 6);
    const lostEventIds = asArray(defense.lostEventIds).map((v) => String(v ?? "")).filter(Boolean).slice(0, 6);
    const pendingGlobalModalEventId =
      typeof state.pendingGlobalModalEventId === "string" && state.pendingGlobalModalEventId.trim()
        ? state.pendingGlobalModalEventId.trim()
        : null;

    const scopeIds = [...new Set([...activeScopeIds, ...closeScopeIds])];
    const scopeRefs = scopeIds.map((id) => legendRepository.scopeRef(id));
    const statRefs = scopeIds.map((id) => legendRepository.userStatRef(id, viewer.viewerId));
    const awardRefs = recentAwardIds.map((id) => legendRepository.awardRef(viewer.viewerId, id));
    const atRiskScopeRefs = atRiskScopeIds.map((id) => legendRepository.scopeRef(id));
    const atRiskStatRefs = atRiskScopeIds.map((id) => legendRepository.userStatRef(id, viewer.viewerId));
    const lostEventRefs = lostEventIds.map((id) => legendRepository.legendEventRef(viewer.viewerId, id));
    const pendingEventRef = pendingGlobalModalEventId
      ? [legendRepository.legendEventRef(viewer.viewerId, pendingGlobalModalEventId)]
      : [];

    const snaps = await db.getAll(
      ...scopeRefs,
      ...statRefs,
      ...awardRefs,
      ...atRiskScopeRefs,
      ...atRiskStatRefs,
      ...lostEventRefs,
      ...pendingEventRef
    );
    const scopeSnaps = snaps.slice(0, scopeRefs.length);
    const statSnaps = snaps.slice(scopeRefs.length, scopeRefs.length + statRefs.length);
    const awardSnaps = snaps.slice(scopeRefs.length + statRefs.length, scopeRefs.length + statRefs.length + awardRefs.length);
    const atRiskScopeSnaps = snaps.slice(
      scopeRefs.length + statRefs.length + awardRefs.length,
      scopeRefs.length + statRefs.length + awardRefs.length + atRiskScopeRefs.length
    );
    const atRiskStatSnaps = snaps.slice(
      scopeRefs.length + statRefs.length + awardRefs.length + atRiskScopeRefs.length,
      scopeRefs.length + statRefs.length + awardRefs.length + atRiskScopeRefs.length + atRiskStatRefs.length
    );
    const lostEventSnaps = snaps.slice(
      scopeRefs.length + statRefs.length + awardRefs.length + atRiskScopeRefs.length + atRiskStatRefs.length,
      scopeRefs.length + statRefs.length + awardRefs.length + atRiskScopeRefs.length + atRiskStatRefs.length + lostEventRefs.length
    );
    const pendingEventSnaps = snaps.slice(
      scopeRefs.length + statRefs.length + awardRefs.length + atRiskScopeRefs.length + atRiskStatRefs.length + lostEventRefs.length
    );
    incrementDbOps(
      "reads",
      snaps.reduce((sum, snap) => sum + (snap.exists ? 1 : 0), 0)
    );

    const scopeById = new Map<string, FirestoreMap>();
    scopeSnaps.forEach((snap, idx) => {
      const id = scopeIds[idx]!;
      if (snap.exists) scopeById.set(id, (snap.data() as FirestoreMap | undefined) ?? {});
    });
    const statByScopeId = new Map<string, FirestoreMap>();
    statSnaps.forEach((snap, idx) => {
      const id = scopeIds[idx]!;
      if (snap.exists) statByScopeId.set(id, (snap.data() as FirestoreMap | undefined) ?? {});
    });

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
      .filter((snap) => snap.exists)
      .map((snap) => ((snap.data() as FirestoreMap | undefined) ?? {}) as FirestoreMap)
      .map((row) => ({
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

    const mapEventWire = (row: FirestoreMap, fallbackId: string) => ({
      eventId: String(row.eventId ?? fallbackId),
      eventType: String(row.eventType ?? ""),
      scopeId: String(row.scopeId ?? ""),
      scopeType: String(row.scopeType ?? ""),
      scopeTitle: String(row.scopeTitle ?? ""),
      activityId: row.activityId == null ? null : String(row.activityId),
      placeType: row.placeType == null ? null : String(row.placeType),
      placeId: row.placeId == null ? null : String(row.placeId),
      geohash: row.geohash == null ? null : String(row.geohash),
      previousRank: row.previousRank == null ? null : Math.max(1, finiteInt(row.previousRank, 1)),
      newRank: row.newRank == null ? null : Math.max(1, finiteInt(row.newRank, 1)),
      previousLeaderCount: Math.max(0, finiteInt(row.previousLeaderCount, 0)),
      newLeaderCount: Math.max(0, finiteInt(row.newLeaderCount, 0)),
      viewerCount: Math.max(0, finiteInt(row.viewerCount, 0)),
      deltaToReclaim: Math.max(0, finiteInt(row.deltaToReclaim, 0)),
      overtakenByUserId: row.overtakenByUserId == null ? null : String(row.overtakenByUserId),
      sourcePostId: String(row.sourcePostId ?? ""),
      createdAt: row.createdAt,
      seen: row.seen === true
    });

    const recentEvents = lostEventSnaps
      .filter((snap) => snap.exists)
      .map((snap) => ((snap.data() as FirestoreMap | undefined) ?? {}) as FirestoreMap)
      .map((row) => mapEventWire(row, String(row.eventId ?? "")))
      .filter((e) => Boolean(e.eventId));

    const pendingGlobalModalEvent =
      pendingEventSnaps.length > 0 && pendingEventSnaps[0]!.exists
        ? mapEventWire(((pendingEventSnaps[0]!.data() as FirestoreMap | undefined) ?? {}) as FirestoreMap, pendingGlobalModalEventId ?? "")
        : null;

    // atRisk scopes summary (bounded): compute from atRiskScopeIds and their stat snaps.
    const atRiskScopeById = new Map<string, FirestoreMap>();
    atRiskScopeSnaps.forEach((snap, idx) => {
      const id = atRiskScopeIds[idx]!;
      if (snap.exists) atRiskScopeById.set(id, (snap.data() as FirestoreMap | undefined) ?? {});
    });
    const atRiskStatByScopeId = new Map<string, FirestoreMap>();
    atRiskStatSnaps.forEach((snap, idx) => {
      const id = atRiskScopeIds[idx]!;
      if (snap.exists) atRiskStatByScopeId.set(id, (snap.data() as FirestoreMap | undefined) ?? {});
    });
    const mapAtRiskScopeSummary = (scopeId: string) => {
      const scope = atRiskScopeById.get(scopeId) ?? {};
      const stat = atRiskStatByScopeId.get(scopeId) ?? {};
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

    const firstFinderCount = recentAwards.filter((a) => a.awardType === "first_finder" || a.awardType === "first_activity_finder").length;
    const topThreeCount = recentAwards.filter((a) => (a.newRank ?? 99) <= 3).length;
    const reclaimable = activeScopeIds
      .map(mapScopeSummary)
      .filter((row) => (row.viewerRank ?? 99) > 1)
      .slice(0, 0); // active scopes are leader; reclaimable comes from closeToLegends below.
    const reclaimableFromClose = closeScopeIds
      .map(mapScopeSummary)
      .filter((row) => (row.viewerRank ?? 99) <= 3 && (row.deltaToLeader ?? 99) <= 3)
      .slice(0, 6);

    return success({
      routeName: legendsMeBootstrapContract.routeName,
      activeLegends: activeScopeIds.map(mapScopeSummary),
      closeToLegends: closeScopeIds.map(mapScopeSummary),
      recentAwards,
      recentEvents,
      defense: {
        atRisk: atRiskScopeIds.map(mapAtRiskScopeSummary),
        lost: recentEvents.slice(0, 6),
        reclaimable: reclaimableFromClose
      },
      pendingGlobalModalEvent,
      totals: {
        activeLegendCount: activeScopeIds.length,
        firstFinderCount,
        topThreeCount
      }
    });
  });
}

