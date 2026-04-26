import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { entityCacheKeys, getOrSetEntityCache } from "../../cache/entity-cache.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { excludeKey } from "../../lib/user-discovery-exclude.js";
import { recordEntityConstructed } from "../../observability/request-context.js";
import type { SearchUsersRepository } from "../../repositories/surfaces/search-users.repository.js";

export class SearchUsersService {
  constructor(private readonly repository: SearchUsersRepository) {}

  async loadUsersPage(input: {
    viewerId: string;
    query: string;
    cursor: string | null;
    limit: number;
    excludeUserIds: string[];
  }) {
    const { viewerId, query, cursor, limit, excludeUserIds } = input;
    const normalized = query.trim().toLowerCase();
    const cursorPart = cursor ?? "start";
    const excl = excludeKey(excludeUserIds);
    return dedupeInFlight(`search-users-page:${viewerId}:${normalized}:${cursorPart}:${limit}:${excl}`, () =>
      withConcurrencyLimit("search-users-page-repo", 4, async () => {
        const page = await this.repository.getSearchUsersPage({
          query: normalized,
          cursor,
          limit,
          excludeUserIds
        });
        const items = await Promise.all(
          page.users.map((user) =>
            getOrSetEntityCache(entityCacheKeys.userSummary(user.userId), 25_000, async () => {
              recordEntityConstructed("AuthorSummary");
              return {
                userId: user.userId,
                handle: user.handle,
                name: user.name,
                pic: user.pic
              };
            })
          )
        );
        const pageUserIds = page.users.map((user) => user.userId);
        const followingUserIds = await this.repository.getCachedViewerFollowingUserIds(
          viewerId,
          pageUserIds
        );
        return {
          ...page,
          items,
          followingUserIds
        };
      })
    );
  }
}
