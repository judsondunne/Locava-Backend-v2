import { afterEach, describe, expect, it, vi } from "vitest";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import * as firestoreClient from "./firestore-client.js";
import { AuthBootstrapFirestoreAdapter } from "./auth-bootstrap-firestore.adapter.js";

describe("auth bootstrap firestore adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    AuthBootstrapFirestoreAdapter.resetCachesForTests();
  });

  it("seeds the cached user firestore doc with verified post-count fields from auth bootstrap", async () => {
    const getAll = vi.fn(async (...args: unknown[]) => {
      const [, options] = args as [unknown, { fieldMask?: string[] }];
      expect(options.fieldMask).toContain("postCountVerifiedValue");
      return [
        {
          exists: true,
          data: () => ({
            handle: "verified_user",
            badge: "gold",
            unreadCount: 3,
            postCount: 479,
            postCountVerifiedAtMs: 1_713_000_000_000,
            postCountVerifiedValue: 479
          })
        }
      ];
    });
    const db = {
      getAll,
      collection: (name: string) => {
        if (name !== "users") throw new Error(`unexpected_collection:${name}`);
        return {
          doc: (id: string) => ({
            id,
            collection: (_sub: string) => ({
              doc: (_docId: string) => ({
                get: async () => ({ exists: false, data: () => ({}) })
              })
            })
          })
        };
      }
    };

    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(db as never);
    const setSpy = vi.spyOn(globalCache, "set").mockResolvedValue(undefined);

    const adapter = new AuthBootstrapFirestoreAdapter();
    const result = await adapter.getViewerBootstrapFields("viewer-verified");

    expect(result.data.handle).toBe("verified_user");
    expect(setSpy).toHaveBeenCalledWith(
      entityCacheKeys.userFirestoreDoc("viewer-verified"),
      expect.objectContaining({
        postCount: 479,
        postCountVerifiedAtMs: 1_713_000_000_000,
        postCountVerifiedValue: 479
      }),
      300_000
    );
  });
});
