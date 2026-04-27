import { afterEach, describe, expect, it, vi } from "vitest";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { ChatsRepository } from "./chats.repository.js";

const { mockState } = vi.hoisted(() => ({ mockState: { db: null as unknown } }));

vi.mock("../source-of-truth/firestore-client.js", () => ({
  getFirestoreSourceClient: () => mockState.db
}));

function makeDocRef(id: string) {
  return { id };
}

describe("chats repository direct conversation creation", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    vi.restoreAllMocks();
    mockState.db = null;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("creates a direct conversation without pre-reading the pair doc", async () => {
    const pairGet = vi.fn(async () => ({ exists: false, data: () => undefined }));
    const commit = vi.fn(async () => undefined);
    const batchCreate = vi.fn();
    const db = {
      batch: () => ({
        create: batchCreate,
        commit
      }),
      collection: (name: string) => {
        if (name === "chat_direct_pairs") {
          return {
            doc: (id: string) => ({
              id,
              get: pairGet
            })
          };
        }
        if (name === "chats") {
          return {
            doc: () => makeDocRef("chat-new-1")
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      }
    };

    mockState.db = db;
    process.env.NODE_ENV = "development";
    vi.spyOn(globalCache, "get").mockResolvedValue(undefined);
    const setSpy = vi.spyOn(globalCache, "set").mockResolvedValue(undefined);

    const repository = new ChatsRepository();
    const result = await repository.createOrGetDirectConversation({
      viewerId: "viewer-1",
      otherUserId: "viewer-2"
    });

    expect(result).toEqual({ conversationId: "chat-new-1", created: true });
    expect(pairGet).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(batchCreate).toHaveBeenCalledTimes(2);
    expect(setSpy).toHaveBeenCalledWith(
      entityCacheKeys.chatDirectConversation("viewer-1:viewer-2"),
      "chat-new-1",
      60_000
    );
  });

  it("falls back to the canonical pair doc after an already-exists race", async () => {
    const pairGet = vi.fn(async () => ({
      exists: true,
      data: () => ({ conversationId: "chat-existing-1" })
    }));
    const db = {
      batch: () => ({
        create: vi.fn(),
        commit: vi.fn(async () => {
          throw new Error("ALREADY_EXISTS");
        })
      }),
      collection: (name: string) => {
        if (name === "chat_direct_pairs") {
          return {
            doc: (id: string) => ({
              id,
              get: pairGet
            })
          };
        }
        if (name === "chats") {
          return {
            doc: () => makeDocRef("chat-raced-1")
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      }
    };

    mockState.db = db;
    process.env.NODE_ENV = "development";
    vi.spyOn(globalCache, "get").mockResolvedValue(undefined);
    const setSpy = vi.spyOn(globalCache, "set").mockResolvedValue(undefined);

    const repository = new ChatsRepository();
    const result = await repository.createOrGetDirectConversation({
      viewerId: "viewer-1",
      otherUserId: "viewer-2"
    });

    expect(result).toEqual({ conversationId: "chat-existing-1", created: false });
    expect(pairGet).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(
      entityCacheKeys.chatDirectConversation("viewer-1:viewer-2"),
      "chat-existing-1",
      60_000
    );
  });
});

describe("chats repository inbox (non-seeded)", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    vi.restoreAllMocks();
    mockState.db = null;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("hydrates direct chat title from user doc (not generic)", async () => {
    process.env.NODE_ENV = "development";
    vi.spyOn(globalCache, "get").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);

    const viewerId = "viewer-1";
    const otherUserId = "user-2";

    const chatDoc = {
      id: "conv-1",
      data: () => ({
        participants: [viewerId, otherUserId],
        manualUnreadBy: [],
        lastMessage: {
          type: "message",
          content: "Hello",
          senderId: otherUserId,
          timestamp: { toMillis: () => Date.now() },
          seenBy: []
        },
        lastMessageTime: { toMillis: () => Date.now() },
        createdAt: { toMillis: () => Date.now() }
      })
    };

    const query = {
      where: () => query,
      orderBy: () => query,
      select: () => query,
      limit: () => query,
      startAfter: () => query,
      get: vi.fn(async () => ({ docs: [chatDoc] }))
    };

    const userDocRef = (id: string) => ({ id, __type: "userDocRef" });
    const db = {
      collection: (name: string) => {
        if (name === "chats") return query;
        if (name === "users") {
          return {
            doc: (id: string) => userDocRef(id)
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      },
      getAll: vi.fn(async (...refs: Array<{ id: string }>) => {
        return refs.map((ref) => ({
          exists: true,
          id: ref.id,
          data: () => ({ handle: "@alice", name: "Alice", profilePic: "https://example.com/pic.jpg" })
        }));
      })
    };

    mockState.db = db;
    const repository = new ChatsRepository();
    const result = await repository.listInbox({ viewerId, cursor: null, limit: 10 });

    expect(result.items.length).toBe(1);
    expect(result.items[0]?.title).toBe("Alice");
    expect(result.items[0]?.participantPreview?.[0]?.name).toBe("Alice");
    expect(db.getAll).toHaveBeenCalledTimes(1);
  });
});
