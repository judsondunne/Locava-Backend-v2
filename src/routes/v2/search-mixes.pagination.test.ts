import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 search mixes pagination", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
    "content-type": "application/json",
  };

  it("paginates hiking for multiple pages without duplicates (or 503 if upstream unavailable)", async () => {
    const mixId = "activity:hiking";
    const page1 = await app.inject({
      method: "POST",
      url: "/v2/search/mixes/feed",
      headers,
      payload: JSON.stringify({ mixId, cursor: null, limit: 12, lat: 40.68843, lng: -75.22073, includeDebug: false }),
    });
    expect([200, 503]).toContain(page1.statusCode);
    if (page1.statusCode !== 200) return;
    const b1 = page1.json().data;
    expect(Array.isArray(b1.posts)).toBe(true);
    expect(b1.posts.length).toBeGreaterThan(0);
    expect(typeof b1.hasMore).toBe("boolean");
    expect(b1.nextCursor === null || typeof b1.nextCursor === "string").toBe(true);
    if (!b1.nextCursor) return;

    const page2 = await app.inject({
      method: "POST",
      url: "/v2/search/mixes/feed",
      headers,
      payload: JSON.stringify({ mixId, cursor: b1.nextCursor, limit: 12, lat: 40.68843, lng: -75.22073, includeDebug: false }),
    });
    expect([200, 503]).toContain(page2.statusCode);
    if (page2.statusCode !== 200) return;
    const b2 = page2.json().data;
    const ids1 = new Set(b1.posts.map((p: any) => String(p.id ?? p.postId ?? "").trim()).filter(Boolean));
    const ids2 = b2.posts.map((p: any) => String(p.id ?? p.postId ?? "").trim()).filter(Boolean);
    expect(ids2.some((id: string) => ids1.has(id))).toBe(false);

    if (!b2.nextCursor) return;
    const page3 = await app.inject({
      method: "POST",
      url: "/v2/search/mixes/feed",
      headers,
      payload: JSON.stringify({ mixId, cursor: b2.nextCursor, limit: 12, lat: 40.68843, lng: -75.22073, includeDebug: false }),
    });
    expect([200, 503]).toContain(page3.statusCode);
  });
});

