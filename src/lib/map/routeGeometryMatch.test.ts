import { describe, expect, it } from "vitest";
import { nearestPointOnPolyline } from "./routeGeometryMatch.js";

describe("nearestPointOnPolyline", () => {
  it("returns distance to segment not anchor", () => {
    const line = [
      { lat: 43.0, lng: -72.5 },
      { lat: 43.01, lng: -72.49 },
    ];
    const post = { lat: 43.005, lng: -72.495 };
    const hit = nearestPointOnPolyline(post, line);
    expect(hit).not.toBeNull();
    expect(hit!.distanceMeters).toBeLessThan(80);
  });
});
