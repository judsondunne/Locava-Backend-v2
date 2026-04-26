import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { incrementDbOps } from "../../observability/request-context.js";
import { recordFallback } from "../../observability/request-context.js";
import { recordTimeout } from "../../observability/request-context.js";
import { mutationStateRepository } from "../mutations/mutation-state.repository.js";
import { logFirestoreDebug } from "../source-of-truth/firestore-debug.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { SearchUsersFirestoreAdapter, type FirestoreUserSearchRecord } from "../source-of-truth/search-users-firestore.adapter.js";
import {
  enforceSourceOfTruthStrictness,
  SourceOfTruthRequiredError
} from "../source-of-truth/strict-mode.js";

export type SearchUsersPageRecord = {
  query: string;
  cursorIn: string | null;
  users: FirestoreUserSearchRecord[];
  hasMore: boolean;
  nextCursor: string | null;
  mode: "search" | "suggested";
};

const SUGGEST_CURSOR_PREFIX = "sgh:";

export class SearchUsersRepository {
  constructor(private readonly firestoreAdapter: SearchUsersFirestoreAdapter = new SearchUsersFirestoreAdapter()) {}

  private async loadViewerDoc(viewerId: string): Promise<Record<string, unknown> | null> {
    const cached = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId));
    if (cached !== undefined) return cached;
    const db = getFirestoreSourceClient();
    if (!db) return null;
    const snap = await db.collection("users").doc(viewerId).get();
    incrementDbOps("queries", 1);
    incrementDbOps("reads", snap.exists ? 1 : 0);
    const data = (snap.data() as Record<string, unknown> | undefined) ?? {};
    await globalCache.set(entityCacheKeys.userFirestoreDoc(viewerId), data, 25_000);
    return data;
  }

  async loadViewerFollowingIds(viewerId: string): Promise<string[] | null> {
    const viewerDoc = await this.loadViewerDoc(viewerId);
    if (!viewerDoc || !Array.isArray(viewerDoc.following)) {
      return null;
    }
    return viewerDoc.following.filter(
      (userId): userId is string => typeof userId === "string" && userId.length > 0,
    );
  }

  async getCachedViewerFollowingUserIds(viewerId: string, userIds: string[]): Promise<string[]> {
    const unique = [...new Set(userIds)];
    const cached = await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId));
    if (cached && Array.isArray(cached.following)) {
      const following = new Set(
        cached.following.filter((userId): userId is string => typeof userId === "string" && userId.length > 0),
      );
      const shadowFollowing = unique.filter((userId) => mutationStateRepository.isFollowing(viewerId, userId));
      return [...new Set(unique.filter((userId) => following.has(userId)).concat(shadowFollowing))];
    }
    return unique.filter((userId) => mutationStateRepository.isFollowing(viewerId, userId));
  }

  parseOffsetCursor(cursor: string | null): number {
    if (!cursor) return 0;
    const match = /^cursor:(\d+)$/.exec(cursor.trim());
    if (!match) {
      throw new Error("invalid_search_users_cursor");
    }
    const offset = Number(match[1]);
    if (!Number.isFinite(offset) || offset < 0) {
      throw new Error("invalid_search_users_cursor");
    }
    return Math.floor(offset);
  }

  private filterExcluded(users: FirestoreUserSearchRecord[], exclude: ReadonlySet<string>): FirestoreUserSearchRecord[] {
    if (exclude.size === 0) return users;
    return users.filter((u) => !exclude.has(u.userId));
  }

  private buildSuggestedEmpty(cursor: string | null, limit: number, _exclude: ReadonlySet<string>): SearchUsersPageRecord {
    const safeLimit = Math.max(1, Math.min(limit, 12));
    return {
      query: "",
      cursorIn: cursor,
      users: [],
      hasMore: false,
      nextCursor: null,
      mode: "suggested"
    };
  }

  private buildSearchEmpty(query: string, cursor: string | null, limit: number, _exclude: ReadonlySet<string>): SearchUsersPageRecord {
    const safeLimit = Math.max(1, Math.min(limit, 12));
    return {
      query,
      cursorIn: cursor,
      users: [],
      hasMore: false,
      nextCursor: null,
      mode: "search"
    };
  }

  private async getSuggestedPage(input: {
    cursor: string | null;
    limit: number;
    exclude: ReadonlySet<string>;
  }): Promise<SearchUsersPageRecord> {
    const { cursor, limit, exclude } = input;
    const safeLimit = Math.max(1, Math.min(limit, 12));
    const offsetCursor = !cursor || cursor.startsWith(SUGGEST_CURSOR_PREFIX) ? null : cursor;
    const offset = offsetCursor ? this.parseOffsetCursor(offsetCursor) : 0;

    const useFirestoreLex = this.firestoreAdapter.isEnabled() && (!cursor || cursor.startsWith(SUGGEST_CURSOR_PREFIX));
    if (useFirestoreLex) {
      try {
        const page = await this.firestoreAdapter.suggestedUsersPage({
          cursor: cursor?.startsWith(SUGGEST_CURSOR_PREFIX) ? cursor : null,
          limit: safeLimit
        });
        incrementDbOps("queries", page.queryCount);
        incrementDbOps("reads", page.readCount);
        const users = this.filterExcluded(page.users, exclude);
        return {
          query: "",
          cursorIn: cursor,
          users,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          mode: "suggested"
        };
      } catch (error) {
        logFirestoreDebug("search_users_suggested_firestore_failure", {
          strictSourceOfTruthLabel: "search_users_suggested_firestore",
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined
        });
        if (error instanceof Error && error.message.includes("_timeout")) {
          recordTimeout("search_users_suggested_firestore");
        }
        recordFallback("search_users_suggested_firestore_fallback");
        enforceSourceOfTruthStrictness("search_users_suggested_firestore");
        throw new SourceOfTruthRequiredError("search_users_suggested_firestore");
      }
    }
    throw new SourceOfTruthRequiredError("search_users_suggested_firestore_unavailable");
  }

  async getSearchUsersPage(input: {
    query: string;
    cursor: string | null;
    limit: number;
    excludeUserIds: string[];
  }): Promise<SearchUsersPageRecord> {
    const exclude = new Set(input.excludeUserIds);
    const normalized = input.query.trim().toLowerCase();
    const safeLimit = Math.max(1, Math.min(input.limit, 12));

    if (normalized.length === 0) {
      return this.getSuggestedPage({ cursor: input.cursor, limit: safeLimit, exclude });
    }

    if (input.cursor && input.cursor.startsWith(SUGGEST_CURSOR_PREFIX)) {
      throw new Error("invalid_search_users_cursor");
    }

    const offset = this.parseOffsetCursor(input.cursor);

    if (this.firestoreAdapter.isEnabled()) {
      try {
        const page = await this.firestoreAdapter.searchUsersPage({
          query: normalized,
          cursorOffset: offset,
          limit: safeLimit
        });
        incrementDbOps("queries", page.queryCount);
        incrementDbOps("reads", page.readCount);
        const users = this.filterExcluded(page.users, exclude);
        return {
          query: normalized,
          cursorIn: input.cursor,
          users,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          mode: "search"
        };
      } catch (error) {
        logFirestoreDebug("search_users_firestore_failure", {
          strictSourceOfTruthLabel: "search_users_firestore",
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined
        });
        if (error instanceof Error && error.message.includes("_timeout")) {
          recordTimeout("search_users_firestore");
        }
        recordFallback("search_users_firestore_fallback");
        enforceSourceOfTruthStrictness("search_users_firestore");
        throw new SourceOfTruthRequiredError("search_users_firestore");
      }
    }
    throw new SourceOfTruthRequiredError("search_users_firestore_unavailable");
  }

  async getViewerFollowingUserIds(viewerId: string, userIds: string[]): Promise<string[]> {
    const unique = [...new Set(userIds)];
    const viewerDoc = await this.loadViewerDoc(viewerId);
    if (viewerDoc && Array.isArray(viewerDoc.following)) {
      const following = new Set(
        viewerDoc.following.filter((userId): userId is string => typeof userId === "string" && userId.length > 0)
      );
      const shadowFollowing = unique.filter((userId) => mutationStateRepository.isFollowing(viewerId, userId));
      return [...new Set(unique.filter((userId) => following.has(userId)).concat(shadowFollowing))];
    }
    if (this.firestoreAdapter.isEnabled()) {
      try {
        const firestoreFollowing = await this.firestoreAdapter.getViewerFollowingUserIds(viewerId, unique);
        incrementDbOps("queries", firestoreFollowing.queryCount);
        incrementDbOps("reads", firestoreFollowing.readCount);
        const shadowFollowing = unique.filter((userId) => mutationStateRepository.isFollowing(viewerId, userId));
        return [...new Set([...firestoreFollowing.userIds, ...shadowFollowing])];
      } catch (error) {
        if (error instanceof Error && error.message.includes("_timeout")) {
          recordTimeout("search_users_following_firestore");
        }
        recordFallback("search_users_following_firestore_fallback");
        enforceSourceOfTruthStrictness("search_users_following_firestore");
        return unique.filter((userId) => mutationStateRepository.isFollowing(viewerId, userId));
      }
    }
    return unique.filter((userId) => mutationStateRepository.isFollowing(viewerId, userId));
  }
}
