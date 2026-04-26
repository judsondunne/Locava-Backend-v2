import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 feed item detail route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const postId = "internal-viewer-feed-post-6";

  it("rejects non-internal viewer", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/feed/items/${postId}/detail`
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns detail payload with shared summaries", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/feed/items/${postId}/detail`,
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("feed.itemdetail.get");
    expect(body.data.firstRender.post.postId).toBe(postId);
    expect(body.data.firstRender.post.cardSummary.postId).toBe(postId);
    expect(body.data.firstRender.author.userId).toBe(body.data.firstRender.post.userId);
  });

  it("degrades safely when deferred comments are slow", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/feed/items/${postId}/detail?debugSlowDeferredMs=300`,
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.degraded).toBe(true);
    expect(body.data.fallbacks).toContain("comments_preview_timeout");
  });

  it("returns not found for unknown feed post", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/feed/items/internal-viewer-feed-post-999/detail",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect(res.statusCode).toBe(404);
  });

  it("surfaces cache/dedupe/concurrency diagnostics", async () => {
    await Promise.all([
      app.inject({
        method: "GET",
        url: `/v2/feed/items/${postId}/detail`,
        headers: {
          "x-viewer-id": "internal-viewer",
          "x-viewer-roles": "internal"
        }
      }),
      app.inject({
        method: "GET",
        url: `/v2/feed/items/${postId}/detail`,
        headers: {
          "x-viewer-id": "internal-viewer",
          "x-viewer-roles": "internal"
        }
      })
    ]);

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=20" });
    const payload = diagnostics.json();
    const row = payload.data.recentRequests.find((r: { routeName?: string }) => r.routeName === "feed.itemdetail.get");
    expect(row).toBeTruthy();
    expect(typeof row.payloadBytes).toBe("number");
    expect(typeof row.dbOps.reads).toBe("number");
    expect(typeof row.cache.hits).toBe("number");
    expect(typeof row.dedupe.hits).toBe("number");
    expect(typeof row.concurrency.waits).toBe("number");
    expect(row.routePolicy.routeName).toBe("feed.itemdetail.get");
  });
});
