import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import type { DirectoryUsersResponse } from "../../contracts/surfaces/directory-users.contract.js";
import { excludeKey } from "../../lib/user-discovery-exclude.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import type { DirectoryUsersService } from "../../services/surfaces/directory-users.service.js";

export class DirectoryUsersOrchestrator {
  constructor(private readonly service: DirectoryUsersService) {}

  async run(input: {
    viewerId: string;
    query: string;
    cursor: string | null;
    limit: number;
    excludeUserIds: string[];
  }): Promise<DirectoryUsersResponse> {
    const { viewerId, query, cursor, limit, excludeUserIds } = input;
    const normalized = query.trim().toLowerCase();
    const cursorPart = cursor ?? "start";
    const cacheKey = buildCacheKey("list", [
      "directory-users-v2",
      viewerId,
      normalized,
      cursorPart,
      String(limit),
      excludeKey(excludeUserIds)
    ]);
    const cached = await globalCache.get<DirectoryUsersResponse>(cacheKey);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();

    const page = await this.service.loadDirectoryUsersPage({
      viewerId,
      query: normalized,
      cursor,
      limit,
      excludeUserIds
    });
    const requestKey = `${viewerId}:${normalized || "all"}:${cursorPart}:${limit}:${excludeKey(excludeUserIds)}`;
    const following = new Set(page.followingUserIds);
    const isSuggested = page.mode === "suggested";
    const response: DirectoryUsersResponse = {
      routeName: "directory.users.get",
      requestKey,
      queryEcho: normalized,
      page: {
        cursorIn: cursor,
        limit,
        count: page.items.length,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        sort: "directory_users_relevance_v1"
      },
      items: page.items.map((row) => ({
        userId: row.userId,
        handle: row.handle,
        displayName: row.name,
        profilePic: row.pic,
        isFollowing: following.has(row.userId),
        isSuggested
      })),
      viewer: {
        followingUserIds: page.followingUserIds
      },
      degraded: false,
      fallbacks: []
    };
    await globalCache.set(cacheKey, response, 8_000);
    return response;
  }
}
