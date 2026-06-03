import { describe, expect, it } from "vitest";
import {
  buildRouteSummaryForMapMarker,
  routeMapPreviewFromDoc,
  routeMapPreviewToNativeCoords,
} from "./unexploredRouteMapGeometry.js";

/** Minimal valid encoded polyline (2 points). */
const SAMPLE_POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

describe("unexploredRouteMapGeometry", () => {
  it("decodes encoded polyline from route doc fields", () => {
    const preview = routeMapPreviewFromDoc({ encodedPolyline: SAMPLE_POLYLINE });
    expect(preview.length).toBeGreaterThanOrEqual(2);
  });

  it("builds routeSummary with native-friendly routePreviewCoordinates", () => {
    const preview = routeMapPreviewFromDoc({ encodedPolyline: SAMPLE_POLYLINE });
    const summary = buildRouteSummaryForMapMarker({
      data: { encodedPolyline: SAMPLE_POLYLINE },
      preview,
    });
    const native = summary.routePreviewCoordinates as Array<{ lat: number; lon: number }>;
    expect(Array.isArray(native)).toBe(true);
    expect(native.length).toBeGreaterThanOrEqual(2);
    expect(native[0]).toMatchObject({ lat: expect.any(Number), lon: expect.any(Number) });
    expect(routeMapPreviewToNativeCoords(preview)[0]).toMatchObject({
      lat: expect.any(Number),
      lon: expect.any(Number),
    });
  });
});
