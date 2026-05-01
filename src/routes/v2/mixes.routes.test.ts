import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 mixes routes", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
  };

  it("returns deterministic empty response in test mode when pool has no data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/mixes/hiking/preview?activity=hiking&limit=3",
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.posts)).toBe(true);
    expect(body.mixKey).toBe("hiking");
    expect(body.diagnostics.routeName).toBe("mixes.preview.get");
  });

  it("returns page envelope with hasMore + nextCursor", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/mixes/hiking/page?activity=hiking&limit=5",
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.ok).toBe(true);
    expect(typeof body.hasMore).toBe("boolean");
    expect(body.nextCursor === null || typeof body.nextCursor === "string").toBe(true);
    expect(body.diagnostics.routeName).toBe("mixes.page.get");
  });

  it("parallel cold previews always return parseable JSON envelopes", async () => {
    const urls = [
      "/v2/mixes/hiking/preview?activity=hiking&limit=3",
      "/v2/mixes/park/preview?activity=park&limit=3",
      "/v2/mixes/beach/preview?activity=beach&limit=3",
      "/v2/mixes/cafe/preview?activity=cafe&limit=3",
    ];
    const responses = await Promise.all(
      urls.map((url) =>
        app.inject({
          method: "GET",
          url,
          headers,
        })
      )
    );

    for (const res of responses) {
      expect(() => JSON.parse(res.body)).not.toThrow();
      const parsed = res.json();
      expect(typeof parsed.ok).toBe("boolean");
      expect(Array.isArray(parsed.data.posts)).toBe(true);
      expect(typeof parsed.data.poolState).toBe("string");
    }
  });
});
