import { afterEach, describe, expect, it, vi } from "vitest";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import * as firestoreClient from "./firestore-client.js";
import { CollectionsFirestoreAdapter } from "./collections-firestore.adapter.js";

type StoredCollectionIndexRecord = {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  privacy: "private" | "friends" | "public";
  collaborators: string[];
  items: string[];
  itemsCount: number;
  createdAt: string;
  updatedAt: string;
  lastContentActivityAtMs?: number;
  kind: "backend";
};

function buildIndexedCollection(id: string, overrides: Partial<StoredCollectionIndexRecord> = {}): StoredCollectionIndexRecord {
  const nowIso = "2026-04-25T00:00:00.000Z";
  return {
    id,
    ownerId: "viewer-1",
    name: `Collection ${id}`,
    description: "",
    privacy: "private",
    collaborators: ["viewer-1"],
    items: [],
    itemsCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastContentActivityAtMs: 1,
    kind: "backend",
    ...overrides
  };
}

function buildQueryDoc(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
  };
}

describe("collections firestore adapter stale index handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes indexed list rows when embedded collection ids no longer exist", async () => {
    const indexed = [
      buildIndexedCollection("stale-collection"),
      buildIndexedCollection("live-collection", { name: "Live Collection", lastContentActivityAtMs: 2 })
    ];
    const userSet = vi.fn(async () => undefined);
    const db = {
      getAll: vi.fn(async (...refs: Array<{ id: string }>) =>
        refs.map((ref) => ({
          exists: ref.id !== "stale-collection",
        }))
      ),
      collection: (name: string) => {
        if (name === "users") {
          return {
            doc: (_viewerId: string) => ({
              get: async () => ({
                exists: true,
                data: () => ({
                  collectionsV2Index: indexed,
                }),
              }),
              set: userSet,
            })
          };
        }
        if (name === "collections") {
          return {
            doc: (collectionId: string) => ({ id: collectionId }),
            where: (_field: string, _op: string, _value: string) => ({
              select: (..._fields: string[]) => ({
                limit: (_limit: number) => ({
                  get: async () => ({
                    docs: [
                      buildQueryDoc("live-collection", {
                        ownerId: "viewer-1",
                        userId: "viewer-1",
                        name: "Live Collection",
                        description: "",
                        privacy: "private",
                        collaborators: ["viewer-1"],
                        items: [],
                        itemsCount: 0,
                        createdAt: "2026-04-25T00:00:00.000Z",
                        updatedAt: "2026-04-25T00:00:00.000Z",
                        lastContentActivityAtMs: 2,
                      })
                    ],
                  })
                })
              })
            })
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      }
    };

    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(db as never);
    vi.spyOn(globalCache, "get").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "del").mockResolvedValue(undefined);

    const adapter = new CollectionsFirestoreAdapter();
    const items = await adapter.listViewerCollections({ viewerId: "viewer-1", limit: 10 });

    expect(items.map((row) => row.id)).toEqual(["live-collection"]);
    expect(db.getAll).toHaveBeenCalledTimes(1);
    expect(userSet).toHaveBeenCalled();
  });

  it("trusts a freshly indexed collections list without revalidating every id", async () => {
    const indexed = [
      buildIndexedCollection("fresh-collection", { lastContentActivityAtMs: 2 })
    ];
    const cachedUserDoc = {
      collectionsV2Index: indexed,
      collectionsV2IndexedAtMs: Date.now(),
    };
    const db = {
      getAll: vi.fn(),
      collection: (name: string) => {
        if (name === "users") {
          return {
            doc: (_viewerId: string) => ({
              get: async () => ({
                exists: true,
                data: () => cachedUserDoc,
              }),
              set: vi.fn(async () => undefined),
            })
          };
        }
        if (name === "collections") {
          return {
            doc: (collectionId: string) => ({ id: collectionId }),
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      }
    };

    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(db as never);
    vi.spyOn(globalCache, "get").mockImplementation(async (key: string) => {
      if (key === entityCacheKeys.userFirestoreDoc("viewer-1")) return cachedUserDoc;
      return undefined;
    });
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "del").mockResolvedValue(undefined);

    const adapter = new CollectionsFirestoreAdapter();
    const items = await adapter.listViewerCollections({ viewerId: "viewer-1", limit: 10 });

    expect(items.map((row) => row.id)).toEqual(["fresh-collection"]);
    expect(db.getAll).not.toHaveBeenCalled();
  });

  it("returns null for an indexed collection whose canonical doc has been deleted", async () => {
    const indexed = [buildIndexedCollection("stale-collection")];
    const userSet = vi.fn(async () => undefined);
    const db = {
      collection: (name: string) => {
        if (name === "users") {
          return {
            doc: (_viewerId: string) => ({
              get: async () => ({
                exists: true,
                data: () => ({
                  collectionsV2Index: indexed,
                }),
              }),
              set: userSet,
            })
          };
        }
        if (name === "collections") {
          return {
            doc: (_collectionId: string) => ({
              get: async () => ({ exists: false })
            })
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      }
    };

    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(db as never);
    vi.spyOn(globalCache, "get").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "del").mockResolvedValue(undefined);

    const adapter = new CollectionsFirestoreAdapter();
    const item = await adapter.getCollection({ viewerId: "viewer-1", collectionId: "stale-collection" });

    expect(item).toBeNull();
    expect(userSet).toHaveBeenCalled();
  });

  it("trusts a freshly indexed collection detail without forcing a collection doc read", async () => {
    const indexed = [buildIndexedCollection("fresh-collection", { lastContentActivityAtMs: 2 })];
    const cachedUserDoc = {
      collectionsV2Index: indexed,
      collectionsV2IndexedAtMs: Date.now(),
    };
    const getDoc = vi.fn(async () => ({
      exists: true,
      data: () => ({
        ownerId: "viewer-1",
        userId: "viewer-1",
        name: "Fresh Collection",
        description: "",
        privacy: "private",
        collaborators: ["viewer-1"],
        items: [],
        itemsCount: 0,
        createdAt: "2026-04-25T00:00:00.000Z",
        updatedAt: "2026-04-25T00:00:00.000Z",
        lastContentActivityAtMs: 2,
      }),
    }));
    const db = {
      collection: (name: string) => {
        if (name === "users") {
          return {
            doc: (_viewerId: string) => ({
              get: async () => ({
                exists: true,
                data: () => cachedUserDoc,
              }),
              set: vi.fn(async () => undefined),
            })
          };
        }
        if (name === "collections") {
          return {
            doc: (_collectionId: string) => ({
              get: getDoc
            })
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      }
    };

    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(db as never);
    vi.spyOn(globalCache, "get").mockImplementation(async (key: string) => {
      if (key === entityCacheKeys.userFirestoreDoc("viewer-1")) return cachedUserDoc;
      return undefined;
    });
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "del").mockResolvedValue(undefined);

    const adapter = new CollectionsFirestoreAdapter();
    const item = await adapter.getCollection({ viewerId: "viewer-1", collectionId: "fresh-collection" });

    expect(item?.id).toBe("fresh-collection");
    expect(getDoc).not.toHaveBeenCalled();
  });
});
