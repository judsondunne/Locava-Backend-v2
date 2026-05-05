import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { incrementDbOps } from "../../observability/request-context.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import type {
  LegendAwardDoc,
  CanonicalFirstClaimDoc,
  CanonicalRankAggregateDoc,
  LegendPostStageDoc,
  LegendScopeDoc,
  LegendScopeId,
  LegendTopUserRow,
  LegendUserStatDoc,
  LegendPreviewCard,
  LegendPreviewCardType,
  LegendEventDoc
} from "./legends.types.js";

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

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asTopUsers(value: unknown): LegendTopUserRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const obj = asObject(row);
      const userId = asString(obj.userId);
      const count = finiteInt(obj.count, 0);
      if (!userId) return null;
      return { userId, count: Math.max(0, count) } satisfies LegendTopUserRow;
    })
    .filter((row): row is LegendTopUserRow => Boolean(row));
}

export class LegendRepository {
  private requireDb() {
    const db = getFirestoreSourceClient();
    if (!db) {
      throw new Error("firestore_unavailable_for_legends");
    }
    return db;
  }

  scopeRef(scopeId: LegendScopeId) {
    return this.requireDb().collection("legendScopes").doc(scopeId);
  }

  userStatRef(scopeId: LegendScopeId, userId: string) {
    return this.requireDb().collection("legendUserStats").doc(`${scopeId}_${userId}`);
  }

  processedPostRef(postId: string) {
    return this.requireDb().collection("legendProcessedPosts").doc(postId);
  }

  postResultRef(postId: string) {
    return this.requireDb().collection("legendPostResults").doc(postId);
  }

  stageRef(stageId: string) {
    return this.requireDb().collection("legendPostStages").doc(stageId);
  }

  firstClaimRef(claimKey: string) {
    return this.requireDb().collection("legendFirstClaims").doc(claimKey);
  }

  rankAggregateRef(aggregateKey: string) {
    return this.requireDb().collection("legendRankAggregates").doc(aggregateKey);
  }

  awardRef(userId: string, awardId: string) {
    return this.requireDb().collection("users").doc(userId).collection("legendAwards").doc(awardId);
  }

  legendEventRef(userId: string, eventId: string) {
    return this.requireDb().collection("users").doc(userId).collection("legendEvents").doc(eventId);
  }

  unseenLegendEventsQuery(userId: string, limit: number) {
    const capped = Math.max(1, Math.min(limit, 20));
    return this.requireDb()
      .collection("users")
      .doc(userId)
      .collection("legendEvents")
      .where("seen", "==", false)
      .orderBy("createdAt", "desc")
      .limit(capped);
  }

  userLegendsStateRef(userId: string) {
    return this.requireDb().collection("users").doc(userId).collection("legends").doc("state");
  }

  readScopeDoc(raw: unknown, scopeId: LegendScopeId): LegendScopeDoc {
    const obj = asObject(raw);
    const topUsers = asTopUsers(obj.topUsers);
    const leaderUserId = asString(obj.leaderUserId);
    const leaderCount = Math.max(0, finiteInt(obj.leaderCount, 0));
    const totalPosts = Math.max(0, finiteInt(obj.totalPosts, 0));
    return {
      scopeId,
      scopeType: (asString(obj.scopeType) as LegendScopeDoc["scopeType"]) ?? "cell",
      title: asString(obj.title) ?? scopeId,
      subtitle: asString(obj.subtitle) ?? "",
      placeType: (asString(obj.placeType) as LegendScopeDoc["placeType"]) ?? null,
      placeId: asString(obj.placeId),
      activityId: asString(obj.activityId),
      geohashPrecision: finiteInt(obj.geohashPrecision, 6) as LegendScopeDoc["geohashPrecision"],
      geohash: asString(obj.geohash),
      totalPosts,
      leaderUserId,
      leaderCount,
      topUsers,
      lastPostId: asString(obj.lastPostId),
      createdAt: obj.createdAt ?? null,
      updatedAt: obj.updatedAt ?? null
    };
  }

  readUserStatDoc(raw: unknown, input: { scopeId: LegendScopeId; userId: string }): LegendUserStatDoc {
    const obj = asObject(raw);
    const count = Math.max(0, finiteInt(obj.count, 0));
    const isLeader = obj.isLeader === true;
    const rankSnapshot = obj.rankSnapshot == null ? null : Math.max(1, finiteInt(obj.rankSnapshot, 1));
    return {
      scopeId: input.scopeId,
      userId: input.userId,
      count,
      rankSnapshot,
      isLeader,
      lastPostId: asString(obj.lastPostId),
      createdAt: obj.createdAt ?? null,
      updatedAt: obj.updatedAt ?? null
    };
  }

