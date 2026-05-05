import { afterEach, describe, expect, it, vi } from "vitest";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { resetBackgroundWorkForTests } from "../../lib/background-work.js";
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
    resetBackgroundWorkForTests();
  });

  it("refreshes indexed list rows when embedded collection ids no longer exist", async () => {
    const indexed = [
      buildIndexedCollection("stale-collection"),
      buildIndexedCollection("live-collection", { name: "Live Collection", lastContentActivityAtMs: 2 })
    ];
    const userSet = vi.fn(async () => undefined);
    const db = {
      getAll: vi.fn(async (...refs: Array<{ id: string }>) =>
        refs.map((ref) =>
          ref.id === "viewer-1"
            ? {
                exists: true,
                data: () => ({
                  collectionsV2Index: indexed
                })
              }
            : {
                exists: ref.id !== "stale-collection",
                data: () => ({})
              }
        )
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

  it("drops legacy stable system mix rows (mix_${owner}_*) from embedded viewer index reads", async () => {
    const indexed = [
      buildIndexedCollection("mix_viewer-1_friends", { name: "Friends Mix", lastContentActivityAtMs: 99 }),
      buildIndexedCollection("real-collection", { lastContentActivityAtMs: 2 }),
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
            }),
          };
        }
        if (name === "collections") {
          return {
            doc: (_collectionId: string) => ({
              get: async () => ({ exists: false }),
            }),
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      },
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

    expect(items.map((row) => row.id)).toEqual(["real-collection"]);
  });

  it("returns null for an indexed collection whose canonical doc has been deleted", async () => {
    const indexed = [buildIndexedCollection("stale-collection")];
    const userSet = vi.fn(async () => undefined);
    const db = {
      getAll: vi.fn(async (...refs: Array<{ id: string }>) =>
        refs.map((ref) =>
          ref.id === "viewer-1"
            ? {
                exists: true,
                data: () => ({
                  collectionsV2Index: indexed
                })
              }
            : {
                exists: false,
                data: () => ({})
              }
        )
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

describe("collections firestore adapter normalization and mutations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetBackgroundWorkForTests();
  });

  it("rebuilds collaborator snapshots from users and preserves old valid https collection fields", async () => {
    const collectionUpdate = vi.fn(async () => undefined);
    const userDocs: Record<string, Record<string, unknown>> = {
      owner_1234567890123456: {
        name: "Owner Name",
        handle: "@owner_handle",
        photoURL: "https://cdn.locava.test/users/owner.jpg",
      },
      collab_12345678901234: {
        displayName: "Collab Name",
        handle: "collab_handle",
        profilePicLargePath: "https://cdn.locava.test/users/collab.jpg",
      },
    };
    const db = {
      collection: (name: string) => {
        if (name === "collections") {
          return {
            doc: (_collectionId: string) => ({
              get: async () => ({
                exists: true,
                data: () => ({
                  ownerId: "owner_1234567890123456",
                  displayPhotoUrl: "https://s3.wasabisys.com/locava/collections/cover.jpg",
                  isPublic: "true",
                  collaborators: ["collab_12345678901234"],
                  collaboratorInfo: [{ id: "owner_1234567890123456" }],
                  items: ["post-1"],
                  itemsCount: 1,
                  createdAt: "2026-05-01T00:00:00.000Z",
                  updatedAt: "2026-05-01T00:00:00.000Z",
                }),
              }),
              update: collectionUpdate,
            }),
          };
        }
        if (name === "users") {
          return {
            doc: (userId: string) => ({
              get: async () => ({
                exists: Boolean(userDocs[userId]),
                id: userId,
                data: () => userDocs[userId] ?? {},
              }),
              set: vi.fn(async () => undefined),
            }),
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      },
    };

    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(db as never);
    vi.spyOn(globalCache, "get").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "del").mockResolvedValue(undefined);

    const adapter = new CollectionsFirestoreAdapter();
    const item = await adapter.getCollection(
      { viewerId: "owner_1234567890123456", collectionId: "collection-1" },
      { fresh: true, rebuildCollaboratorInfo: true }
    );

    expect(item).toBeTruthy();
    expect(item?.privacy).toBe("public");
    expect(item?.isPublic).toBe(true);
    expect(item?.displayPhotoUrl).toBe("https://s3.wasabisys.com/locava/collections/cover.jpg");
    expect(item?.userId).toBe("owner_1234567890123456");
    expect(item?.mediaCount).toBe(1);
    expect(item?.tags).toEqual([]);
    expect(item?.openedAtByUserId).toEqual({});
    expect(item?.collaborators).toEqual(["collab_12345678901234"]);
    expect(item?.collaboratorInfo).toEqual([
      {
        id: "owner_1234567890123456",
        name: "Owner Name",
        handle: "owner_handle",
        profilePic: "https://cdn.locava.test/users/owner.jpg",
      },
      {
        id: "collab_12345678901234",
        name: "Collab Name",
        handle: "collab_handle",
        profilePic: "https://cdn.locava.test/users/collab.jpg",
      },
    ]);
    expect(collectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        collaborators: ["collab_12345678901234"],
        userId: "owner_1234567890123456",
        tags: [],
        openedAtByUserId: {},
      })
    );
  });

  it("normalizes string false privacy and missing optional fields without crashing", async () => {
    const db = {
      collection: (name: string) => {
        if (name === "collections") {
          return {
            doc: (_collectionId: string) => ({
              get: async () => ({
                exists: true,
                data: () => ({
                  ownerId: "owner_1234567890123456",
                  isPublic: "false",
                  displayPhotoUrl: "https://s3.wasabisys.com/locava/collections/cover.jpg",
                  collaborators: [],
                  items: [],
                  itemsCount: 0,
                  createdAt: "2026-05-01T00:00:00.000Z",
                  updatedAt: "2026-05-01T00:00:00.000Z",
                }),
              }),
              update: vi.fn(async () => undefined),
            }),
          };
        }
        if (name === "users") {
          return {
            doc: (userId: string) => ({
              get: async () => ({
                exists: true,
                id: userId,
                data: () => ({
                  name: "Owner Name",
                  handle: "owner_handle",
                  photoURL: "https://cdn.locava.test/users/owner.jpg",
                }),
              }),
              set: vi.fn(async () => undefined),
            }),
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      },
    };

    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(db as never);
    vi.spyOn(globalCache, "get").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "del").mockResolvedValue(undefined);

    const adapter = new CollectionsFirestoreAdapter();
    const item = await adapter.getCollection(
      { viewerId: "owner_1234567890123456", collectionId: "collection-2" },
      { fresh: true, rebuildCollaboratorInfo: true }
    );

    expect(item?.privacy).toBe("private");
    expect(item?.isPublic).toBe(false);
    expect(item?.tags).toEqual([]);
    expect(item?.openedAtByUserId).toEqual({});
    expect(item?.displayPhotoUrl).toBe("https://s3.wasabisys.com/locava/collections/cover.jpg");
  });

  it("adds collaborators with normalized collaboratorInfo and excludes the owner from collaborators", async () => {
    const collectionUpdate = vi.fn(async () => undefined);
    const ownerCollection = {
      id: "collection-3",
      ownerId: "owner_1234567890123456",
      userId: "owner_1234567890123456",
      name: "Shared Spots",
      privacy: "private" as const,
      collaborators: [],
      collaboratorInfo: [],
      items: [],
      itemsCount: 0,
      mediaCount: 0,
      tags: [],
      openedAtByUserId: {},
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      permissions: {
        isOwner: true,
        isCollaborator: false,
        canEdit: true,
        canDelete: true,
        canManageCollaborators: true,
      },
      kind: "backend" as const,
    };
    const userDocs: Record<string, Record<string, unknown>> = {
      owner_1234567890123456: {
        name: "Owner Name",
        handle: "owner_handle",
        photoURL: "https://cdn.locava.test/users/owner.jpg",
      },
      collab_12345678901234: {
        name: "Collab Name",
        handle: "@collab_handle",
        profilePic: "https://cdn.locava.test/users/collab.jpg",
      },
    };
    const db = {
      collection: (name: string) => {
        if (name === "collections") {
          return {
            doc: (_collectionId: string) => ({
              update: collectionUpdate,
            }),
          };
        }
        if (name === "users") {
          return {
            doc: (userId: string) => ({
              get: async () => ({
                exists: Boolean(userDocs[userId]),
                id: userId,
                data: () => userDocs[userId] ?? {},
              }),
              set: vi.fn(async () => undefined),
            }),
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      },
    };

    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(db as never);
    vi.spyOn(globalCache, "get").mockImplementation(async (key: string) => {
      if (key === "collection:collection-3:viewer:owner_1234567890123456") {
        return ownerCollection;
      }
      return undefined;
    });
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "del").mockResolvedValue(undefined);

    const adapter = new CollectionsFirestoreAdapter();
    const result = await adapter.addCollaboratorToCollection({
      viewerId: "owner_1234567890123456",
      collectionId: "collection-3",
      collaboratorId: "collab_12345678901234",
    });

    expect(result.changed).toBe(true);
    expect(result.collection?.collaborators).toEqual(["collab_12345678901234"]);
    expect(result.collection?.collaboratorInfo).toEqual([
      {
        id: "owner_1234567890123456",
        name: "Owner Name",
        handle: "owner_handle",
        profilePic: "https://cdn.locava.test/users/owner.jpg",
      },
      {
        id: "collab_12345678901234",
        name: "Collab Name",
        handle: "collab_handle",
        profilePic: "https://cdn.locava.test/users/collab.jpg",
      },
    ]);
    expect(collectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        collaborators: ["collab_12345678901234"],
      })
    );
  });

  it("adds and removes posts while updating counts and last-content activity fields", async () => {
    const update = vi.fn(async () => undefined);
    const db = {
      collection: (name: string) => {
        if (name === "collections") {
          return {
            doc: (_collectionId: string) => ({
              update,
            }),
          };
        }
        if (name === "users") {
          return {
            doc: () => ({
              set: vi.fn(async () => undefined),
            }),
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      },
    };

    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(db as never);
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "del").mockResolvedValue(undefined);

    const adapter = new CollectionsFirestoreAdapter();
    vi.spyOn(globalCache, "get").mockImplementation(async (key: string) => {
      if (key === "collection:collection-4:viewer:owner_1234567890123456") {
        return {
          id: "collection-4",
          ownerId: "owner_1234567890123456",
          userId: "owner_1234567890123456",
          name: "Atomic Posts",
          privacy: "private",
          collaborators: [],
          collaboratorInfo: [],
          items: [],
          itemsCount: 0,
          mediaCount: 0,
          tags: [],
          openedAtByUserId: {},
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
          permissions: {
            isOwner: true,
            isCollaborator: false,
            canEdit: true,
            canDelete: true,
            canManageCollaborators: true,
          },
          kind: "backend",
        };
      }
      if (key === "collection:collection-5:viewer:owner_1234567890123456") {
        return {
          id: "collection-5",
          ownerId: "owner_1234567890123456",
          userId: "owner_1234567890123456",
          name: "Atomic Posts",
          privacy: "private",
          collaborators: [],
          collaboratorInfo: [],
          items: ["post-1"],
          itemsCount: 1,
          mediaCount: 1,
          tags: [],
          openedAtByUserId: {},
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
          permissions: {
            isOwner: true,
            isCollaborator: false,
            canEdit: true,
            canDelete: true,
            canManageCollaborators: true,
          },
          kind: "backend",
        };
      }
      return undefined;
    });

    const added = await adapter.addPostToCollection({
      viewerId: "owner_1234567890123456",
      collectionId: "collection-4",
      postId: "post-1",
    });
    expect(added.changed).toBe(true);
    expect(added.collection?.items).toEqual(["post-1"]);
    expect(added.collection?.itemsCount).toBe(1);
    expect(added.collection?.mediaCount).toBe(1);
    expect(added.collection?.lastContentActivityByUserId).toBe("owner_1234567890123456");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        itemsCount: 1,
        mediaCount: 1,
        lastContentActivityByUserId: "owner_1234567890123456",
      })
    );

    const duplicate = await adapter.addPostToCollection({
      viewerId: "owner_1234567890123456",
      collectionId: "collection-5",
      postId: "post-1",
    });
    expect(duplicate.changed).toBe(false);
    expect(duplicate.collection?.itemsCount).toBe(1);

    const removed = await adapter.removePostFromCollection({
      viewerId: "owner_1234567890123456",
      collectionId: "collection-5",
      postId: "post-1",
    });
    expect(removed.changed).toBe(true);
    expect(removed.collection?.items).toEqual([]);
    expect(removed.collection?.itemsCount).toBe(0);
    expect(removed.collection?.mediaCount).toBe(0);
    expect(removed.collection?.lastContentActivityByUserId).toBe("owner_1234567890123456");
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: [],
        itemsCount: 0,
        mediaCount: 0,
        lastContentActivityByUserId: "owner_1234567890123456",
      })
    );
  });
});
