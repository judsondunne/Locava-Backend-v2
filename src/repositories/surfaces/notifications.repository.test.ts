import { afterEach, describe, expect, it, vi } from "vitest";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { type RequestContext, getRequestContext, runWithRequestContext } from "../../observability/request-context.js";
import * as firestoreClient from "../source-of-truth/firestore-client.js";

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
    surfaceTimings: {},
    orchestration: {
      surface: null,
      priority: null,
      requestGroup: null,
      visiblePostId: null,
      screenInstanceId: null,
      clientRequestId: null,
      hydrationMode: null,
      stale: false,
      canceled: false,
      deduped: false,
      queueWaitMs: 0,
    },
    audit: {}
  };
  return runWithRequestContext(ctx, fn);
}

async function makeRepository() {
  const mod = await import("./notifications.repository.js");
  return new mod.NotificationsRepository();
}

describe("notifications repository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses cached notification read-state instead of refetching the doc", async () => {
    const batchUpdate = vi.fn();
    const batchCommit = vi.fn(async () => undefined);
    const userSet = vi.fn(async () => undefined);
    const getAll = vi.fn(async () => []);
    const notificationDocRef = { id: "notif-1" };
    const db = {
      getAll,
      batch: () => ({
        update: batchUpdate,
        commit: batchCommit
      }),
      collection: (name: string) => {
        if (name !== "users") throw new Error(`unexpected_collection:${name}`);
        return {
          doc: (_viewerId: string) => ({
            set: userSet,
            collection: (sub: string) => {
              if (sub !== "notifications") throw new Error(`unexpected_subcollection:${sub}`);
              return {
                doc: (_notificationId: string) => notificationDocRef
              };
            }
          })
        };
      }
    };

    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(db as never);
    vi.spyOn(globalCache, "get").mockImplementation(async (key: string) => {
      if (key === entityCacheKeys.notificationsUnreadCount("viewer-1")) return 3;
      if (key === "notification:viewer-1:notif-1:read-state") {
        return { exists: true, read: false };
      }
      return undefined;
    });
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);

    const repository = await makeRepository();
    const result = await repository.markRead({
      viewerId: "viewer-1",
      notificationIds: ["notif-1"]
    });

    expect(getAll).not.toHaveBeenCalled();
    expect(batchUpdate).toHaveBeenCalledWith(notificationDocRef, expect.objectContaining({ read: true }));
    expect(batchCommit).toHaveBeenCalledTimes(1);
    expect(userSet).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      requestedCount: 1,
      markedCount: 1,
      unreadCount: 2,
      idempotent: false
    });
  });

  it("uses a single query on cold list when unread/read-all caches are already primed", async () => {
    const pageGet = vi.fn(async () => ({
      docs: [
        {
          id: "notif-2",
          data: () => ({
            type: "like",
            senderUserId: "actor-2",
            senderName: "Actor Two",
            senderProfilePic: "https://example.com/actor-2.jpg",
            message: "liked your post",
            timestamp: 1_000,
            read: false,
            postId: "post-2"
          })
        }
      ]
    }));
    const db = {
      collection: (name: string) => {
        if (name !== "users") throw new Error(`unexpected_collection:${name}`);
        return {
          doc: (_viewerId: string) => ({
            collection: (sub: string) => {
              if (sub !== "notifications") throw new Error(`unexpected_subcollection:${sub}`);
              const query = {
                orderBy: () => query,
                select: () => query,
                limit: () => query,
                startAfter: () => query,
                get: pageGet
              };
              return query;
            }
          })
        };
      }
    };

    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(db as never);
    vi.spyOn(globalCache, "get").mockImplementation(async (key: string) => {
      if (key === entityCacheKeys.notificationsUnreadCount("viewer-1")) return 7;
      if (key === entityCacheKeys.notificationsReadAllAt("viewer-1")) return 2_000;
      return undefined;
    });
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);

    const repository = await makeRepository();
    await withRequestContext(async () => {
      const page = await repository.listNotifications({
        viewerId: "viewer-1",
        cursor: null,
        limit: 10
      });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.readState).toBe("unread");
      expect(page.unreadCount).toBe(7);
      expect(page.degraded).toBe(false);
      expect(page.fallbacks).toEqual([]);
      const ctx = getRequestContext();
      expect(ctx?.dbOps.queries).toBe(1);
      expect(ctx?.dbOps.reads).toBe(1);
    });
  });

  it("returns staged unread count instead of issuing a second query on cold cache miss", async () => {
    const pageGet = vi.fn(async () => ({
      docs: [
        {
          id: "notif-3",
          data: () => ({
            type: "comment",
            senderUserId: "actor-3",
            senderName: "Actor Three",
            senderProfilePic: "https://example.com/actor-3.jpg",
            message: "commented on your post",
            timestamp: 3_000,
            read: false,
            postId: "post-3"
          })
        }
      ]
    }));
    const db = {
      collection: (name: string) => {
        if (name !== "users") throw new Error(`unexpected_collection:${name}`);
        return {
          doc: (_viewerId: string) => ({
            collection: (sub: string) => {
              if (sub !== "notifications") throw new Error(`unexpected_subcollection:${sub}`);
              const query = {
                orderBy: () => query,
                select: () => query,
                limit: () => query,
                startAfter: () => query,
                get: pageGet
              };
              return query;
            }
          })
        };
      }
    };

    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(db as never);
    vi.spyOn(globalCache, "get").mockImplementation(async () => undefined);
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);

    const repository = await makeRepository();
    await withRequestContext(async () => {
      const page = await repository.listNotifications({
        viewerId: "viewer-1",
        cursor: null,
        limit: 10
      });
      expect(page.unreadCount).toBeNull();
      expect(page.degraded).toBe(true);
      expect(page.fallbacks).toContain("notifications_unread_count_staged");
      const ctx = getRequestContext();
      expect(ctx?.dbOps.queries).toBe(1);
      expect(ctx?.dbOps.reads).toBe(1);
    });
  });

  it("creates old-shape comment notifications in seeded test mode", async () => {
    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(null as never);
    vi.spyOn(globalCache, "get").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);

    const repository = await makeRepository();
    const result = await repository.createFromMutation({
      type: "comment",
      actorId: "actor-1",
      recipientUserId: "viewer-1",
      targetId: "post-1",
      commentId: "comment-1",
      metadata: {
        commentText: "hello there",
        postTitle: "Post title",
      },
    });

    expect(result.created).toBe(true);
    expect(result.viewerId).toBe("viewer-1");
    expect(result.notificationData).toEqual(
      expect.objectContaining({
        senderUserId: "actor-1",
        type: "comment",
        postId: "post-1",
        commentId: "comment-1",
        message: "commented on your post.",
        read: false,
        priority: "medium",
        metadata: expect.objectContaining({
          commentText: "hello there",
          postTitle: "Post title",
        }),
      }),
    );
  });

  it("skips self notifications in legacy creation path", async () => {
    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(null as never);
    vi.spyOn(globalCache, "get").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);

    const repository = await makeRepository();
    const result = await repository.createFromMutation({
      type: "follow",
      actorId: "viewer-1",
      recipientUserId: "viewer-1",
      targetId: "viewer-1",
    });

    expect(result.created).toBe(false);
    expect(result.notificationId).toBeNull();
    expect(result.viewerId).toBeNull();
  });
});
