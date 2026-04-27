import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 post likes list route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("lists likes after like mutation (source-of-truth permitting)", async () => {
    const headers = { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" };
    const postId = "internal-viewer-feed-post-1";

    const like = await app.inject({
      method: "POST",
      url: `/v2/posts/${encodeURIComponent(postId)}/like`,
      headers
    });
    if (like.statusCode === 503) {
      expect(like.json().error.code).toBe("source_of_truth_required");
      return;
    }
    expect(like.statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: `/v2/posts/${encodeURIComponent(postId)}/likes?limit=50`,
      headers
    });
    if (res.statusCode === 503) {
      expect(res.json().error.code).toBe("source_of_truth_required");
      return;
    }
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("posts.likes.list");
    expect(body.data.postId).toBe(postId);
    expect(Array.isArray(body.data.likes)).toBe(true);
  });
});

