import { describe, expect, it } from "vitest";
import { SearchUsersRepository } from "./search-users.repository.js";
import { getRequestContext, runWithRequestContext, type RequestContext } from "../../observability/request-context.js";

function withRequestContext<T>(fn: () => Promise<T>): Promise<T> {
  const ctx: RequestContext = {
    requestId: "test-request",
    route: "/test",
    method: "GET",
    startNs: 0n,
    payloadBytes: 0,
    dbOps: { reads: 0, writes: 0, queries: 0 },
    cache: { hits: 0, misses: 0 },
    dedupe: { hits: 0, misses: 0 },
    concurrency: { waits: 0 },
    entityCache: { hits: 0, misses: 0 },
    entityConstruction: { total: 0, types: {} },
    idempotency: { hits: 0, misses: 0 },
    invalidation: { keys: 0, entityKeys: 0, routeKeys: 0, types: {} },
    fallbacks: [],
    timeouts: [],
    surfaceTimings: {}
  };
  return runWithRequestContext(ctx, fn);
}

describe("search users repository", () => {
  it("uses firestore adapter when available", async () => {
    const repository = new SearchUsersRepository({
      isEnabled: () => true,
      searchUsersPage: async () => ({
        users: [
          { userId: "u-1", handle: "jane", name: "Jane", pic: null },
          { userId: "u-2", handle: "john", name: "John", pic: "https://pic" }
        ],
        hasMore: false,
        nextCursor: null,
        queryCount: 2,
        readCount: 5
      }),
      getViewerFollowingUserIds: async () => ({
        userIds: ["u-2"],
        queryCount: 1,
        readCount: 2
      })
    } as never);

    await withRequestContext(async () => {
      const page = await repository.getSearchUsersPage({ query: "jo", cursor: null, limit: 8, excludeUserIds: [] });
      expect(page.users.map((u) => u.userId)).toEqual(["u-1", "u-2"]);
      const following = await repository.getViewerFollowingUserIds("viewer-1", ["u-1", "u-2"]);
      expect(following).toEqual(["u-2"]);
      const ctx = getRequestContext();
      expect(ctx?.dbOps.queries).toBe(3);
      expect(ctx?.dbOps.reads).toBe(7);
    });
  });

  it("returns empty page when firestore adapter fails (no fabricated users)", async () => {
    const repository = new SearchUsersRepository({
      isEnabled: () => true,
      searchUsersPage: async () => {
        throw new Error("firestore down");
      },
      getViewerFollowingUserIds: async () => {
        throw new Error("firestore down");
      }
    } as never);

    await withRequestContext(async () => {
      const page = await repository.getSearchUsersPage({ query: "creator", cursor: null, limit: 5, excludeUserIds: [] });
      expect(page.users).toEqual([]);
      const following = await repository.getViewerFollowingUserIds("viewer-1", page.users.map((u) => u.userId));
      expect(following).toEqual([]);
      const ctx = getRequestContext();
      expect(ctx?.fallbacks).toContain("search_users_firestore_fallback");
      expect(ctx?.fallbacks).toContain("search_users_following_firestore_fallback");
    });
  });
});
