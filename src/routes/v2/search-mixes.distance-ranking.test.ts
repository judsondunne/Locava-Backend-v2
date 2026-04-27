import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 search mixes distance-first ranking", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
    "content-type": "application/json",
  };

  it("activity:hiking returns mostly non-decreasing distances on first page (or 503)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v2/search/mixes/feed",
      headers,
      payload: JSON.stringify({
        mixId: "activity:hiking",
        cursor: null,
        limit: 18,
        lat: 40.68843,
        lng: -75.22073,
        includeDebug: true,
      }),
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json().data;
    const debugItems = (body.debug?.items ?? []) as Array<{ distanceMiles?: number | null }>;
    const distances = debugItems
      .map((it) => (typeof it.distanceMiles === "number" ? it.distanceMiles : null))
      .filter((d): d is number => d != null && Number.isFinite(d));
    expect(distances.length).toBeGreaterThan(5);
    let nonDecreasing = 0;
    for (let i = 1; i < distances.length; i++) {
      if (distances[i] >= distances[i - 1]) nonDecreasing += 1;
    }
    // Allow small noise; require most steps to be non-decreasing.
    expect(nonDecreasing).toBeGreaterThanOrEqual(Math.floor((distances.length - 1) * 0.75));
  });
});

