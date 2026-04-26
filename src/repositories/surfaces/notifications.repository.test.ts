import { afterEach, describe, expect, it, vi } from "vitest";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import * as firestoreClient from "../source-of-truth/firestore-client.js";
import { NotificationsRepository } from "./notifications.repository.js";

describe("notifications repository markRead", () => {
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

    const repository = new NotificationsRepository();
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
});
