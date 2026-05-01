import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { AchievementLeaguePassCelebration } from "../../contracts/entities/achievement-entities.contract.js";
import type { AchievementLeagueDefinition } from "../../contracts/entities/achievement-entities.contract.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

type FirestoreMap = Record<string, unknown>;

type CreateParams = {
  userId: string;
  postId?: string;
  xpDelta: number;
  previousXp: number;
  newXp: number;
  source: string;
  requestedCelebrationId?: string;
};
type CelebrationEntry = {
  userId: string;
  userName: string;
  userPic?: string | null;
  rank: number;
  xp: number;
  isCurrentUser?: boolean;
};

export class AchievementCelebrationsService {
  private resolveLeague(leagues: AchievementLeagueDefinition[], xp: number): AchievementLeagueDefinition | null {
    const sorted = [...leagues].sort((a, b) => a.order - b.order);
    return sorted.find((league) => xp >= league.minXP && xp <= league.maxXP) ?? sorted[sorted.length - 1] ?? null;
  }

  private async loadLeagues(): Promise<AchievementLeagueDefinition[]> {
    const db = getFirestoreSourceClient();
    if (!db) return [];
    let snap;
    try {
      snap = await db.collection("leagues").where("active", "==", true).orderBy("order", "asc").get();
    } catch {
      snap = await db.collection("leagues").get();
    }
    return snap.docs
      .map((doc) => {
        const data = (doc.data() as FirestoreMap | undefined) ?? {};
        return {
          id: typeof data.id === "string" && data.id.trim().length > 0 ? data.id : doc.id,
          title: typeof data.title === "string" && data.title.trim().length > 0 ? data.title : doc.id,
          minXP: Number.isFinite(Number(data.minXP)) ? Math.trunc(Number(data.minXP)) : 0,
          maxXP: Number.isFinite(Number(data.maxXP)) ? Math.trunc(Number(data.maxXP)) : Number.MAX_SAFE_INTEGER,
          description: typeof data.description === "string" ? data.description : undefined,
          imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : undefined,
          icon: typeof data.icon === "string" ? data.icon : undefined,
          color: typeof data.color === "string" ? data.color : "#0f766e",
          bgColor: typeof data.bgColor === "string" ? data.bgColor : "#ecfeff",
          order: Number.isFinite(Number(data.order)) ? Math.trunc(Number(data.order)) : 999,
          active: data.active !== false
        } satisfies AchievementLeagueDefinition;
      })
      .filter((row) => row.active);
  }

  private async loadGlobalXpRows(): Promise<Array<{ userId: string; userName?: string; userPic?: string | null; xp: number; rank?: number }>> {
    const db = getFirestoreSourceClient();
    if (!db) return [];
    const cacheSnap = await db.collection("cache").doc("global_xp_leaderboard_v2").get();
    if (!cacheSnap.exists) return [];
    const data = (cacheSnap.data() as FirestoreMap | undefined) ?? {};
    const rows = Array.isArray(data.entries) ? data.entries : Array.isArray(data.leaderboard) ? data.leaderboard : [];
    const mappedRows = rows.map((row, index) => {
        const mapped = row as FirestoreMap;
        const userId = typeof mapped.userId === "string" ? mapped.userId : "";
        if (!userId) return null;
        const userName = typeof mapped.userName === "string" && mapped.userName.trim().length > 0 ? mapped.userName.trim() : undefined;
        const userPic = typeof mapped.userPic === "string" ? mapped.userPic : null;
        const xp = Number.isFinite(Number(mapped.xp)) ? Math.max(0, Math.trunc(Number(mapped.xp))) : 0;
        const rank = Number.isFinite(Number(mapped.rank)) ? Math.max(1, Math.trunc(Number(mapped.rank))) : index + 1;
        return { userId, userName, userPic, xp, rank };
      });
    const out: Array<{ userId: string; userName?: string; userPic?: string | null; xp: number; rank: number }> = [];
    for (const row of mappedRows) {
      if (row) out.push(row);
    }
    return out;
  }

  private computeRank(rows: Array<{ userId: string; userName?: string; userPic?: string | null; xp: number; rank?: number }>, userId: string, xp: number): number | null {
    const exact = rows.find((row) => row.userId === userId);
    if (exact?.rank) return exact.rank;
    if (rows.length === 0) return null;
    return Math.max(1, rows.filter((row) => row.xp > xp).length + 1);
  }

