import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 chats inbox routes", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const viewerHeaders = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal"
  };

  it("lists inbox with cursor pagination and lean payload", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/v2/chats/inbox?limit=10",
      headers: viewerHeaders
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json().data;
    expect(firstBody.routeName).toBe("chats.inbox.get");
    expect(firstBody.page.count).toBe(10);
    expect(firstBody.page.cursorIn).toBeNull();
    expect(typeof firstBody.page.nextCursor).toBe("string");
    expect(firstBody.items[0].conversationId).toBeTypeOf("string");
    expect(firstBody.items[0].lastMessagePreview).toBeTypeOf("string");
    expect(firstBody.items[0].participantPreview.length).toBeLessThanOrEqual(3);
    expect(firstBody.items[0].messages).toBeUndefined();

    const second = await app.inject({
      method: "GET",
      url: `/v2/chats/inbox?limit=10&cursor=${encodeURIComponent(firstBody.page.nextCursor)}`,
      headers: viewerHeaders
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json().data;
    expect(secondBody.page.cursorIn).toBe(firstBody.page.nextCursor);
    expect(secondBody.items.length).toBe(10);
    expect(secondBody.items[0].conversationId).not.toBe(firstBody.items[0].conversationId);
  });

  it("uses one query for cold page and near-zero reads on repeated same request", async () => {
    const url = "/v2/chats/inbox?limit=15";
    await app.inject({ method: "GET", url, headers: viewerHeaders });
    await app.inject({ method: "GET", url, headers: viewerHeaders });
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=70" });
    const rows = diagnostics
      .json()
      .data.recentRequests.filter((r: { routeName?: string }) => r.routeName === "chats.inbox.get");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const latest = rows[0];
    const previous = rows[1];
    expect(previous.dbOps.queries).toBe(1);
    expect(latest.dbOps.queries).toBe(0);
    expect(latest.dbOps.reads).toBe(0);
    expect(latest.budgetViolations).toEqual([]);
  });

  it("marks conversation read idempotently", async () => {
    const inbox = await app.inject({ method: "GET", url: "/v2/chats/inbox?limit=20", headers: viewerHeaders });
    const target = (inbox.json().data.items as Array<{ conversationId: string; unreadCount: number }>).find(
      (row) => row.unreadCount > 0
    );
    expect(target).toBeTruthy();
    const first = await app.inject({
      method: "POST",
      url: `/v2/chats/${encodeURIComponent(target!.conversationId)}/mark-read`,
      headers: viewerHeaders
    });
    const second = await app.inject({
      method: "POST",
      url: `/v2/chats/${encodeURIComponent(target!.conversationId)}/mark-read`,
      headers: viewerHeaders
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().data.idempotency.replayed).toBe(false);
    expect(second.json().data.idempotency.replayed).toBe(true);
  });

  it("emits diagnostics for chats inbox and mark-read", async () => {
    const inbox = await app.inject({ method: "GET", url: "/v2/chats/inbox?limit=10", headers: viewerHeaders });
    const conversationId = inbox.json().data.items[0].conversationId as string;
    await app.inject({
      method: "POST",
      url: `/v2/chats/${encodeURIComponent(conversationId)}/mark-read`,
      headers: viewerHeaders
    });
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=90" });
    const rows = diagnostics.json().data.recentRequests as Array<{
      routeName?: string;
      routePolicy?: { routeName: string };
      dedupe?: { hits: number; misses: number };
      concurrency?: { waits: number };
      invalidation?: { keys: number };
      budgetViolations?: string[];
    }>;
    const inboxRow = rows.find((r) => r.routeName === "chats.inbox.get");
    const markRow = rows.find((r) => r.routeName === "chats.markread.post");
    expect(inboxRow?.routePolicy?.routeName).toBe("chats.inbox.get");
    expect(markRow?.routePolicy?.routeName).toBe("chats.markread.post");
    expect(typeof inboxRow?.dedupe?.hits).toBe("number");
    expect(typeof inboxRow?.dedupe?.misses).toBe("number");
    expect(typeof inboxRow?.concurrency?.waits).toBe("number");
    expect((markRow?.invalidation?.keys ?? 0) > 0).toBe(true);
    expect(inboxRow?.budgetViolations).toEqual([]);
    expect(markRow?.budgetViolations).toEqual([]);
  });

  it("reads thread messages with cursor pagination and lean payload", async () => {
    const inbox = await app.inject({ method: "GET", url: "/v2/chats/inbox?limit=10", headers: viewerHeaders });
    const conversationId = inbox.json().data.items[0].conversationId as string;
    const first = await app.inject({
      method: "GET",
      url: `/v2/chats/${encodeURIComponent(conversationId)}/messages?limit=20`,
      headers: viewerHeaders
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json().data;
    expect(firstBody.page.order).toBe("created_desc");
    expect(firstBody.page.cursorIn).toBe("start");
    expect(firstBody.items.length).toBe(20);
    expect(firstBody.items[0].conversationId).toBe(conversationId);
    expect(firstBody.items[0].sender).toBeTruthy();
    expect(firstBody.items[0].senderId).toBeTypeOf("string");
    expect(firstBody.items[0].messageId).toBeTypeOf("string");
    expect(firstBody.items[0].attachments).toBeUndefined();
    expect(firstBody.items[0].reactions).toBeUndefined();

    const second = await app.inject({
      method: "GET",
      url: `/v2/chats/${encodeURIComponent(conversationId)}/messages?limit=20&cursor=${encodeURIComponent(firstBody.page.nextCursor)}`,
      headers: viewerHeaders
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json().data;
    expect(secondBody.page.cursorIn).toBe(firstBody.page.nextCursor);
    expect(secondBody.items.length).toBeGreaterThan(0);
    expect(secondBody.items[0].messageId).not.toBe(firstBody.items[0].messageId);
  });

  it("collapses repeated identical thread request to near-zero reads", async () => {
    const inbox = await app.inject({ method: "GET", url: "/v2/chats/inbox?limit=10", headers: viewerHeaders });
    const conversationId = inbox.json().data.items[0].conversationId as string;
    const url = `/v2/chats/${encodeURIComponent(conversationId)}/messages?limit=25`;
    await app.inject({ method: "GET", url, headers: viewerHeaders });
    await app.inject({ method: "GET", url, headers: viewerHeaders });
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=90" });
    const rows = diagnostics
      .json()
      .data.recentRequests.filter((r: { routeName?: string }) => r.routeName === "chats.thread.get");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const latest = rows[0];
    const previous = rows[1];
    expect(previous.dbOps.queries).toBe(1);
    expect(latest.dbOps.queries).toBe(0);
    expect(latest.dbOps.reads).toBe(0);
    expect(latest.budgetViolations).toEqual([]);
  });

  it("emits diagnostics and policy metadata for chats thread read", async () => {
    const inbox = await app.inject({ method: "GET", url: "/v2/chats/inbox?limit=10", headers: viewerHeaders });
    const conversationId = inbox.json().data.items[0].conversationId as string;
    await app.inject({
      method: "GET",
      url: `/v2/chats/${encodeURIComponent(conversationId)}/messages?limit=15`,
      headers: viewerHeaders
    });
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=90" });
    const rows = diagnostics.json().data.recentRequests as Array<{
      routeName?: string;
      routePolicy?: { routeName: string };
      dedupe?: { hits: number; misses: number };
      concurrency?: { waits: number };
      budgetViolations?: string[];
      dbOps?: { queries: number };
      payloadBytes?: number;
    }>;
    const row = rows.find((r) => r.routeName === "chats.thread.get");
    expect(row?.routePolicy?.routeName).toBe("chats.thread.get");
    expect(typeof row?.dedupe?.hits).toBe("number");
    expect(typeof row?.dedupe?.misses).toBe("number");
    expect(typeof row?.concurrency?.waits).toBe("number");
    expect((row?.dbOps?.queries ?? 0) <= 1).toBe(true);
    expect((row?.payloadBytes ?? 0) <= 28_000).toBe(true);
    expect(row?.budgetViolations).toEqual([]);
  });

  it("sends text message idempotently with clientMessageId", async () => {
    const inbox = await app.inject({ method: "GET", url: "/v2/chats/inbox?limit=10", headers: viewerHeaders });
    const conversationId = inbox.json().data.items[0].conversationId as string;
    const body = { text: "Hello from v2", clientMessageId: "cmid-hello-0001" };
    const first = await app.inject({
      method: "POST",
      url: `/v2/chats/${encodeURIComponent(conversationId)}/messages`,
      headers: { ...viewerHeaders, "content-type": "application/json" },
      payload: body
    });
    const second = await app.inject({
      method: "POST",
      url: `/v2/chats/${encodeURIComponent(conversationId)}/messages`,
      headers: { ...viewerHeaders, "content-type": "application/json" },
      payload: body
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().data.idempotency.replayed).toBe(false);
    expect(second.json().data.idempotency.replayed).toBe(true);
    expect(first.json().data.message.messageId).toBe(second.json().data.message.messageId);
  });

  it("keeps ordering consistent under rapid repeated sends", async () => {
    const inbox = await app.inject({ method: "GET", url: "/v2/chats/inbox?limit=10", headers: viewerHeaders });
    const conversationId = inbox.json().data.items[0].conversationId as string;
    const headers = { ...viewerHeaders, "content-type": "application/json" };
    const sends = await Promise.all(
      ["1", "2", "3", "4"].map((suffix) =>
        app.inject({
          method: "POST",
          url: `/v2/chats/${encodeURIComponent(conversationId)}/messages`,
          headers,
          payload: { text: `Rapid ${suffix}`, clientMessageId: `rapid-${suffix}-cmid` }
        })
      )
    );
    sends.forEach((res) => expect(res.statusCode).toBe(200));
    const thread = await app.inject({
      method: "GET",
      url: `/v2/chats/${encodeURIComponent(conversationId)}/messages?limit=10`,
      headers: viewerHeaders
    });
    const items = thread.json().data.items as Array<{ text: string | null; createdAtMs: number }>;
    const created = items.slice(0, 4).map((m) => m.createdAtMs);
    expect(created[0]! >= created[1]!).toBe(true);
    expect(created[1]! >= created[2]!).toBe(true);
    expect(created[2]! >= created[3]!).toBe(true);
  });

  it("updates inbox preview and emits scoped invalidation for send-text", async () => {
    const inbox = await app.inject({ method: "GET", url: "/v2/chats/inbox?limit=10", headers: viewerHeaders });
    const conversationId = inbox.json().data.items[0].conversationId as string;
    const text = "Inbox preview from send mutation";
    const send = await app.inject({
      method: "POST",
      url: `/v2/chats/${encodeURIComponent(conversationId)}/messages`,
      headers: { ...viewerHeaders, "content-type": "application/json" },
      payload: { text, clientMessageId: "preview-cmid-001" }
    });
    expect(send.statusCode).toBe(200);
    const refreshed = await app.inject({ method: "GET", url: "/v2/chats/inbox?limit=10", headers: viewerHeaders });
    const updatedRow = (refreshed.json().data.items as Array<{ conversationId: string; lastMessagePreview: string }>).find(
      (row) => row.conversationId === conversationId
    );
    expect(updatedRow?.lastMessagePreview).toBe(text);

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=120" });
    const rows = diagnostics.json().data.recentRequests as Array<{
      routeName?: string;
      routePolicy?: { routeName: string };
      invalidation?: { keys: number };
      budgetViolations?: string[];
      dbOps?: { writes: number };
    }>;
    const sendRow = rows.find((r) => r.routeName === "chats.sendtext.post");
    expect(sendRow?.routePolicy?.routeName).toBe("chats.sendtext.post");
    expect((sendRow?.dbOps?.writes ?? 0) <= 2).toBe(true);
    expect((sendRow?.invalidation?.keys ?? 0) > 0).toBe(true);
    expect(sendRow?.budgetViolations).toEqual([]);
  });

  it("invalidates deeper thread and inbox cache pages after send mutation", async () => {
    const inboxFirst = await app.inject({ method: "GET", url: "/v2/chats/inbox?limit=10", headers: viewerHeaders });
    const inboxCursor = inboxFirst.json().data.page.nextCursor as string;
    const inboxDeepUrl = `/v2/chats/inbox?limit=10&cursor=${encodeURIComponent(inboxCursor)}`;
    const inboxDeepCold = await app.inject({ method: "GET", url: inboxDeepUrl, headers: viewerHeaders });
    const inboxDeepWarm = await app.inject({ method: "GET", url: inboxDeepUrl, headers: viewerHeaders });
    expect(inboxDeepCold.statusCode).toBe(200);
    expect(inboxDeepWarm.statusCode).toBe(200);
    expect(inboxDeepWarm.json().meta.db.reads).toBe(0);

    const conversationId = inboxFirst.json().data.items[0].conversationId as string;
    const threadFirst = await app.inject({
      method: "GET",
      url: `/v2/chats/${encodeURIComponent(conversationId)}/messages?limit=10`,
      headers: viewerHeaders
    });
    const threadCursor = threadFirst.json().data.page.nextCursor as string;
    const threadDeepUrl = `/v2/chats/${encodeURIComponent(conversationId)}/messages?limit=10&cursor=${encodeURIComponent(threadCursor)}`;
    const threadDeepCold = await app.inject({ method: "GET", url: threadDeepUrl, headers: viewerHeaders });
    const threadDeepWarm = await app.inject({ method: "GET", url: threadDeepUrl, headers: viewerHeaders });
    expect(threadDeepCold.statusCode).toBe(200);
    expect(threadDeepWarm.statusCode).toBe(200);
    expect(threadDeepWarm.json().meta.db.reads).toBe(0);

    const send = await app.inject({
      method: "POST",
      url: `/v2/chats/${encodeURIComponent(conversationId)}/messages`,
      headers: { ...viewerHeaders, "content-type": "application/json" },
      payload: { text: "deep cache invalidation check", clientMessageId: `deep-${Date.now()}` }
    });
    expect(send.statusCode).toBe(200);

    const inboxDeepAfter = await app.inject({ method: "GET", url: inboxDeepUrl, headers: viewerHeaders });
    const threadDeepAfter = await app.inject({ method: "GET", url: threadDeepUrl, headers: viewerHeaders });
    expect(inboxDeepAfter.statusCode).toBe(200);
    expect(threadDeepAfter.statusCode).toBe(200);
    expect(inboxDeepAfter.json().meta.db.reads).toBeGreaterThan(0);
    expect(threadDeepAfter.json().meta.db.reads).toBeGreaterThan(0);
  });
});
