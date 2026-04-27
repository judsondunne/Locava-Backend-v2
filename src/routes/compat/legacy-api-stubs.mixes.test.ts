import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("compat legacy mixes stubs", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
    "content-type": "application/json",
  };

  it("forwards legacy /api/v1/product/mixes/area with lat/lng", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/product/mixes/area",
      headers,
      payload: JSON.stringify({ limit: 12, lat: 44.4759, lng: -73.2121 }),
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.posts)).toBe(true);
  });

  it("forwards legacy /api/v1/product/mixes/feed with mixSpec/cursor/lat/lng", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/product/mixes/feed",
      headers,
      payload: JSON.stringify({
        limit: 12,
        cursor: "cursor:0",
        lat: 44.4759,
        lng: -73.2121,
        mixSpec: {
          kind: "mix_spec_v1",
          id: "mix_hiking",
          type: "activity_mix",
          specVersion: 1,
          seeds: { primaryActivityId: "hiking" },
          title: "Hiking Mix",
          subtitle: "Top hiking posts",
          coverSpec: { kind: "thumb_collage", maxTiles: 4 },
          geoMode: "viewer",
          personalizationMode: "taste_blended_v1",
          rankingMode: "mix_v1",
          geoBucketKey: "global",
          heroQuery: "hiking",
          cacheKeyVersion: 1,
        },
      }),
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.posts)).toBe(true);
    expect(typeof body.hasMore).toBe("boolean");
  });
});

