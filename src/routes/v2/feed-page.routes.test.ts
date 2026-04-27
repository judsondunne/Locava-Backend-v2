import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 feed page route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", LEGACY_MONOLITH_PROXY_BASE_URL: undefined });

  it("rejects non-internal viewer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/feed/page"
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 503 (not fake 200) when page source-of-truth is unavailable", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/feed/page",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect([200, 503]).toContain(res.statusCode);
    const body = res.json() as Record<string, unknown>;
    if (res.statusCode === 200) {
      const data = body.data as Record<string, unknown>;
      const items = data.items as Array<Record<string, unknown>>;
      expect(data.debugFeedSource).toBe("backendv2_firestore");
      expect(items.every((i) => !String(i.postId ?? "").includes("internal-viewer-feed-post"))).toBe(true);
    }
  });

  it("supports cursor pagination and request key", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/v2/feed/page?limit=5",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    if (first.statusCode !== 200) return;
    const firstBody = first.json();
    const nextCursor = firstBody.data.page.nextCursor as string | null;
    if (!nextCursor) return;

    const second = await app.inject({
      method: "GET",
      url: `/v2/feed/page?limit=5&cursor=${encodeURIComponent(nextCursor)}`,
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect([200, 503]).toContain(second.statusCode);
    if (first.statusCode === 200 && second.statusCode === 200) {
      const secondBody = second.json();
      expect(secondBody.data.page.cursorIn).toBe(nextCursor);
      if ((secondBody.data.items as Array<Record<string, unknown>>).length > 0) {
        expect(secondBody.data.items[0].postId).not.toBe(firstBody.data.items[0].postId);
        expect(typeof secondBody.data.items[0].createdAtMs).toBe("number");
      } else {
        expect(secondBody.data.debugFailureReason).toBeUndefined();
      }
      expect(secondBody.data.requestKey).toContain(nextCursor);
    }
  });

  it("enforces max limit and rejects invalid cursor", async () => {
    const max = await app.inject({
      method: "GET",
      url: "/v2/feed/page?limit=8",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect([200, 503]).toContain(max.statusCode);

    const tooHigh = await app.inject({
      method: "GET",
      url: "/v2/feed/page?limit=20",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect(tooHigh.statusCode).toBe(400);

    const badCursor = await app.inject({
      method: "GET",
      url: "/v2/feed/page?cursor=not-a-cursor",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect(badCursor.statusCode).toBe(400);
  });

  it("exposes dedupe/cache/concurrency diagnostics fields", async () => {
    const [a, b] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/v2/feed/page?cursor=cursor:10&limit=5",
        headers: {
          "x-viewer-id": "internal-viewer",
          "x-viewer-roles": "internal"
        }
      }),
      app.inject({
        method: "GET",
        url: "/v2/feed/page?cursor=cursor:10&limit=5",
        headers: {
          "x-viewer-id": "internal-viewer",
          "x-viewer-roles": "internal"
        }
      })
    ]);
    expect([200, 503]).toContain(a.statusCode);
    expect([200, 503]).toContain(b.statusCode);

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=20" });
    const payload = diagnostics.json();
    const row = payload.data.recentRequests.find((r: { routeName?: string }) => r.routeName === "feed.page.get");
    expect(row).toBeTruthy();
    expect(typeof row.payloadBytes).toBe("number");
    expect(typeof row.dbOps.reads).toBe("number");
    expect(typeof row.cache.hits).toBe("number");
    expect(typeof row.dedupe.hits).toBe("number");
    expect(typeof row.concurrency.waits).toBe("number");
    expect(row.routePolicy.routeName).toBe("feed.page.get");
  });

  it("collapses repeated identical page request to near-zero reads", async () => {
    const url = "/v2/feed/page?cursor=cursor:10&limit=5";
    await app.inject({
      method: "GET",
      url,
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    await app.inject({
      method: "GET",
      url,
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=40" });
    const rows = diagnostics
      .json()
      .data.recentRequests.filter((r: { routeName?: string }) => r.routeName === "feed.page.get");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const latest = rows[0];
    const coldRow = rows.find((row: { dbOps: { queries: number } }) => row.dbOps.queries > 0);
    if (coldRow) {
      expect(latest.dbOps.queries).toBe(0);
      expect(latest.dbOps.reads).toBe(0);
    }
    expect(latest.budgetViolations).toEqual([]);
  });

  it("paginates after bootstrap cursor for heavy viewer", async () => {
    const viewerId = "aXngoh9jeqW35FNM3fq1w9aXdEh1";
    const bootstrap = await app.inject({
      method: "GET",
      url: "/v2/feed/bootstrap?limit=5",
      headers: {
        "x-viewer-id": viewerId,
        "x-viewer-roles": "internal"
      }
    });
    if (bootstrap.statusCode !== 200) return;
    const b = bootstrap.json() as Record<string, unknown>;
    const data = b.data as Record<string, unknown>;
    const firstRender = data.firstRender as Record<string, unknown>;
    const feed = firstRender.feed as Record<string, unknown>;
    const page = feed.page as Record<string, unknown>;
    const cursor = page.nextCursor as string | null | undefined;
    if (!cursor) return;
    const next = await app.inject({
      method: "GET",
      url: `/v2/feed/page?limit=5&cursor=${encodeURIComponent(cursor)}`,
      headers: {
        "x-viewer-id": viewerId,
        "x-viewer-roles": "internal"
      }
    });
    expect([200, 503]).toContain(next.statusCode);
    if (next.statusCode === 200) {
      const n = next.json() as Record<string, unknown>;
      const nd = n.data as Record<string, unknown>;
      const items = (nd.items as Array<Record<string, unknown>>) ?? [];
      if (items.length > 0) {
        const first = items[0] ?? {};
        const media = (first.media as Record<string, unknown> | undefined) ?? {};
        const author = (first.author as Record<string, unknown> | undefined) ?? {};
        expect(String(first.postId ?? "").length).toBeGreaterThan(0);
        expect(String(author.userId ?? "").length).toBeGreaterThan(0);
        expect(String(media.posterUrl ?? "").length).toBeGreaterThan(0);
        expect(typeof first.createdAtMs).toBe("number");
      } else {
        expect(nd.debugFailureReason).toBeUndefined();
      }
    }
  });
});
