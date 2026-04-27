import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

const USER_ID = "aXngoh9jeqW35FNM3fq1w9aXdEh1";
const POST_ID = `${USER_ID}-post-12`;

describe("v2 profile post detail route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("allows non-internal viewer for profile post detail", async () => {
    const res = await app.inject({ method: "GET", url: `/v2/profiles/${USER_ID}/posts/${POST_ID}/detail` });
    expect(res.statusCode).toBe(200);
  });

  it("returns detail payload with first-render fields", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/profiles/${USER_ID}/posts/${POST_ID}/detail`,
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("profile.postdetail.get");
    expect(body.data.firstRender.post.postId).toBe(POST_ID);
    expect(Array.isArray(body.data.firstRender.post.assets)).toBe(true);
    expect(body.data.firstRender.post.assets.length).toBeGreaterThan(0);
  });

  it("collapses repeated identical detail opens to warm near-zero db ops", async () => {
    const url = `/v2/profiles/${USER_ID}/posts/${POST_ID}/detail`;
    const headers = {
      "x-viewer-id": "internal-viewer-warm",
      "x-viewer-roles": "internal"
    };
    const first = await app.inject({ method: "GET", url, headers });
    const second = await app.inject({ method: "GET", url, headers });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().meta.db.reads).toBe(0);
    expect(second.json().meta.db.queries).toBe(0);
  });

  it("returns 404 when post does not belong to profile", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/profiles/${USER_ID}/posts/another-user-post-1/detail`,
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal"
      }
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("post_not_found");
  });

  it("uses deferred fallback when comments preview is slow", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/profiles/${USER_ID}/posts/${POST_ID}/detail?debugSlowDeferredMs=300`,
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

  it("records diagnostics fields for route", async () => {
    await app.inject({
      method: "GET",
      url: `/v2/profiles/${USER_ID}/posts/${POST_ID}/detail`,
      headers: {
        "x-viewer-id": "internal-viewer-2",
        "x-viewer-roles": "internal"
      }
    });

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=15" });
    const rows = diagnostics.json().data.recentRequests as Array<{
      routeName?: string;
      dbOps: { reads: number };
      cache: { hits: number };
    }>;
    const routeRows = rows.filter((row) => row.routeName === "profile.postdetail.get");
    expect(routeRows.length).toBeGreaterThan(0);
    expect(routeRows.some((row) => row.dbOps.reads > 0)).toBe(true);
    expect(typeof routeRows[0]?.cache.hits).toBe("number");
  });
});
