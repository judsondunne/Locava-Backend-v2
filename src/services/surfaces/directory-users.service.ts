import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { entityCacheKeys, getOrSetEntityCache } from "../../cache/entity-cache.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { excludeKey } from "../../lib/user-discovery-exclude.js";
import { recordEntityConstructed } from "../../observability/request-context.js";
import type { DirectoryUsersRepository } from "../../repositories/surfaces/directory-users.repository.js";

export class DirectoryUsersService {
  constructor(private readonly repository: DirectoryUsersRepository) {}

  async loadDirectoryUsersPage(input: {
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
    return dedupeInFlight(`directory-users-page:${viewerId}:${normalized}:${cursorPart}:${limit}:${excl}`, () =>
      withConcurrencyLimit("directory-users-page-repo", 4, async () => {
        const page = await this.repository.getDirectoryUsersPage({
          query: normalized,
          cursor,
          limit,
          excludeUserIds
        });
        const items = page.users.map((user) => ({
          userId: user.userId,
          handle: user.handle,
          name: user.name,
          pic: user.pic
        }));
        void Promise.all(
          items.map((user) =>
            getOrSetEntityCache(entityCacheKeys.userSummary(user.userId), 25_000, async () => {
              recordEntityConstructed("AuthorSummary");
              return user;
            })
          )
        ).catch(() => undefined);
        const followingUserIds = await this.repository.getViewerFollowingUserIds(viewerId, page.users.map((user) => user.userId));
        return {
          ...page,
          items,
          followingUserIds
        };
      })
    );
  }
}
