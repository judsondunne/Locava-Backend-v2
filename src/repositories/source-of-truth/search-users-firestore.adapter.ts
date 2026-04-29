import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "./firestore-client.js";
import { logFirestoreDebug } from "./firestore-debug.js";

export type FirestoreUserSearchRecord = {
  userId: string;
  handle: string;
  name: string;
  pic: string | null;
};

export type FirestoreUserSearchPage = {
  users: FirestoreUserSearchRecord[];
  hasMore: boolean;
  nextCursor: string | null;
  queryCount: number;
  readCount: number;
};

const SUGGEST_CURSOR_PREFIX = "sgh:";

export class SearchUsersFirestoreAdapter {
  private readonly db = getFirestoreSourceClient();
  private static readonly MAX_SCAN_LIMIT = 24;
  private static readonly FIRESTORE_TIMEOUT_MS = 1_800;

  isEnabled(): boolean {
    return this.db !== null;
  }

  /**
   * Lexicographic browse by searchHandle (Instagram-style “suggested” before typing).
   * Cursor encodes last searchHandle for startAfter; second page+ requires composite ordering.
   */
  async suggestedUsersPage(input: { cursor: string | null; limit: number }): Promise<FirestoreUserSearchPage> {
    if (!this.db) {
      throw new Error("firestore_source_unavailable");
    }
    const { cursor, limit } = input;
    const safeLimit = Math.max(1, Math.min(limit, 12));
    const startAfterHandle =
      cursor && cursor.startsWith(SUGGEST_CURSOR_PREFIX) ? cursor.slice(SUGGEST_CURSOR_PREFIX.length).trim() : null;

    let queryRef = this.db
      .collection("users")
      .orderBy("searchHandle")
      .select("searchHandle", "name", "handle", "profilePic", "profilePicture", "photo")
      .limit(safeLimit + 1);

    if (startAfterHandle) {
      queryRef = queryRef.startAfter(startAfterHandle);
    }

    const startedAt = Date.now();
    logFirestoreDebug("search_users_suggested_firestore_start", {
      collectionPath: "users",
      queryShape: "orderBy(searchHandle).select(searchHandle,name,handle,profilePic,profilePicture,photo).limit(safeLimit+1)",
      cursor,
      limit: safeLimit,
      timeoutMs: SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS
    });
    let snap;
    try {
      snap = await withTimeout(
        queryRef.get(),
        SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        "search-users-firestore-suggested"
      );
      logFirestoreDebug("search_users_suggested_firestore_success", {
        collectionPath: "users",
        elapsedMs: Date.now() - startedAt,
        docsRead: snap.docs.length,
        timeoutMs: SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS
      });
    } catch (error) {
      logFirestoreDebug("search_users_suggested_firestore_error", {
        collectionPath: "users",
        elapsedMs: Date.now() - startedAt,
        timeoutMs: SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }

    const rows: Array<FirestoreUserSearchRecord & { _orderKey: string }> = [];
    for (const doc of snap.docs) {
      const data = doc.data() as {
        searchHandle?: string;
        handle?: string;
        name?: string;
        profilePic?: string;
        profilePicture?: string;
        photo?: string;
      };
      const orderKey = String(data.searchHandle ?? data.handle ?? doc.id).toLowerCase();
      rows.push({
        userId: doc.id,
        handle: String(data.handle ?? "").replace(/^@+/, ""),
        name: String(data.name ?? "").trim() || nullFallbackName(doc.id),
        pic: firstPic(data),
        _orderKey: orderKey
      });
    }

    const hasMore = rows.length > safeLimit;
    const page = hasMore ? rows.slice(0, safeLimit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? `${SUGGEST_CURSOR_PREFIX}${last._orderKey}` : null;
    const users = page.map(({ _orderKey: _k, ...rest }) => rest);

    return {
      users,
      hasMore,
      nextCursor,
      queryCount: 1,
      readCount: snap.docs.length
    };
  }

  async searchUsersPage(input: { query: string; cursorOffset: number; limit: number }): Promise<FirestoreUserSearchPage> {
    if (!this.db) {
      throw new Error("firestore_source_unavailable");
    }
    const { query, cursorOffset, limit } = input;
    const normalized = query.trim().toLowerCase();
    const scanLimit = Math.min(SearchUsersFirestoreAdapter.MAX_SCAN_LIMIT, Math.max(limit + 1, 8));
    const hi = `${normalized}\uf8ff`;

    const startedAt = Date.now();
    logFirestoreDebug("search_users_firestore_start", {
      collectionPath: "users",
      queryShape:
        "Promise.all([where(searchHandle range).orderBy(searchHandle), where(searchName range).orderBy(searchName)]).select(name,handle,profilePic,profilePicture,photo).limit(scanLimit)",
      normalizedQuery: normalized,
      cursorOffset,
      limit,
      scanLimit,
      timeoutMs: SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS
    });
    let handleSnap;
    let nameSnap;
    try {
      handleSnap = await withTimeout(
        this.db
          .collection("users")
          .where("searchHandle", ">=", normalized)
          .where("searchHandle", "<=", hi)
          .orderBy("searchHandle")
          .select("name", "handle", "profilePic", "profilePicture", "photo")
          .limit(scanLimit)
          .get(),
        SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        "search-users-firestore-handle-query"
      );
      nameSnap =
        handleSnap.docs.length >= limit
          ? { docs: [] as QueryDocumentSnapshot[] }
          : await withTimeout(
              this.db
                .collection("users")
                .where("searchName", ">=", normalized)
                .where("searchName", "<=", hi)
                .orderBy("searchName")
                .select("name", "handle", "profilePic", "profilePicture", "photo")
                .limit(Math.max(4, limit - handleSnap.docs.length + 2))
                .get(),
              SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
              "search-users-firestore-name-query"
            );
      logFirestoreDebug("search_users_firestore_success", {
        collectionPath: "users",
        elapsedMs: Date.now() - startedAt,
        handleDocsRead: handleSnap.docs.length,
        nameDocsRead: nameSnap.docs.length,
        timeoutMs: SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS
      });
    } catch (error) {
      logFirestoreDebug("search_users_firestore_error", {
        collectionPath: "users",
        elapsedMs: Date.now() - startedAt,
        timeoutMs: SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }

    const byId = new Map<string, FirestoreUserSearchRecord & { score: number }>();
    const scoreDoc = (doc: QueryDocumentSnapshot): number => {
      const data = doc.data() as { handle?: string; name?: string };
      const handle = String(data.handle ?? "").toLowerCase().replace(/^@+/, "");
      const name = String(data.name ?? "").toLowerCase();
      if (handle === normalized || name === normalized) return 0;
      if (handle.startsWith(normalized) || name.startsWith(normalized)) return 1;
      return 2;
    };
    const addDoc = (doc: QueryDocumentSnapshot): void => {
      const data = doc.data() as { handle?: string; name?: string; profilePic?: string; profilePicture?: string; photo?: string };
      const current = byId.get(doc.id);
      const score = scoreDoc(doc);
      if (current && current.score <= score) {
        return;
      }
      byId.set(doc.id, {
        userId: doc.id,
        handle: String(data.handle ?? "").replace(/^@+/, ""),
        name: String(data.name ?? "").trim() || nullFallbackName(doc.id),
        pic: firstPic(data),
        score
      });
    };
    handleSnap.docs.forEach(addDoc);
    nameSnap.docs.forEach(addDoc);

    const ranked = [...byId.values()].sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.handle.localeCompare(b.handle);
    });

    const endExclusive = Math.min(ranked.length, cursorOffset + limit);
    const page = ranked.slice(cursorOffset, endExclusive).map(({ score: _score, ...rest }) => rest);
    const queryCount = nameSnap.docs.length > 0 ? 2 : 1;
    return {
      users: page,
      hasMore: endExclusive < ranked.length,
      nextCursor: endExclusive < ranked.length ? `cursor:${endExclusive}` : null,
      queryCount,
      readCount: handleSnap.docs.length + nameSnap.docs.length
    };
  }

  async getViewerFollowingUserIds(viewerId: string, userIds: string[]): Promise<{ userIds: string[]; queryCount: number; readCount: number }> {
    const db = this.db;
    if (!db || userIds.length === 0) {
      return { userIds: [], queryCount: 0, readCount: 0 };
    }
    const unique = [...new Set(userIds)];
    try {
      const viewerDoc = await withTimeout(
        db.collection("users").doc(viewerId).get(),
        SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        "search-users-firestore-following-array"
      );
      const data = (viewerDoc.data() ?? {}) as { following?: unknown };
      if (Array.isArray(data.following)) {
        const followingSet = new Set(
          data.following.filter((value): value is string => typeof value === "string" && value.length > 0)
        );
        return {
          userIds: unique.filter((userId) => followingSet.has(userId)),
          queryCount: 1,
          readCount: viewerDoc.exists ? 1 : 0
        };
      }
    } catch (error) {
      logFirestoreDebug("search_users_following_array_firestore_error", {
        collectionPath: `users/${viewerId}`,
        viewerId,
        timeoutMs: SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
    }
    const refs = unique.map((targetUserId) => db.collection("users").doc(viewerId).collection("following").doc(targetUserId));
    const startedAt = Date.now();
    logFirestoreDebug("search_users_following_firestore_start", {
      collectionPath: `users/${viewerId}/following/*`,
      queryShape: "getAll(user/{viewerId}/following/{targetUserId})",
      viewerId,
      targetCount: refs.length,
      timeoutMs: SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS
    });
    let docs;
    try {
      docs = await withTimeout(
        db.getAll(...refs),
        SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        "search-users-firestore-following"
      );
      logFirestoreDebug("search_users_following_firestore_success", {
        collectionPath: `users/${viewerId}/following/*`,
        elapsedMs: Date.now() - startedAt,
        docsRead: docs.length,
        timeoutMs: SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS
      });
    } catch (error) {
      logFirestoreDebug("search_users_following_firestore_error", {
        collectionPath: `users/${viewerId}/following/*`,
        elapsedMs: Date.now() - startedAt,
        timeoutMs: SearchUsersFirestoreAdapter.FIRESTORE_TIMEOUT_MS,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
    const following = docs.filter((doc) => doc.exists).map((doc) => doc.id);
    return {
      userIds: following,
      queryCount: 1,
      readCount: docs.length
    };
  }
}

function firstPic(data: { profilePic?: string; profilePicture?: string; photo?: string }): string | null {
  const raw = data.profilePic ?? data.profilePicture ?? data.photo;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return null;
  if (/via\.placeholder\.com/i.test(trimmed) || /placeholder/i.test(trimmed)) return null;
  return trimmed;
}

function nullFallbackName(userId: string): string {
  return `User ${userId.slice(0, 8)}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      reject(new Error(`${label}_timeout`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}