  private mapCelebration(raw: FirestoreMap | null | undefined): AchievementLeaguePassCelebration | null {
    if (!raw) return null;
    const celebrationId = typeof raw.celebrationId === "string" ? raw.celebrationId : "";
    if (!celebrationId) return null;
    return {
      shouldShow: raw.shouldShow === true,
      leaderboardKey: typeof raw.leaderboardKey === "string" && raw.leaderboardKey ? raw.leaderboardKey : "xp_global",
      previousRank: Number.isFinite(Number(raw.previousRank)) ? Math.max(1, Math.trunc(Number(raw.previousRank))) : null,
      newRank: Number.isFinite(Number(raw.newRank)) ? Math.max(1, Math.trunc(Number(raw.newRank))) : null,
      peoplePassed: Number.isFinite(Number(raw.peoplePassed)) ? Math.max(0, Math.trunc(Number(raw.peoplePassed))) : 0,
      previousLeague: typeof raw.previousLeague === "string" ? raw.previousLeague : null,
      newLeague: typeof raw.newLeague === "string" ? raw.newLeague : null,
      celebrationId,
      xpDelta: Number.isFinite(Number(raw.xpDelta)) ? Math.max(0, Math.trunc(Number(raw.xpDelta))) : 0,
      previousXp: Number.isFinite(Number(raw.previousXp)) ? Math.max(0, Math.trunc(Number(raw.previousXp))) : 0,
      newXp: Number.isFinite(Number(raw.newXp)) ? Math.max(0, Math.trunc(Number(raw.newXp))) : 0,
      source: typeof raw.source === "string" ? raw.source : null,
      sourcePostId: typeof raw.sourcePostId === "string" ? raw.sourcePostId : null,
      entries: Array.isArray(raw.entries)
        ? raw.entries.reduce<CelebrationEntry[]>((acc, entry) => {
            const row = (entry && typeof entry === "object" ? entry : {}) as FirestoreMap;
            const userId = typeof row.userId === "string" ? row.userId : "";
            const userName = typeof row.userName === "string" ? row.userName : "";
            if (!userId || !userName) return acc;
            acc.push({
              userId,
              userName,
              userPic: typeof row.userPic === "string" ? row.userPic : null,
              rank: Number.isFinite(Number(row.rank)) ? Math.max(1, Math.trunc(Number(row.rank))) : 1,
              xp: Number.isFinite(Number(row.xp)) ? Math.max(0, Math.trunc(Number(row.xp))) : 0,
              isCurrentUser: row.isCurrentUser === true
            });
            return acc;
          }, [])
        : undefined,
      createdAtMs: Number.isFinite(Number(raw.createdAtMs)) ? Math.max(0, Math.trunc(Number(raw.createdAtMs))) : 0,
      consumedAtMs: Number.isFinite(Number(raw.consumedAtMs)) ? Math.max(0, Math.trunc(Number(raw.consumedAtMs))) : null
    };
  }

