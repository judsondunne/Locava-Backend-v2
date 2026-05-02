import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { incrementDbOps, recordSurfaceTimings } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { LegendAwardService, capTopUsers, findRank } from "./legend-award.service.js";
import { LegendScopeDeriver } from "./legend-scope-deriver.js";
import { LegendRepository, legendRepository } from "./legend.repository.js";
import {
  type CanonicalLegendKind,
  type CanonicalRankAggregateDoc,
  normalizeLegendActivityId,
  type LegendAwardDoc,
  type LegendEventDoc,
  type LegendPostCreatedInput,
  type LegendPreviewCard,
  type LegendScopeDoc,
  type LegendScopeId,
  type LegendScopeType,
  type LegendStagePostInput,
  type LegendTopUserRow
} from "./legends.types.js";

type FirestoreMap = Record<string, unknown>;

export function canonicalFromAwardType(
  awardType: string,
  scopeType: LegendScopeType
): { kind: CanonicalLegendKind; family: "first" | "rank"; dimension: "location" | "activity" | "combo"; priority: number } {
  if (awardType === "first_finder") {
    if (scopeType === "place") return { kind: "location_first", family: "first", dimension: "location", priority: 20 };
    return { kind: "location_first", family: "first", dimension: "location", priority: 30 };
  }
  if (awardType === "first_activity_finder") {
    if (scopeType === "activity") return { kind: "activity_first", family: "first", dimension: "activity", priority: 40 };
    return { kind: "combo_first", family: "first", dimension: "combo", priority: 10 };
  }
  if (scopeType === "place") return { kind: "location_rank", family: "rank", dimension: "location", priority: 50 };
  if (scopeType === "activity") return { kind: "activity_rank", family: "rank", dimension: "activity", priority: 60 };
  if (scopeType === "placeActivity") return { kind: "combo_rank", family: "rank", dimension: "combo", priority: 45 };
  return { kind: "location_rank", family: "rank", dimension: "location", priority: 90 };
}

function parseLocationFromScopeId(scopeId: string): { locationScope: "state" | "city" | "country" | null; locationKey: string | null } {
  const parts = scopeId.split(":").map((p) => p.trim());
  if (parts[0] !== "place" && parts[0] !== "placeActivity") return { locationScope: null, locationKey: null };
  const locationScope = parts[1] === "state" || parts[1] === "city" || parts[1] === "country" ? parts[1] : null;
  const locationKey = parts[2] || null;
  return { locationScope, locationKey };
}

export function buildFirstClaimKey(params: {
  kind: "location_first" | "activity_first" | "combo_first";
  locationScope?: "state" | "city" | "country" | null;
  locationKey?: string | null;
  activityKey?: string | null;
}): string | null {
  if (params.kind === "location_first") {
    if (!params.locationScope || !params.locationKey) return null;
    return `location_first:${params.locationScope}:${params.locationKey}`.slice(0, 240);
  }
  if (params.kind === "activity_first") {
    if (!params.activityKey) return null;
    return `activity_first:${params.activityKey}`.slice(0, 240);
  }
  if (!params.locationScope || !params.locationKey || !params.activityKey) return null;
  return `combo_first:${params.locationScope}:${params.locationKey}:activity:${params.activityKey}`.slice(0, 240);
}

export function sortLegendDisplayCards<T extends { displayPriority?: number }>(cards: T[]): T[] {
  return [...cards].sort((a, b) => Number(a.displayPriority ?? 0) - Number(b.displayPriority ?? 0));
}

