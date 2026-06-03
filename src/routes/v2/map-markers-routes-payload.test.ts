import { describe, expect, it } from "vitest";
import { buildRouteSummaryForMapMarker, routeMapPreviewFromDoc } from "../../lib/map/unexploredRouteMapGeometry.js";

describe("map markers compact route payload contract", () => {
  it("builds renderable routeSummary for compact wire (not truncated to unusable preview)", () => {
    const encodedPolyline = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
    const preview = routeMapPreviewFromDoc({ encodedPolyline });
    const summary = buildRouteSummaryForMapMarker({
      data: { encodedPolyline, geometryStorage: { mode: "inline" } },
      preview,
    });
    const wirePreview = summary.routePreviewCoordinates as Array<{ lat: number; lon: number }>;
    expect(wirePreview.length).toBeGreaterThanOrEqual(2);
    expect(typeof summary.encodedPolyline).toBe("string");
    expect((summary.encodedPolyline as string).length).toBeGreaterThan(0);
  });

  it("simulates unexplored route marker shape returned beside compact posts", () => {
    const encodedPolyline = "abcd"; // invalid short — use real sample
    const real = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
    const preview = routeMapPreviewFromDoc({ encodedPolyline: real });
    const marker = {
      id: "dev_hartland_vt_reservoir_shore_loop",
      postId: "dev_hartland_vt_reservoir_shore_loop",
      lat: preview[0]!.lat,
      lng: preview[0]!.lng,
      sourceCollection: "unexploredRoutes",
      itemType: "unexploredRoute",
      isUnexplored: true,
      isRoute: true,
      routeSummary: buildRouteSummaryForMapMarker({
        data: { encodedPolyline: real },
        preview,
      }),
    };
    const rs = marker.routeSummary as Record<string, unknown>;
    const coords = rs.routePreviewCoordinates as unknown[];
    expect(coords.length).toBeGreaterThanOrEqual(2);
    expect(marker.isRoute).toBe(true);
    void encodedPolyline;
  });
});
