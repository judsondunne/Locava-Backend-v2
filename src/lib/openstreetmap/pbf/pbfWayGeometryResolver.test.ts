import { describe, expect, it } from "vitest";
import {
  cachePbfNodeCoords,
  enrichPbfEntityWithWayGeometry,
  enrichPbfWayWithGeometry,
  resolveWayRefsToGeometry,
} from "./pbfWayGeometryResolver.js";

describe("pbfWayGeometryResolver", () => {
  it("resolves way refs from cached node coordinates", () => {
    const cache = new Map<number, { lat: number; lon: number }>();
    cachePbfNodeCoords(cache, { type: "node", id: 1, lat: 43.7, lon: -72.3 });
    cachePbfNodeCoords(cache, { type: "node", id: 2, lat: 43.71, lon: -72.31 });
    cachePbfNodeCoords(cache, { type: "node", id: 3, lat: 43.72, lon: -72.32 });

    const way = enrichPbfWayWithGeometry(
      { type: "way", id: 99, refs: [1, 2, 3], tags: { highway: "path", name: "Forest City Trail" } },
      cache
    );

    expect(way.geometry).toHaveLength(3);
    expect(way.geometry?.[0]).toEqual({ lat: 43.7, lon: -72.3 });
  });

  it("leaves pre-resolved geometry unchanged", () => {
    const cache = new Map<number, { lat: number; lon: number }>();
    const way = enrichPbfWayWithGeometry(
      {
        type: "way",
        id: 1,
        refs: [10, 11],
        geometry: [
          { lat: 1, lon: 2 },
          { lat: 3, lon: 4 },
        ],
        tags: { highway: "path" },
      },
      cache
    );
    expect(way.geometry).toEqual([
      { lat: 1, lon: 2 },
      { lat: 3, lon: 4 },
    ]);
  });

  it("skips ways when refs are missing from cache", () => {
    const cache = new Map<number, { lat: number; lon: number }>();
    const geometry = resolveWayRefsToGeometry([1, 2], cache);
    expect(geometry).toEqual([]);
  });

  it("caches nodes and enriches ways in stream order", () => {
    const cache = new Map<number, { lat: number; lon: number }>();
    const node = enrichPbfEntityWithWayGeometry(
      { type: "node", id: 5, lat: 44.1, lon: -73.2, tags: {} },
      cache
    );
    expect(node?.type).toBe("node");
    const way = enrichPbfEntityWithWayGeometry(
      { type: "way", id: 6, refs: [5, 5], tags: { leisure: "park", name: "Park Way" } },
      cache
    );
    expect(way?.type).toBe("way");
    if (way?.type === "way") {
      expect(way.geometry?.length).toBe(2);
    }
  });
});
