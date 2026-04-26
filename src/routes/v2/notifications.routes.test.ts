import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../app/createApp.js";

describe("v2 notifications routes", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const viewerHeaders = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal"
  };

  it("lists notifications with cursor pagination", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/v2/notifications?limit=10",
      headers: viewerHeaders
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json().data;
    expect(firstBody.routeName).toBe("notifications.list.get");
    expect(firstBody.items.length).toBe(10);
    expect(firstBody.page.cursorIn).toBeNull();
    expect(typeof firstBody.page.nextCursor).toBe("string");

    const second = await app.inject({
      method: "GET",
      url: `/v2/notifications?limit=10&cursor=${encodeURIComponent(firstBody.page.nextCursor)}`,
      headers: viewerHeaders
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json().data;
    expect(secondBody.page.cursorIn).toBe(firstBody.page.nextCursor);
    expect(secondBody.items.length).toBe(10);
    expect(secondBody.items[0].notificationId).not.toBe(firstBody.items[0].notificationId);
  });

  it("uses one query per cold page and collapses repeated fetches", async () => {
    const url = "/v2/notifications?limit=15";
    await app.inject({ method: "GET", url, headers: viewerHeaders });
    await app.inject({ method: "GET", url, headers: viewerHeaders });
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=60" });
    const rows = diagnostics
      .json()
      .data.recentRequests.filter((r: { routeName?: string }) => r.routeName === "notifications.list.get");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const latest = rows[0];
    const previous = rows[1];
    expect(previous.dbOps.queries).toBe(1);
    expect(latest.dbOps.queries).toBe(0);
    expect(latest.dbOps.reads).toBe(0);
    expect(latest.budgetViolations).toEqual([]);
  });

  it("marks selected notifications read with idempotent replay", async () => {
    const list = await app.inject({ method: "GET", url: "/v2/notifications?limit=10", headers: viewerHeaders });
    const ids = (list.json().data.items as Array<{ notificationId: string }>).slice(0, 3).map((i) => i.notificationId);
    const first = await app.inject({
      method: "POST",
      url: "/v2/notifications/mark-read",
      headers: { ...viewerHeaders, "content-type": "application/json" },
      payload: { notificationIds: ids }
    });
    const second = await app.inject({
      method: "POST",
      url: "/v2/notifications/mark-read",
      headers: { ...viewerHeaders, "content-type": "application/json" },
      payload: { notificationIds: ids }
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().data.idempotency.replayed).toBe(false);
    expect(second.json().data.idempotency.replayed).toBe(true);
  });

  it("marks all read with idempotent replay", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/v2/notifications/mark-all-read",
      headers: viewerHeaders
    });
    const second = await app.inject({
      method: "POST",
      url: "/v2/notifications/mark-all-read",
      headers: viewerHeaders
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.idempotency.replayed).toBe(true);
  });

  it("invalidates deeper cached notification pages after read-state mutations", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/v2/notifications?limit=10",
      headers: viewerHeaders
    });
    const cursor = first.json().data.page.nextCursor as string;
    const deepUrl = `/v2/notifications?limit=10&cursor=${encodeURIComponent(cursor)}`;
    const deepCold = await app.inject({ method: "GET", url: deepUrl, headers: viewerHeaders });
    const deepWarm = await app.inject({ method: "GET", url: deepUrl, headers: viewerHeaders });
    expect(deepCold.statusCode).toBe(200);
    expect(deepWarm.statusCode).toBe(200);
    expect(deepWarm.json().meta.db.reads).toBe(0);

    const markAll = await app.inject({
      method: "POST",
      url: "/v2/notifications/mark-all-read",
      headers: viewerHeaders
    });
    expect(markAll.statusCode).toBe(200);

    const deepAfterMutation = await app.inject({ method: "GET", url: deepUrl, headers: viewerHeaders });
    expect(deepAfterMutation.statusCode).toBe(200);
    expect(deepAfterMutation.json().meta.db.reads).toBeGreaterThan(0);
  });

  it("creates notifications from follow/comment/like mutations without route blocking", async () => {
    const actor = `actor-${randomUUID().slice(0, 6)}`;
    const target = `target-${randomUUID().slice(0, 6)}`;
    const actorHeaders = { "x-viewer-id": actor, "x-viewer-roles": "internal" };
    const targetHeaders = { "x-viewer-id": target, "x-viewer-roles": "internal" };

    const follow = await app.inject({
      method: "POST",
      url: `/v2/users/${encodeURIComponent(target)}/follow`,
      headers: actorHeaders
    });
    expect(follow.statusCode).toBe(200);

    const postId = "internal-viewer-feed-post-1";
    const comment = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/comments`,
      headers: { ...actorHeaders, "content-type": "application/json" },
      payload: { text: "notif hook check", clientMutationKey: `nmk-${Date.now()}` }
    });
    expect(comment.statusCode).toBe(200);

    const like = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/like`,
      headers: actorHeaders
    });
    expect(like.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const targetList = await app.inject({
      method: "GET",
      url: "/v2/notifications?limit=20",
      headers: targetHeaders
    });
    expect(targetList.statusCode).toBe(200);
    const targetItems = targetList.json().data.items as Array<{ type: string; actorId: string }>;
    expect(targetItems.some((item) => item.type === "follow" && item.actorId === actor)).toBe(true);
  });

  it("emits diagnostics for notifications routes", async () => {
    await app.inject({ method: "GET", url: "/v2/notifications?limit=10", headers: viewerHeaders });
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=80" });
    const rows = diagnostics.json().data.recentRequests as Array<{
      routeName?: string;
      routePolicy?: { routeName: string };
      dedupe?: { hits: number; misses: number };
      concurrency?: { waits: number };
      budgetViolations?: string[];
    }>;
    const row = rows.find((r) => r.routeName === "notifications.list.get");
    expect(row).toBeTruthy();
    expect(row?.routePolicy?.routeName).toBe("notifications.list.get");
    expect(typeof row?.dedupe?.hits).toBe("number");
    expect(typeof row?.dedupe?.misses).toBe("number");
    expect(typeof row?.concurrency?.waits).toBe("number");
    expect(row?.budgetViolations).toEqual([]);
  });
});
