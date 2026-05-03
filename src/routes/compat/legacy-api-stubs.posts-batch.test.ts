import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("compat /api/posts/batch", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", ENABLE_LEGACY_COMPAT_ROUTES: true });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
    "content-type": "application/json",
  };

  it("returns 200 with hydrated posts for seeded ids (or 503 if upstream unavailable)", async () => {
    // From deterministic Firestore seed (used across many tests).
    const seededPostId = "internal-viewer-feed-post-1";
    const res = await app.inject({
      method: "POST",
      url: "/api/posts/batch",
      headers,
      payload: JSON.stringify({ postIds: [seededPostId] }),
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.posts)).toBe(true);
    expect(body.posts.some((p: any) => String(p.id ?? p.postId ?? "") === seededPostId)).toBe(true);
  });

  it("returns 400 for missing postIds", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/posts/batch",
      headers,
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
  });
});