  async createLeaguePassCelebration(params: CreateParams): Promise<AchievementLeaguePassCelebration | null> {
    const db = getFirestoreSourceClient();
    if (!db) return null;
    const [rows, leagues] = await Promise.all([this.loadGlobalXpRows(), this.loadLeagues()]);
    const previousRank = this.computeRank(rows, params.userId, params.previousXp);
    const newRank = this.computeRank(rows, params.userId, params.newXp);
    if (previousRank == null || newRank == null || newRank >= previousRank) {
      console.info("[league_pass_computation]", {
        event: "league_pass_computation",
        userId: params.userId,
        leaderboardKey: "xp_global",
        previousRank,
        newRank,
        peoplePassed: 0,
        shouldCreateCelebration: false,
        reasonSkipped: "rank_not_improved_or_missing"
      });
      return null;
    }
    const peoplePassed = Math.max(0, previousRank - newRank);
    if (peoplePassed <= 0) {
      console.info("[league_pass_computation]", {
        event: "league_pass_computation",
        userId: params.userId,
        leaderboardKey: "xp_global",
        previousRank,
        newRank,
        peoplePassed,
        shouldCreateCelebration: false,
        reasonSkipped: "people_passed_zero"
      });
      return null;
    }
    const previousLeague = this.resolveLeague(leagues, params.previousXp);
    const nextLeague = this.resolveLeague(leagues, params.newXp);
    const sortedRows = [...rows].sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
    const crossed = sortedRows
      .filter((row) => row.userId !== params.userId && row.rank != null && row.rank > newRank && row.rank <= previousRank)
      .slice(0, 24);
    const viewerRow = sortedRows.find((row) => row.userId === params.userId) ?? null;
    const entries: CelebrationEntry[] = [
      ...crossed.map((row) => ({
        userId: row.userId,
        userName: row.userName ?? row.userId,
        userPic: row.userPic ?? null,
        rank: row.rank ?? 1,
        xp: row.xp,
        isCurrentUser: false
      })),
      {
        userId: params.userId,
        userName: "You",
        userPic: null,
        rank: newRank,
        xp: params.newXp,
        isCurrentUser: true
      },
    ]
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 40);
    const createdAtMs = Date.now();
    const celebrationId =
      params.requestedCelebrationId && params.requestedCelebrationId.trim().length > 0
        ? params.requestedCelebrationId.trim()
        : `lgpass_${createdAtMs}_${randomUUID().slice(0, 8)}`;
    const celebration: AchievementLeaguePassCelebration = {
      shouldShow: true,
      leaderboardKey: "xp_global",
      previousRank,
      newRank,
      peoplePassed,
      previousLeague: previousLeague?.id ?? null,
      newLeague: nextLeague?.id ?? null,
      celebrationId,
      xpDelta: Math.max(0, params.xpDelta),
      previousXp: Math.max(0, params.previousXp),
      newXp: Math.max(0, params.newXp),
      source: params.source,
      sourcePostId: params.postId ?? null,
      entries,
      createdAtMs,
      consumedAtMs: null
    };
    await db
      .collection("users")
      .doc(params.userId)
      .collection("achievementCelebrations")
      .doc(celebrationId)
      .set(
        {
          ...celebration,
          type: "league_pass",
          consumed: false,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    console.info("[league_pass_computation]", {
      event: "league_pass_computation",
      userId: params.userId,
      leaderboardKey: "xp_global",
      previousRank,
      newRank,
      peoplePassed,
      shouldCreateCelebration: true,
      reasonSkipped: null
    });
    console.info("[achievement_celebration_created]", {
      event: "achievement_celebration_created",
      userId: params.userId,
      celebrationId,
      type: "league_pass",
      postId: params.postId ?? null,
      sourcePostId: params.postId ?? null,
      source: params.source,
      xpDelta: params.xpDelta,
      previousRank,
      newRank,
      peoplePassed,
      consumed: false,
      createdAtMs,
      path: `users/${params.userId}/achievementCelebrations/${celebrationId}`
    });
    return celebration;
  }

  async getPendingCelebrations(userId: string): Promise<AchievementLeaguePassCelebration[]> {
    const db = getFirestoreSourceClient();
    if (!db) return [];
    let snap;
    try {
      snap = await db
        .collection("users")
        .doc(userId)
        .collection("achievementCelebrations")
        .where("consumed", "==", false)
        .orderBy("createdAtMs", "asc")
        .limit(10)
        .get();
    } catch (error) {
      console.warn("[achievement_pending_celebrations_result]", {
        event: "achievement_pending_celebrations_result",
        userId,
        queryPath: `users/${userId}/achievementCelebrations`,
        queryFilters: ["consumed==false", "orderBy(createdAtMs,asc)", "limit(10)"],
        returnedCount: 0,
        celebrationIds: [],
        types: [],
        payloadBytes: 2,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
    const results = snap.docs
      .map((doc) => this.mapCelebration((doc.data() as FirestoreMap | undefined) ?? null))
      .filter((row): row is AchievementLeaguePassCelebration => Boolean(row))
      .filter((row) => row.shouldShow && row.peoplePassed > 0);
    const serialized = JSON.stringify(results);
    console.info("[achievement_pending_celebrations_result]", {
      event: "achievement_pending_celebrations_result",
      userId,
      queryPath: `users/${userId}/achievementCelebrations`,
      queryFilters: ["consumed==false", "orderBy(createdAtMs,asc)", "limit(10)"],
      returnedCount: results.length,
      celebrationIds: results.map((row) => row.celebrationId),
      types: results.map(() => "league_pass"),
      payloadBytes: Buffer.byteLength(serialized, "utf8")
    });
    return results;
  }

  async consumeCelebration(userId: string, celebrationId: string): Promise<AchievementLeaguePassCelebration | null> {
    const db = getFirestoreSourceClient();
    if (!db) return null;
    const ref = db.collection("users").doc(userId).collection("achievementCelebrations").doc(celebrationId);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const nowMs = Date.now();
    await ref.set(
      {
        consumed: true,
        consumedAtMs: nowMs,
        consumedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    const mapped = this.mapCelebration((snap.data() as FirestoreMap | undefined) ?? null);
    if (!mapped) return null;
    console.info("[achievements.league_pass.consumed]", { userId, celebrationId });
    return {
      ...mapped,
      consumedAtMs: nowMs
    };
  }
}

export const achievementCelebrationsService = new AchievementCelebrationsService();