  readStageDoc(raw: unknown, stageId: string): LegendPostStageDoc {
    const obj = asObject(raw);
    const derivedScopes = Array.isArray(obj.derivedScopes) ? obj.derivedScopes.map((s) => String(s ?? "")).filter(Boolean) : [];
    const previewCards = Array.isArray(obj.previewCards) ? (obj.previewCards as any[]) : [];
    const allowedTypes = new Set<LegendPreviewCardType>([
      "possible_first_finder",
      "possible_first_activity_finder",
      "close_to_legend",
      "possible_new_leader"
    ]);
    return {
      stageId,
      userId: asString(obj.userId) ?? "",
      status: (asString(obj.status) as LegendPostStageDoc["status"]) ?? "staged",
      derivedScopes,
      previewCards: (previewCards
        .map((c) => asObject(c))
        .map((c) => {
          const type = String(c.type ?? "") as LegendPreviewCardType;
          if (!allowedTypes.has(type)) return null;
          const scopeId = String(c.scopeId ?? "");
          const title = String(c.title ?? "");
          const subtitle = String(c.subtitle ?? "");
          if (!scopeId || !title) return null;
          return { type, scopeId, title, subtitle } satisfies LegendPreviewCard;
        })
        .filter((c): c is LegendPreviewCard => Boolean(c))) satisfies LegendPreviewCard[],
      createdAt: obj.createdAt ?? null,
      expiresAt: obj.expiresAt ?? null,
      committedPostId: asString(obj.committedPostId)
    };
  }

  async createStage(params: {
    stageId: string;
    userId: string;
    derivedScopes: string[];
    previewCards: LegendPostStageDoc["previewCards"];
    expiresAtMs: number;
  }): Promise<void> {
    const db = this.requireDb();
    const ref = db.collection("legendPostStages").doc(params.stageId);
    await ref.set(
      {
        stageId: params.stageId,
        userId: params.userId,
        status: "staged",
        derivedScopes: params.derivedScopes,
        previewCards: params.previewCards,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(params.expiresAtMs),
        committedPostId: null
      },
      { merge: false }
    );
    incrementDbOps("writes", 1);
  }

  async cancelStage(stageId: string, viewerUserId: string): Promise<{ cancelled: boolean }> {
    const db = this.requireDb();
    const ref = db.collection("legendPostStages").doc(stageId);
    const snap = await ref.get();
    incrementDbOps("reads", snap.exists ? 1 : 0);
    if (!snap.exists) return { cancelled: false };
    const data = (snap.data() as FirestoreMap | undefined) ?? {};
    const ownerId = asString(data.userId) ?? "";
    if (!ownerId || ownerId !== viewerUserId) return { cancelled: false };
    const status = asString(data.status) ?? "";
    if (status === "committed") return { cancelled: false };
    await ref.set(
      {
        status: "cancelled",
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    incrementDbOps("writes", 1);
    return { cancelled: true };
  }

  buildNowTimestamp(): { now: Date; nowTs: Timestamp } {
    const now = new Date();
    return { now, nowTs: Timestamp.fromDate(now) };
  }

  buildDefaultScopeDoc(params: {
    scopeId: LegendScopeId;
    scopeType: LegendScopeDoc["scopeType"];
    title: string;
    subtitle: string;
    placeType?: LegendScopeDoc["placeType"];
    placeId?: string | null;
    activityId?: string | null;
    geohashPrecision?: LegendScopeDoc["geohashPrecision"];
    geohash?: string | null;
  }): Omit<LegendScopeDoc, "createdAt" | "updatedAt"> {
    return {
      scopeId: params.scopeId,
      scopeType: params.scopeType,
      title: params.title,
      subtitle: params.subtitle,
      placeType: params.placeType ?? null,
      placeId: params.placeId ?? null,
      activityId: params.activityId ?? null,
      geohashPrecision: params.geohashPrecision ?? null,
      geohash: params.geohash ?? null,
      totalPosts: 0,
      leaderUserId: null,
      leaderCount: 0,
      topUsers: [],
      lastPostId: null
    };
  }

  buildDefaultUserStatDoc(params: { scopeId: LegendScopeId; userId: string }): Omit<LegendUserStatDoc, "createdAt" | "updatedAt"> {
    return {
      scopeId: params.scopeId,
      userId: params.userId,
      count: 0,
      rankSnapshot: null,
      isLeader: false,
      lastPostId: null
    };
  }

  buildAwardDoc(params: Omit<LegendAwardDoc, "createdAt" | "seen">): LegendAwardDoc {
    return {
      ...params,
      createdAt: FieldValue.serverTimestamp(),
      seen: false
    };
  }

  buildFirstClaimDoc(params: Omit<CanonicalFirstClaimDoc, "createdAt" | "claimedAt">): CanonicalFirstClaimDoc {
    return {
      ...params,
      createdAt: FieldValue.serverTimestamp(),
      claimedAt: FieldValue.serverTimestamp()
    };
  }

  buildRankAggregateDoc(params: CanonicalRankAggregateDoc): CanonicalRankAggregateDoc {
    return {
      ...params,
      updatedAt: FieldValue.serverTimestamp()
    };
  }

  buildEventDoc(params: Omit<LegendEventDoc, "createdAt" | "seen">): LegendEventDoc {
    return {
      ...params,
      createdAt: FieldValue.serverTimestamp(),
      seen: false
    };
  }
}

export const legendRepository = new LegendRepository();

