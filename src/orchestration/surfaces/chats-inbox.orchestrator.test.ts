import { beforeEach, describe, expect, it, vi } from "vitest";

const syncViewerIntoLinkedGroupChats = vi.fn(async () => undefined);

vi.mock("../../repositories/surfaces/groups.repository.js", () => ({
  groupsRepository: {
    syncViewerIntoLinkedGroupChats: (...args: unknown[]) => syncViewerIntoLinkedGroupChats(...args),
  },
}));

import { globalCache } from "../../cache/global-cache.js";
import { buildCacheKey } from "../../cache/types.js";
import { ChatsInboxOrchestrator } from "./chats-inbox.orchestrator.js";

describe("ChatsInboxOrchestrator cache-first group sync", () => {
  const cachedResponse = {
    routeName: "chats.inbox.get" as const,
    requestKey: "viewer-1:start:10",
    page: {
      cursorIn: null,
      limit: 10,
      count: 0,
      hasMore: false,
      nextCursor: null,
      sort: "last_message_desc" as const,
    },
    items: [],
    unread: { totalConversationsUnread: 0 },
    degraded: false,
    fallbacks: [],
  };

  beforeEach(async () => {
    syncViewerIntoLinkedGroupChats.mockClear();
    const key = buildCacheKey("list", ["chats-inbox-v1", "viewer-1", "start", "10"]);
    await globalCache.del(key);
  });

  it("returns cache hit without group sync", async () => {
    const key = buildCacheKey("list", ["chats-inbox-v1", "viewer-1", "start", "10"]);
    await globalCache.set(key, cachedResponse, 60_000);
    const loadInboxPage = vi.fn();
    const orchestrator = new ChatsInboxOrchestrator({ loadInboxPage } as never);

    const prevVitest = process.env.VITEST;
    process.env.VITEST = "false";
    try {
      const result = await orchestrator.run({ viewerId: "viewer-1", cursor: null, limit: 10 });
      expect(result).toEqual(cachedResponse);
      expect(syncViewerIntoLinkedGroupChats).not.toHaveBeenCalled();
      expect(loadInboxPage).not.toHaveBeenCalled();
    } finally {
      process.env.VITEST = prevVitest;
    }
  });

  it("runs group sync on cold miss outside Vitest", async () => {
    const loadInboxPage = vi.fn(async () => ({
      items: [],
      hasMore: false,
      nextCursor: null,
      totalConversationsUnread: 0,
    }));
    const orchestrator = new ChatsInboxOrchestrator({ loadInboxPage } as never);

    const prevVitest = process.env.VITEST;
    process.env.VITEST = "false";
    try {
      await orchestrator.run({ viewerId: "viewer-1", cursor: null, limit: 10 });
      expect(syncViewerIntoLinkedGroupChats).toHaveBeenCalledWith("viewer-1");
      expect(loadInboxPage).toHaveBeenCalledTimes(1);
    } finally {
      process.env.VITEST = prevVitest;
    }
  });
});
