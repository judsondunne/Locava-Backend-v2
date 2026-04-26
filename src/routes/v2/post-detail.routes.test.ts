import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 post detail canonical route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("returns success when source is available or truthful 503 when unavailable", async () => {
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
  });
});
