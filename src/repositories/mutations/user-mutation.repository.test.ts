import { afterEach, describe, expect, it, vi } from "vitest";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import * as firestoreClient from "../source-of-truth/firestore-client.js";
import { UserMutationRepository } from "./user-mutation.repository.js";

describe("user mutation repository cache invalidation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("preserves collections index fields when clearing follow caches", async () => {
    vi.stubEnv("FIRESTORE_TEST_MODE", "disabled");
    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(null);
    const setSpy = vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    const delSpy = vi.spyOn(globalCache, "del").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "get").mockImplementation(async (key: string) => {
      if (key === entityCacheKeys.userFirestoreDoc("viewer-1")) {
        return {
          displayName: "Viewer",
          collectionsV2Index: [{ id: "saved-viewer-1", ownerId: "viewer-1", name: "Saved" }],
          collectionsV2IndexedAtMs: 12345
        };
      }
      if (key === entityCacheKeys.userFirestoreDoc("user-2")) {
        return { displayName: "Target" };
      }
      return undefined;
    });

    const repository = new UserMutationRepository();
    await (repository as any).clearFollowCaches("viewer-1", "user-2");

    expect(setSpy).toHaveBeenCalledWith(
      entityCacheKeys.userFirestoreDoc("viewer-1"),
      {
        collectionsV2Index: [{ id: "saved-viewer-1", ownerId: "viewer-1", name: "Saved" }],
        collectionsV2IndexedAtMs: 12345
      },
      25_000
    );
    expect(delSpy).toHaveBeenCalledWith(entityCacheKeys.userFirestoreDoc("user-2"));
    expect(delSpy).not.toHaveBeenCalledWith(entityCacheKeys.userFirestoreDoc("viewer-1"));
  });
});