function asObject(value: unknown): FirestoreMap {
  if (value && typeof value === "object") return value as FirestoreMap;
  return {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseScopeId(scopeId: LegendScopeId): {
  scopeType: LegendScopeType;
  geohash6?: string | null;
  activityId?: string | null;
  placeType?: string | null;
  placeId?: string | null;
} {
  const parts = scopeId.split(":").map((p) => p.trim());
  const head = parts[0] ?? "";
  if (head === "cell") {
    return { scopeType: "cell", geohash6: parts[2] ?? null };
  }
  if (head === "activity") {
    return { scopeType: "activity", activityId: parts[1] ?? null };
  }
  if (head === "cellActivity") {
    return { scopeType: "cellActivity", geohash6: parts[2] ?? null, activityId: parts[3] ?? null };
  }
  if (head === "place") {
    return { scopeType: "place", placeType: parts[1] ?? null, placeId: parts[2] ?? null };
  }
  if (head === "placeActivity") {
    return { scopeType: "placeActivity", placeType: parts[1] ?? null, placeId: parts[2] ?? null, activityId: parts[3] ?? null };
  }
  return { scopeType: "cell" };
}

function titleCaseActivity(activityId: string): string {
  const parts = activityId.split("_").filter(Boolean);
  if (parts.length === 0) return activityId;
  return parts.map((p) => `${p.slice(0, 1).toUpperCase()}${p.slice(1)}`).join(" ");
}

function buildScopeTitles(scopeId: LegendScopeId): { title: string; subtitle: string } {
  const parsed = parseScopeId(scopeId);
  if (parsed.scopeType === "cell") {
    return { title: "Local Legend", subtitle: parsed.geohash6 ? `Cell ${parsed.geohash6}` : "Local area" };
  }
  if (parsed.scopeType === "activity") {
    const act = parsed.activityId ? titleCaseActivity(parsed.activityId) : "Activity";
    return { title: `${act} Legend`, subtitle: "Across Locava" };
  }
  if (parsed.scopeType === "cellActivity") {
    const act = parsed.activityId ? titleCaseActivity(parsed.activityId) : "Activity";
    return { title: `${act} Local Legend`, subtitle: parsed.geohash6 ? `Cell ${parsed.geohash6}` : "Local area" };
  }
  if (parsed.scopeType === "place") {
    const placeType = parsed.placeType ?? "place";
    const placeId = parsed.placeId ?? "";
    return { title: "Local Legend", subtitle: placeId ? `${placeType.toUpperCase()} ${placeId}` : placeType };
  }
  if (parsed.scopeType === "placeActivity") {
    const act = parsed.activityId ? titleCaseActivity(parsed.activityId) : "Activity";
    const placeType = parsed.placeType ?? "place";
    const placeId = parsed.placeId ?? "";
    return { title: `${act} Legend`, subtitle: placeId ? `${placeType.toUpperCase()} ${placeId}` : placeType };
  }
  return { title: "Local Legend", subtitle: scopeId };
}

function mergeTopUsers(params: {
  existing: LegendTopUserRow[];
  updated: LegendTopUserRow;
  knownLeader?: { userId: string; count: number } | null;
  cap: number;
}): LegendTopUserRow[] {
  const map = new Map<string, number>();
  for (const row of params.existing ?? []) {
    if (!row?.userId) continue;
    map.set(row.userId, Math.max(0, row.count ?? 0));
  }
  map.set(params.updated.userId, Math.max(0, params.updated.count));
  if (params.knownLeader?.userId) {
    const prev = map.get(params.knownLeader.userId);
    const next = Math.max(prev ?? 0, Math.max(0, params.knownLeader.count));
    map.set(params.knownLeader.userId, next);
  }
  return capTopUsers(
    [...map.entries()].map(([userId, count]) => ({ userId, count })),
    params.cap
  );
}

export class LegendService {
  private readonly deriver: LegendScopeDeriver;
  private readonly awards: LegendAwardService;

  constructor(
    private readonly repo: LegendRepository = legendRepository,
    config: {
      maxScopesPerPost?: number;
      maxActivitiesPerPost?: number;
      topUsersCap?: number;
      stageTtlMs?: number;
      closeToLeaderThreshold?: number;
      enablePlaceScopes?: boolean;
    } = {}
  ) {
    this.deriver = new LegendScopeDeriver({
      maxScopesPerPost: config.maxScopesPerPost ?? 8,
      maxActivitiesPerPost: config.maxActivitiesPerPost ?? 3,
      enablePlaceScopes: config.enablePlaceScopes ?? true
    });
    this.awards = new LegendAwardService({ closeToLeaderThreshold: config.closeToLeaderThreshold ?? 2 });
    this.config = {
      topUsersCap: Math.max(3, Math.min(config.topUsersCap ?? 5, 5)),
      stageTtlMs: Math.max(30_000, Math.min(config.stageTtlMs ?? 10 * 60_000, 60 * 60_000))
    };
  }

  private readonly config: { topUsersCap: number; stageTtlMs: number };

  async stagePost(input: LegendStagePostInput): Promise<{ stageId: string; derivedScopes: LegendScopeId[]; previewCards: LegendPreviewCard[] }> {
    const startedAt = Date.now();
    const derived = this.deriver.deriveFromPost({
      geohash: input.geohash ?? null,
      activities: input.activityIds ?? [],
      city: input.city ?? null,
      state: input.state ?? null,
      country: input.country ?? null,
      region: input.region ?? null
    });

    const db = getFirestoreSourceClient();
    if (!db) {
      throw new Error("firestore_unavailable_for_legends");
    }

    const stageId = `legstage_${randomUUID()}`;
    const scopeRefs = derived.scopes.map((scopeId) => this.repo.scopeRef(scopeId));
    const statRefs = derived.scopes.map((scopeId) => this.repo.userStatRef(scopeId, input.userId));

    // Batch reads (bounded): scope + viewer stat per scope.
    const snaps = await db.getAll(...scopeRefs, ...statRefs);
    const scopeSnaps = snaps.slice(0, scopeRefs.length);
    const statSnaps = snaps.slice(scopeRefs.length);
    incrementDbOps(
      "reads",
      [...scopeSnaps, ...statSnaps].reduce((sum, snap) => sum + (snap.exists ? 1 : 0), 0)
    );

    const previewCards: LegendPreviewCard[] = [];
    for (let i = 0; i < derived.scopes.length; i += 1) {
      const scopeId = derived.scopes[i]!;
      const parsed = parseScopeId(scopeId);
      const scopeSnap = scopeSnaps[i]!;
      const statSnap = statSnaps[i]!;
      const scopeExists = scopeSnap.exists;
      const scopeData = scopeExists ? ((scopeSnap.data() as FirestoreMap | undefined) ?? {}) : {};
      const leaderCount = Math.max(0, Number(asObject(scopeData).leaderCount ?? 0) || 0);
      const leaderUserId = asString(asObject(scopeData).leaderUserId);
      const statData = statSnap.exists ? ((statSnap.data() as FirestoreMap | undefined) ?? {}) : {};
      const userCount = Math.max(0, Number(asObject(statData).count ?? 0) || 0);
      const nextUserCount = userCount + 1;

      const titles = buildScopeTitles(scopeId);
      if (!scopeExists) {
        if (parsed.scopeType === "cell") {
          previewCards.push({
            type: "possible_first_finder",
            scopeId,
            title: "Possible First Finder",
            subtitle: `You may be the first to post here. (${titles.subtitle})`
          });
        } else if (parsed.scopeType === "cellActivity") {
          previewCards.push({
            type: "possible_first_activity_finder",
            scopeId,
            title: "Possible First Activity Finder",
            subtitle: `You may be the first to post this activity here. (${titles.subtitle})`
          });
        }
        continue;
      }

      const wouldBecomeLeader = (leaderUserId && leaderUserId === input.userId) ? false : nextUserCount > leaderCount;
      if (wouldBecomeLeader) {
        previewCards.push({
          type: "possible_new_leader",
          scopeId,
          title: "Potential New Legend",
          subtitle: `This post could make you #1. (${titles.title})`
        });
        continue;
      }

      const deltaToLeader = Math.max(0, leaderCount - nextUserCount);
      if (deltaToLeader > 0 && deltaToLeader <= 2) {
        previewCards.push({
          type: "close_to_legend",
          scopeId,
          title: `Almost ${titles.title}`,
          subtitle: `You are ${deltaToLeader} post${deltaToLeader === 1 ? "" : "s"} away from #1.`
        });
      }
    }

    const now = Date.now();
    await this.repo.createStage({
      stageId,
      userId: input.userId,
      derivedScopes: derived.scopes,
      previewCards: previewCards.slice(0, 8),
      expiresAtMs: now + this.config.stageTtlMs
    });

    recordSurfaceTimings({ legendStageMs: Date.now() - startedAt });
    return { stageId, derivedScopes: derived.scopes, previewCards: previewCards.slice(0, 8) };
  }

  async commitStagedPostLegend(params: {
    stageId: string;
    post: LegendPostCreatedInput;
  }): Promise<{
    committed: boolean;
    alreadyProcessed: boolean;
    awardsCreated: number;
    derivedScopes: LegendScopeId[];
  }> {
    const startedAt = Date.now();
    console.info("[legend.commit] start", {
      stageId: params.stageId,
      postId: params.post.postId,
      userId: params.post.userId
    });
    const db = this.repo.scopeRef("__probe__").firestore;
    const stageRef = this.repo.stageRef(params.stageId);
    const processedRef = this.repo.processedPostRef(params.post.postId);
    const postResultRef = this.repo.postResultRef(params.post.postId);
    const userStateRef = this.repo.userLegendsStateRef(params.post.userId);

    // Best-effort: mark processing early for post-success polling.
    try {
      await postResultRef.set(
        {
          postId: params.post.postId,
          userId: params.post.userId,
          status: "processing",
          awards: [],
          awardIds: [],
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    } catch {
      // ignore
    }

    const result = await db.runTransaction(async (tx) => {
      const [stageSnap, processedSnap, userStateSnap] = await Promise.all([
        tx.get(stageRef),
        tx.get(processedRef),
        tx.get(userStateRef)
      ]);
      if (processedSnap.exists) {
        console.info("[legend.commit] already_processed", {
          stageId: params.stageId,
          postId: params.post.postId
        });
        return { committed: false, alreadyProcessed: true, awardsCreated: 0, derivedScopes: [] as LegendScopeId[] };
      }
      if (!stageSnap.exists) {
        console.warn("[legend.commit] stage_missing", {
          stageId: params.stageId,
          postId: params.post.postId
        });
        throw new Error("legend_stage_not_found");
      }
      const stage = this.repo.readStageDoc(stageSnap.data(), params.stageId);
      if (stage.userId !== params.post.userId) throw new Error("legend_stage_user_mismatch");
      if (stage.status !== "staged") throw new Error(`legend_stage_invalid_status:${stage.status}`);
      const expiresAt = stageSnap.get("expiresAt") as Timestamp | null;
      if (expiresAt && expiresAt.toMillis() <= Date.now()) {
        tx.set(stageRef, { status: "expired", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        throw new Error("legend_stage_expired");
      }
      const derivedScopes = (stage.derivedScopes ?? []).filter(Boolean).slice(0, 8);
      console.info("[legend.commit] derived_scopes_loaded", {
        stageId: params.stageId,
        postId: params.post.postId,
        derivedScopeCount: derivedScopes.length,
        derivedScopes
      });

      const scopeRefs = derivedScopes.map((scopeId) => this.repo.scopeRef(scopeId));
      const statRefs = derivedScopes.map((scopeId) => this.repo.userStatRef(scopeId, params.post.userId));
      const snaps = await Promise.all([
        ...scopeRefs.map((ref) => tx.get(ref)),
        ...statRefs.map((ref) => tx.get(ref))
      ]);
      const scopeSnaps = snaps.slice(0, scopeRefs.length);
      const statSnaps = snaps.slice(scopeRefs.length);

      let awardsCreated = 0;
      const activeScopeIdsThisCommit: string[] = [];
      const closeScopeIdsThisCommit: string[] = [];
      const awardIdsThisCommit: string[] = [];
      const defenseAtRiskScopeIdsThisCommit: string[] = [];
      const pendingWrites: Array<() => void> = [];
      const pendingFirstClaims: Array<{
        claimKey: string;
        claimRef: ReturnType<LegendRepository["firstClaimRef"]>;
        payload: ReturnType<LegendRepository["buildFirstClaimDoc"]>;
      }> = [];
      const earnedFirstLegends: Array<Record<string, unknown>> = [];
      const earnedRankLegends: Array<Record<string, unknown>> = [];
      const rankChanges: Array<Record<string, unknown>> = [];
      const displayCards: Array<Record<string, unknown>> = [];
      const awardSummaries: Array<{
        awardId: string;
        awardType: string;
        kind?: CanonicalLegendKind;
        family?: "first" | "rank";
        dimension?: "location" | "activity" | "combo";
        iconContext?: string;
        activityKey?: string | null;
        activityLabel?: string | null;
        locationKey?: string | null;
        locationLabel?: string | null;
        comboKey?: string | null;
        rank?: number | null;
        isPermanent?: boolean;
        viewerStatus?: string;
        displayPriority?: number;
        scopeId: string;
        scopeType: string;
        title: string;
        subtitle: string;
        postId: string;
        previousRank: number | null;
        newRank: number | null;
        userCount: number;
        leaderCount: number;
        deltaToLeader: number;
        createdAt: unknown;
        seen: boolean;
      }> = [];
      for (let i = 0; i < derivedScopes.length; i += 1) {
        const scopeId = derivedScopes[i]!;
        const parsed = parseScopeId(scopeId);
        const { title, subtitle } = buildScopeTitles(scopeId);

        const scopeSnap = scopeSnaps[i]!;
        const statSnap = statSnaps[i]!;
        const scopeWasCreated = !scopeSnap.exists;
        const prevScope = scopeSnap.exists
          ? this.repo.readScopeDoc(scopeSnap.data(), scopeId)
          : ({
              ...this.repo.buildDefaultScopeDoc({
                scopeId,
                scopeType: parsed.scopeType,
                title,
                subtitle,
                placeType: (parsed.placeType as any) ?? null,
                placeId: parsed.placeId ?? null,
                activityId: parsed.activityId ?? null,
                geohashPrecision: parsed.geohash6 ? 6 : null,
                geohash: parsed.geohash6 ?? null
              }),
              createdAt: null,
              updatedAt: null
            } satisfies LegendScopeDoc);

        const prevUser = statSnap.exists
          ? this.repo.readUserStatDoc(statSnap.data(), { scopeId, userId: params.post.userId })
          : ({
              ...this.repo.buildDefaultUserStatDoc({ scopeId, userId: params.post.userId }),
              createdAt: null,
              updatedAt: null
            } as any);

        const nextUserCount = Math.max(0, prevUser.count) + 1;

        // Decide leader without scanning: compare to recorded leaderCount.
        const prevLeaderUserId = prevScope.leaderUserId;
        const prevLeaderCount = Math.max(0, prevScope.leaderCount);
        let nextLeaderUserId = prevLeaderUserId;
        let nextLeaderCount = prevLeaderCount;
        if (!prevLeaderUserId) {
          nextLeaderUserId = params.post.userId;
          nextLeaderCount = nextUserCount;
        } else if (prevLeaderUserId === params.post.userId) {
          nextLeaderUserId = params.post.userId;
          nextLeaderCount = nextUserCount;
        } else if (nextUserCount > prevLeaderCount) {
          nextLeaderUserId = params.post.userId;
          nextLeaderCount = nextUserCount;
        } else if (nextUserCount === prevLeaderCount) {
          // Stable tie-breaker: keep existing leader.
          nextLeaderUserId = prevLeaderUserId;
          nextLeaderCount = prevLeaderCount;
        }

        const nextTopUsers = mergeTopUsers({
          existing: prevScope.topUsers ?? [],
          updated: { userId: params.post.userId, count: nextUserCount },
          knownLeader: nextLeaderUserId ? { userId: nextLeaderUserId, count: nextLeaderCount } : null,
          cap: this.config.topUsersCap
        });

        // Overtake detection (bounded): if leader flips, emit event for displaced leader.
        const oldLeaderUserId = prevLeaderUserId;
        const oldLeaderCount = prevLeaderCount;
        const leaderChanged =
          Boolean(oldLeaderUserId) &&
          Boolean(nextLeaderUserId) &&
          oldLeaderUserId !== nextLeaderUserId;
        if (leaderChanged && oldLeaderUserId && nextLeaderUserId && oldLeaderUserId !== params.post.userId) {
          const oldLeaderNewRank = findRank(nextTopUsers, oldLeaderUserId) ?? 2;
          const eventId = `overtaken:${scopeId}:${params.post.postId}`.slice(0, 240);
          const eventRef = this.repo.legendEventRef(oldLeaderUserId, eventId);
          const oldLeaderStateRef = this.repo.userLegendsStateRef(oldLeaderUserId);
          const eventPayload: LegendEventDoc = this.repo.buildEventDoc({
            eventId,
            eventType: "overtaken",
            scopeId,
            scopeType: parsed.scopeType,
            scopeTitle: title,
            activityId: parsed.activityId ?? null,
            placeType: (parsed.placeType as any) ?? null,
            placeId: parsed.placeId ?? null,
            geohash: parsed.geohash6 ?? null,
            previousRank: 1,
            newRank: Math.max(2, oldLeaderNewRank),
            previousLeaderCount: Math.max(0, oldLeaderCount),
            newLeaderCount: Math.max(0, nextLeaderCount),
            viewerCount: Math.max(0, oldLeaderCount),
            deltaToReclaim: Math.max(1, Math.max(0, nextLeaderCount) - Math.max(0, oldLeaderCount) + 1),
            overtakenByUserId: nextLeaderUserId,
            overtakenByUserSummary: { userId: nextLeaderUserId },
            sourcePostId: params.post.postId
          });
          pendingWrites.push(() => {
            tx.set(eventRef, eventPayload, { merge: true });
          });
          // Best-effort projection for old leader: mark pending global modal + lost lists (bounded via arrayUnion).
          pendingWrites.push(() => {
            tx.set(
              oldLeaderStateRef,
              {
                pendingGlobalModalEventId: eventId,
                defense: {
                  lostEventIds: FieldValue.arrayUnion(eventId),
                  lostScopeIds: FieldValue.arrayUnion(scopeId)
                },
                updatedAt: FieldValue.serverTimestamp()
              } as any,
              { merge: true }
            );
          });
        }

        const nextScope: LegendScopeDoc = {
          ...prevScope,
          scopeId,
          scopeType: parsed.scopeType,
          title,
          subtitle,
          placeType: (parsed.placeType as any) ?? prevScope.placeType ?? null,
          placeId: parsed.placeId ?? prevScope.placeId ?? null,
          activityId: parsed.activityId ?? prevScope.activityId ?? null,
          geohashPrecision: parsed.geohash6 ? 6 : prevScope.geohashPrecision ?? null,
          geohash: parsed.geohash6 ?? prevScope.geohash ?? null,
          totalPosts: Math.max(0, prevScope.totalPosts) + 1,
          leaderUserId: nextLeaderUserId ?? null,
          leaderCount: Math.max(0, nextLeaderCount),
          topUsers: nextTopUsers,
          lastPostId: params.post.postId,
          createdAt: prevScope.createdAt ?? null,
          updatedAt: FieldValue.serverTimestamp()
        };

        const { award, kind, previousRank, newRank } = this.awards.decideAward({
          postId: params.post.postId,
          scopeId,
          scopeType: parsed.scopeType,
          scopeWasCreated,
          prevScope: {
            leaderUserId: prevScope.leaderUserId,
            leaderCount: prevScope.leaderCount,
            topUsers: prevScope.topUsers,
            totalPosts: prevScope.totalPosts
          },
          nextScope: {
            leaderUserId: nextScope.leaderUserId,
            leaderCount: nextScope.leaderCount,
            topUsers: nextScope.topUsers,
            totalPosts: nextScope.totalPosts,
            title: nextScope.title,
            subtitle: nextScope.subtitle
          },
          userId: params.post.userId,
          prevUserCount: prevUser.count,
          nextUserCount
        });

        const scopeRef = scopeRefs[i]!;
        const statRef = statRefs[i]!;

        pendingWrites.push(() => {
          tx.set(
            scopeRef,
            {
              ...nextScope,
              createdAt: scopeWasCreated ? FieldValue.serverTimestamp() : prevScope.createdAt ?? FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        });

        const nextUserRank = findRank(nextTopUsers, params.post.userId);
        pendingWrites.push(() => {
          tx.set(
            statRef,
            {
              scopeId,
              userId: params.post.userId,
              count: nextUserCount,
              rankSnapshot: nextUserRank,
              isLeader: nextLeaderUserId === params.post.userId,
              lastPostId: params.post.postId,
              createdAt: statSnap.exists ? (prevUser.createdAt ?? FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        });

        if (award && kind) {
          const awardId = `${params.post.postId}_${scopeId}_${kind}`.slice(0, 240);
          const awardRef = this.repo.awardRef(params.post.userId, awardId);
          const canonical = canonicalFromAwardType(kind, parsed.scopeType);
          const locationParsed = parseLocationFromScopeId(scopeId);
          const activityKey = parsed.activityId ?? null;
          const comboKey =
            locationParsed.locationScope && locationParsed.locationKey && activityKey
              ? `${locationParsed.locationScope}:${locationParsed.locationKey}:activity:${activityKey}`
              : null;
          const awardPayload: LegendAwardDoc = this.repo.buildAwardDoc({
            awardId,
            awardType: kind,
            kind: canonical.kind,
            family: canonical.family,
            dimension: canonical.dimension,
            iconContext: canonical.dimension,
            activityKey,
            activityLabel: activityKey ? titleCaseActivity(activityKey) : null,
            locationKey: locationParsed.locationKey,
            locationLabel: locationParsed.locationKey,
            comboKey,
            rank: newRank ?? null,
            isPermanent: canonical.family === "first",
            viewerStatus: canonical.family === "first" ? "claimed" : "active",
            displayPriority: canonical.priority,
            scopeId,
            scopeType: parsed.scopeType,
            title: award.title,
            subtitle: award.subtitle,
            postId: params.post.postId,
            previousRank,
            newRank,
            userCount: nextUserCount,
            leaderCount: nextScope.leaderCount,
            deltaToLeader: Math.max(0, nextScope.leaderCount - nextUserCount)
          });
          pendingWrites.push(() => {
            tx.set(awardRef, awardPayload, { merge: true });
          });
          awardsCreated += 1;
          awardIdsThisCommit.push(awardId);

          const canonicalCard = {
            id: awardId,
            kind: canonical.kind,
            family: canonical.family,
            dimension: canonical.dimension,
            title: award.title,
            subtitle: award.subtitle,
            description:
              canonical.family === "first"
                ? "Original legend claim. This badge is permanent."
                : "Current competitive legend status.",
            iconContext: canonical.dimension,
            activityKey,
            activityLabel: activityKey ? titleCaseActivity(activityKey) : null,
            locationKey: locationParsed.locationKey,
            locationLabel: locationParsed.locationKey,
            comboKey,
            rank: newRank ?? null,
            isPermanent: canonical.family === "first",
            claimedAt: Timestamp.fromMillis(Date.now()),
            updatedAt: Timestamp.fromMillis(Date.now()),
            sourcePostId: params.post.postId,
            viewerStatus: canonical.family === "first" ? "claimed" : "active",
            displayPriority: canonical.priority
          };

          if (canonical.family === "first") {
            earnedFirstLegends.push(canonicalCard);
          } else {
            earnedRankLegends.push(canonicalCard);
            rankChanges.push({
              id: `rankchange:${awardId}`,
              kind: canonical.kind,
              scopeId,
              previousRank,
              newRank,
              passedUserId: previousRank != null && newRank != null && newRank < previousRank ? "unknown" : null,
              postsNeededToPass: Math.max(0, nextScope.leaderCount - nextUserCount + 1),
              viewerCount: nextUserCount,
              targetCount: nextScope.leaderCount,
              becameNumberOne: newRank === 1
            });
          }
          displayCards.push(canonicalCard);

          if (canonical.family === "rank") {
            const rankAggregateKey = `${canonical.kind}:${scopeId}`.slice(0, 240);
            const rankAggregateRef = this.repo.rankAggregateRef(rankAggregateKey);
            pendingWrites.push(() => {
              tx.set(
                rankAggregateRef,
                {
                  aggregateKey: rankAggregateKey,
                  kind: canonical.kind as CanonicalRankAggregateDoc["kind"],
                  family: "rank",
                  dimension: canonical.dimension,
                  locationScope: locationParsed.locationScope,
                  locationKey: locationParsed.locationKey,
                  locationLabel: locationParsed.locationKey,
                  activityKey,
                  activityLabel: activityKey ? titleCaseActivity(activityKey) : null,
                  comboKey,
                  [`countsByUser.${params.post.userId}`]: nextUserCount,
                  topUsers: nextTopUsers,
                  totalPosts: nextScope.totalPosts,
                  updatedAt: FieldValue.serverTimestamp()
                } satisfies Partial<CanonicalRankAggregateDoc>,
                { merge: true }
              );
            });
          }

          if (canonical.kind === "location_first" || canonical.kind === "activity_first" || canonical.kind === "combo_first") {
            const claimKey = buildFirstClaimKey({
              kind: canonical.kind,
              locationScope: locationParsed.locationScope,
              locationKey: locationParsed.locationKey,
              activityKey
            });
            if (claimKey) {
              const claimRef = this.repo.firstClaimRef(claimKey);
              pendingFirstClaims.push({
                claimKey,
                claimRef,
                payload: this.repo.buildFirstClaimDoc({
                  claimKey,
                  kind: canonical.kind,
                  family: "first",
                  dimension: canonical.dimension,
                  userId: params.post.userId,
                  postId: params.post.postId,
                  locationScope: locationParsed.locationScope,
                  locationKey: locationParsed.locationKey,
                  locationLabel: locationParsed.locationKey,
                  activityKey,
                  activityLabel: activityKey ? titleCaseActivity(activityKey) : null,
                  comboKey,
                  title: award.title,
                  subtitle: award.subtitle,
                  description: "Original legend claim. First to discover.",
                  iconContext: canonical.dimension
                })
              });
            }
          }
          awardSummaries.push({
            awardId,
            awardType: kind,
            scopeId,
            scopeType: parsed.scopeType,
            title: award.title,
            subtitle: award.subtitle,
            kind: canonical.kind as any,
            family: canonical.family as any,
            dimension: canonical.dimension as any,
            iconContext: canonical.dimension,
            activityKey,
            activityLabel: activityKey ? titleCaseActivity(activityKey) : null,
            locationKey: locationParsed.locationKey,
            locationLabel: locationParsed.locationKey,
            comboKey,
            rank: newRank ?? null,
            isPermanent: canonical.family === "first",
            viewerStatus: canonical.family === "first" ? "claimed" : "active",
            displayPriority: canonical.priority,
            postId: params.post.postId,
            previousRank,
            newRank,
            userCount: nextUserCount,
            leaderCount: nextScope.leaderCount,
            deltaToLeader: Math.max(0, nextScope.leaderCount - nextUserCount),
            createdAt: Timestamp.fromMillis(Date.now()),
            seen: false
          });
        }

        const deltaToLeader = Math.max(0, nextScope.leaderCount - nextUserCount);
        if (nextScope.leaderUserId === params.post.userId) {
          activeScopeIdsThisCommit.push(scopeId);
          // Defense: if #2 is within 2 posts, mark at-risk.
          const challenger = nextTopUsers.find((row) => row.userId !== params.post.userId) ?? null;
          const deltaBehind = challenger ? Math.max(0, nextUserCount - Math.max(0, challenger.count)) : 999;
          if (deltaBehind <= 2) defenseAtRiskScopeIdsThisCommit.push(scopeId);
        } else if (deltaToLeader > 0 && deltaToLeader <= 2) {
          closeScopeIdsThisCommit.push(scopeId);
        }
      }

      const claimReadsByPath = new Map<string, { exists: boolean; claim: (typeof pendingFirstClaims)[number] }>();
      if (pendingFirstClaims.length > 0) {
        const uniqueClaims = [...new Map(pendingFirstClaims.map((claim) => [claim.claimRef.path, claim])).values()];
        const claimSnaps = await Promise.all(uniqueClaims.map((claim) => tx.get(claim.claimRef)));
        for (let i = 0; i < uniqueClaims.length; i += 1) {
          claimReadsByPath.set(uniqueClaims[i]!.claimRef.path, {
            exists: claimSnaps[i]!.exists,
            claim: uniqueClaims[i]!
          });
        }
      }

      for (const applyWrite of pendingWrites) {
        applyWrite();
      }
      for (const read of claimReadsByPath.values()) {
        if (!read.exists) {
          tx.create(read.claim.claimRef, read.claim.payload);
        }
      }

      const existingState = userStateSnap.exists ? (userStateSnap.data() as FirestoreMap | undefined) ?? {} : {};
      const existingActive = Array.isArray(existingState.activeScopeIds)
        ? existingState.activeScopeIds.map((v) => String(v ?? "")).filter(Boolean)
        : [];
      const existingClose = Array.isArray(existingState.closeScopeIds)
        ? existingState.closeScopeIds.map((v) => String(v ?? "")).filter(Boolean)
        : [];
      const existingRecent = Array.isArray(existingState.recentAwardIds)
        ? existingState.recentAwardIds.map((v) => String(v ?? "")).filter(Boolean)
        : [];
      const existingDefense = (existingState.defense as FirestoreMap | undefined) ?? {};
      const existingAtRisk = Array.isArray(existingDefense.atRiskScopeIds)
        ? existingDefense.atRiskScopeIds.map((v) => String(v ?? "")).filter(Boolean)
        : [];

      const dedupe = (list: string[]) => [...new Set(list.map((v) => v.trim()).filter(Boolean))];
      const nextActive = dedupe([...activeScopeIdsThisCommit, ...existingActive]).slice(0, 20);
      const nextClose = dedupe([...closeScopeIdsThisCommit, ...existingClose]).slice(0, 20);
      const nextRecent = dedupe([...awardIdsThisCommit, ...existingRecent]).slice(0, 30);
      const nextAtRisk = dedupe([...defenseAtRiskScopeIdsThisCommit, ...existingAtRisk]).slice(0, 20);

      tx.set(
        userStateRef,
        {
          activeScopeIds: nextActive,
          closeScopeIds: nextClose,
          recentAwardIds: nextRecent,
          defense: {
            ...(existingDefense as any),
            atRiskScopeIds: nextAtRisk
          },
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      tx.set(
        postResultRef,
        {
          postId: params.post.postId,
          userId: params.post.userId,
          status: "complete",
          awards: awardSummaries,
          awardIds: awardIdsThisCommit,
          rewards: {
            postId: params.post.postId,
            viewerId: params.post.userId,
            hasRewards: displayCards.length > 0,
            earnedFirstLegends: sortLegendDisplayCards(earnedFirstLegends),
            earnedRankLegends: sortLegendDisplayCards(earnedRankLegends),
            rankChanges,
            closeTargets: rankChanges.filter((c) => Number(c.postsNeededToPass ?? 0) > 0 && Number(c.postsNeededToPass ?? 0) <= 3),
            overtakenUsers: rankChanges.filter((c) => c.passedUserId != null),
            displayCards: sortLegendDisplayCards(displayCards)
          },
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      tx.create(processedRef, {
        postId: params.post.postId,
        stageId: params.stageId,
        userId: params.post.userId,
        scopeCount: derivedScopes.length,
        processedAt: FieldValue.serverTimestamp()
      });
      tx.set(stageRef, { status: "committed", committedPostId: params.post.postId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

      return { committed: true, alreadyProcessed: false, awardsCreated, derivedScopes };
    });

    recordSurfaceTimings({ legendCommitMs: Date.now() - startedAt });
    // Conservative dbOps accounting (missing docs don't count as reads in Firestore).
    incrementDbOps("reads", 3 + 2 * (result.derivedScopes?.length ?? 0));
    incrementDbOps("writes", 3 + 2 * (result.derivedScopes?.length ?? 0) + (result.awardsCreated ?? 0));
    console.info("[legend.commit] done", {
      stageId: params.stageId,
      postId: params.post.postId,
      userId: params.post.userId,
      committed: result.committed,
      alreadyProcessed: result.alreadyProcessed,
      awardsCreated: result.awardsCreated,
      derivedScopeCount: result.derivedScopes.length,
      elapsedMs: Date.now() - startedAt
    });
    return result;
  }

  async processPostCreated(post: LegendPostCreatedInput): Promise<{ committed: boolean; alreadyProcessed: boolean; awardsCreated: number; derivedScopes: LegendScopeId[] }> {
    const startedAt = Date.now();
    console.info("[legend.process_post_created] start", {
      postId: post.postId,
      userId: post.userId,
      geohash: post.geohash ?? null,
      activityCount: (post.activities ?? []).length,
      city: post.city ?? null,
      state: post.state ?? null,
      country: post.country ?? null,
      region: post.region ?? null
    });
    const derived = this.deriver.deriveFromPost({
      geohash: post.geohash ?? null,
      activities: post.activities ?? [],
      city: post.city ?? null,
      state: post.state ?? null,
      country: post.country ?? null,
      region: post.region ?? null
    });
    const stageId = `legdirect_${post.postId}`;
    // Create a lightweight stage doc so we have a consistent audit trail; commit uses derived scopes directly.
    await this.repo.createStage({
      stageId,
      userId: post.userId,
      derivedScopes: derived.scopes,
      previewCards: [],
      expiresAtMs: Date.now() + 5 * 60_000
    });
    const committed = await this.commitStagedPostLegend({ stageId, post });
    recordSurfaceTimings({ legendProcessMs: Date.now() - startedAt });
    console.info("[legend.process_post_created] done", {
      postId: post.postId,
      userId: post.userId,
      stageId,
      derivedScopeCount: derived.scopes.length,
      committed: committed.committed,
      alreadyProcessed: committed.alreadyProcessed,
      awardsCreated: committed.awardsCreated,
      elapsedMs: Date.now() - startedAt
    });
    return committed;
  }
}

export const legendService = new LegendService();

