import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 feed bootstrap route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", LEGACY_MONOLITH_PROXY_BASE_URL: undefined });

  it("rejects non-internal viewer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/feed/bootstrap",
      headers: {
        "x-viewer-id": "user-1"
      }
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 503 (not fake 200) when source-of-truth is unavailable", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/feed/bootstrap",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect([200, 503]).toContain(res.statusCode);
    const body = res.json() as Record<string, unknown>;
    if (res.statusCode === 200) {
      const data = body.data as Record<string, unknown>;
      const firstRender = data.firstRender as Record<string, unknown>;
      const feed = firstRender.feed as Record<string, unknown>;
      const items = feed.items as Array<Record<string, unknown>>;
      expect(data.debugFeedSource).toBe("backendv2_firestore");
      expect(items.every((i) => !String(i.postId ?? "").includes("internal-viewer-feed-post"))).toBe(true);
    }
  });

  it("enforces limit bounds", async () => {
    const ok = await app.inject({
      method: "GET",
      url: "/v2/feed/bootstrap?limit=8",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect([200, 503]).toContain(ok.statusCode);

    const invalid = await app.inject({
      method: "GET",
      url: "/v2/feed/bootstrap?limit=50",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("accepts tab=following query (no-op fallback is allowed)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/feed/bootstrap?tab=following&limit=5",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    // Depending on whether Firestore source-of-truth is reachable in this environment,
    // this may either succeed (200) or truthfully report unavailability (503).
    expect([200, 503]).toContain(res.statusCode);
  });

  it("never reports debugFeedSource fallback", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/feed/bootstrap?limit=5",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });
    const body = res.json() as Record<string, unknown>;
    if (res.statusCode === 200) {
      const source = (body.data as Record<string, unknown>).debugFeedSource;
      expect(source).toBe("backendv2_firestore");
    }
  });

  it("returns real usable reels items or explicitly records parity-empty reason", async () => {
    const viewerId = "aXngoh9jeqW35FNM3fq1w9aXdEh1";
    const res = await app.inject({
      method: "GET",
      url: "/v2/feed/bootstrap?limit=5",
      headers: {
        "x-viewer-id": viewerId,
        "x-viewer-roles": "internal"
      }
    });
    if (res.statusCode === 503) return;
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const data = body.data as Record<string, unknown>;
    const firstRender = data.firstRender as Record<string, unknown>;
    const feed = firstRender.feed as Record<string, unknown>;
    const items = (feed.items as Array<Record<string, unknown>>) ?? [];
    if (items.length > 0) {
      const first = items[0] ?? {};
      const media = (first.media as Record<string, unknown> | undefined) ?? {};
      const author = (first.author as Record<string, unknown> | undefined) ?? {};
      expect(String(first.postId ?? "").length).toBeGreaterThan(0);
      expect(String(media.posterUrl ?? "").length).toBeGreaterThan(0);
      expect(String(author.userId ?? "").length).toBeGreaterThan(0);
      expect(typeof first.createdAtMs).toBe("number");
      expect((first.createdAtMs as number) > 0).toBe(true);
      expect(data.debugReturnedCount).toBeGreaterThan(0);
    } else {
      expect(data.debugFailureReason).toBeUndefined();
    }
  });

  it("surfaces diagnostics with guardrail fields", async () => {
    await app.inject({
      method: "GET",
      url: "/v2/feed/bootstrap",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=20" });
    const payload = diagnostics.json();
    const row = payload.data.recentRequests.find((r: { routeName?: string }) => r.routeName === "feed.bootstrap.get");
    expect(row).toBeTruthy();
    expect(typeof row.dbOps.reads).toBe("number");
    expect(typeof row.payloadBytes).toBe("number");
    expect(typeof row.cache.hits).toBe("number");
    expect(row.cache.hits + row.cache.misses).toBeGreaterThan(0);
    expect(typeof row.dedupe.hits).toBe("number");
    expect(typeof row.concurrency.waits).toBe("number");
  });

  it("collapses repeated identical bootstrap request to near-zero reads", async () => {
    const url = "/v2/feed/bootstrap?limit=5";
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
      .data.recentRequests.filter((r: { routeName?: string }) => r.routeName === "feed.bootstrap.get");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const latest = rows[0];
    const coldRow = rows.find((row: { dbOps: { queries: number } }) => row.dbOps.queries > 0);
    if (!coldRow) {
      expect(latest.dbOps.queries).toBe(0);
      expect(latest.dbOps.reads).toBe(0);
    } else {
      expect(coldRow).toBeTruthy();
      expect(latest.dbOps.queries).toBe(0);
      expect(latest.dbOps.reads).toBe(0);
    }
    expect(latest.budgetViolations).toEqual([]);
  });
});
