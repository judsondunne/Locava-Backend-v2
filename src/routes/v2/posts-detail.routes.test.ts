import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 posts detail route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("returns canonical post viewer detail payload by post id", async () => {
    const headers = { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" };
    const res = await app.inject({
      method: "GET",
      url: "/v2/posts/internal-viewer-feed-post-1/detail",
      headers
    });
    if (res.statusCode === 503) {
      const body = res.json();
      expect(body.error.code).toBe("source_of_truth_required");
      return;
    }
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("posts.detail.get");
    expect(body.data.firstRender.post.postId).toBe("internal-viewer-feed-post-1");
    expect(Array.isArray(body.data.firstRender.post.assets)).toBe(true);
    expect(body.data.debugPostIds).toEqual(["internal-viewer-feed-post-1"]);
    expect(typeof body.data.debugDurationMs).toBe("number");
  });

  it("returns canonical batch post detail payload", async () => {
    const headers = { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" };
    const res = await app.inject({
      method: "POST",
      url: "/v2/posts/details:batch",
      headers,
      payload: {
        postIds: ["internal-viewer-feed-post-1", "internal-viewer-feed-post-2", "internal-viewer-feed-post-1"],
        reason: "prefetch"
      }
    });
    if (res.statusCode === 503) {
      const body = res.json();
      expect(body.error.code).toBe("source_of_truth_required");
      return;
    }
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("posts.detail.batch");
    expect(body.data.reason).toBe("prefetch");
    if (body.data.found.length > 0) {
      expect(body.data.found[0].detail.routeName).toBe("posts.detail.get");
    }
    expect(Array.isArray(body.data.missing)).toBe(true);
  });
});
