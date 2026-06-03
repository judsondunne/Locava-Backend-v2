import { describe, expect, it } from "vitest";
import { chunkStateBbox, dedupeRawFeatures, runWithConcurrencyLimit } from "./offroadChunking.js";

describe("offroadChunking", () => {
  const vt = { minLat: 42.73, minLng: -73.44, maxLat: 45.02, maxLng: -71.46 };

  it("state bbox chunking produces multiple chunks", () => {
    const chunks = chunkStateBbox(vt, { chunkSizeDegreesLat: 0.5, chunkSizeDegreesLng: 0.5 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("chunks dedupe overlapping features", () => {
    const features = [
      {
        sourceId: "usfs_mvum",
        sourceType: "usfs_mvum" as const,
        featureId: "a/1",
        geometryType: "LineString" as const,
        geometry: {},
        properties: {},
      },
      {
        sourceId: "usfs_mvum",
        sourceType: "usfs_mvum" as const,
        featureId: "a/1",
        geometryType: "LineString" as const,
        geometry: {},
        properties: {},
      },
    ];
    expect(dedupeRawFeatures(features).length).toBe(1);
  });

  it("concurrency limit enforced", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    await runWithConcurrencyLimit([1, 2, 3, 4, 5], 2, async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent -= 1;
      return 1;
    });
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});
