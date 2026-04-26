import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 search users route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("rejects non-internal viewer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/users?q=creator"
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns lean AuthorSummary payload with request metadata", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/users?q=creator&limit=8",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("search.users.get");
    expect(body.data.queryEcho).toBe("creator");
    expect(body.data.requestKey).toContain("creator");
    expect(body.data.page.sort).toBe("search_users_relevance_v1");
    expect(body.data.items.length).toBeLessThanOrEqual(8);
    expect(body.data.items[0].userId).toBeTruthy();
    expect(body.data.items[0].handle).toBeTruthy();
    expect(body.data.items[0].displayName !== undefined).toBe(true);
    expect(body.data.items[0].profilePic !== undefined).toBe(true);
    expect(body.data.items[0].posts).toBeUndefined();
  });

  it("supports pagination and stale-suppression metadata", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/v2/search/users?q=creator&limit=6",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    const nextCursor = firstBody.data.page.nextCursor as string;
    expect(nextCursor).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/v2/search/users?q=creator&limit=6&cursor=${encodeURIComponent(nextCursor)}`,
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.data.page.cursorIn).toBe(nextCursor);
    expect(secondBody.data.requestKey).toContain(nextCursor);
  });

  it("handles duplicate same-query and rapid query changes", async () => {
    const headers = {
      "x-viewer-id": "internal-viewer",
      "x-viewer-roles": "internal"
    };

    const [a, b] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/v2/search/users?q=creator&limit=8",
        headers
      }),
      app.inject({
        method: "GET",
        url: "/v2/search/users?q=creator&limit=8",
        headers
      })
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);

    const fastA = await app.inject({
      method: "GET",
      url: "/v2/search/users?q=creat&limit=8",
      headers
    });
    const fastB = await app.inject({
      method: "GET",
      url: "/v2/search/users?q=creator&limit=8",
      headers
    });
    expect(fastA.statusCode).toBe(200);
    expect(fastB.statusCode).toBe(200);
    expect(fastA.json().data.queryEcho).toBe("creat");
    expect(fastB.json().data.queryEcho).toBe("creator");
  });

  it("reflects follow mutation consistency and exposes diagnostics", async () => {
    const headers = {
      "x-viewer-id": "internal-viewer",
      "x-viewer-roles": "internal"
    };
    const follow = await app.inject({
      method: "POST",
      url: "/v2/users/author-24/follow",
      headers
    });
    expect(follow.statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: "/v2/search/users?q=author-24&limit=8",
      headers
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.viewer.followingUserIds).toContain("author-24");

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=40" });
    const row = diagnostics
      .json()
      .data.recentRequests.find((r: { routeName?: string }) => r.routeName === "search.users.get");
    expect(row).toBeTruthy();
    expect(row.routePolicy.routeName).toBe("search.users.get");
    expect(typeof row.payloadBytes).toBe("number");
    expect(typeof row.dbOps.reads).toBe("number");
    expect(typeof row.cache.hits).toBe("number");
    expect(typeof row.dedupe.hits).toBe("number");
    expect(typeof row.concurrency.waits).toBe("number");
    expect(typeof row.entityCache.hits).toBe("number");
    expect(typeof row.entityConstruction.total).toBe("number");
    expect(row.budgetViolations).toEqual([]);
  });
});
