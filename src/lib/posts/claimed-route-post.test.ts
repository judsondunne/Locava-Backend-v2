import { describe, expect, it } from "vitest";
import {
  buildClaimedRouteFieldsFromClientPayload,
  detectColdOpenRoutePost,
  extractPersistedRouteFieldsForApi,
  normalizePostingFinalizeAssetLocations,
} from "./claimed-route-post.js";

const SAMPLE_POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

describe("claimed-route-post", () => {
  it("normalizes per-asset locations aligned to asset count", () => {
    const rows = normalizePostingFinalizeAssetLocations(
      [{ lat: 43.5, long: -72.4 }, { lat: 43.51, long: -72.39 }],
      2,
    );
    expect(rows).toEqual([
      { lat: 43.5, long: -72.4 },
      { lat: 43.51, long: -72.39 },
    ]);
  });

  it("builds route post fields from client routeSummary without faking geometry", () => {
    const fields = buildClaimedRouteFieldsFromClientPayload({
      undiscoveredRouteId: "route_abc",
      routeSource: "undiscovered_claim",
      routeName: "Ridge Trail",
      routeSummary: {
        encodedPolyline: SAMPLE_POLYLINE,
      },
    });
    expect(fields).not.toBeNull();
    expect(fields?.isRoute).toBe(true);
    expect(fields?.postType).toBe("route");
    expect(fields?.routeSource).toBe("undiscovered_claim");
    expect(fields?.undiscoveredRouteId).toBe("route_abc");
    const preview = fields?.routePreviewCoordinates as Array<{ lat: number; lon: number }>;
    expect(Array.isArray(preview)).toBe(true);
    expect((preview?.length ?? 0) >= 2).toBe(true);
  });

  it("returns null when client payload has no route geometry", () => {
    const fields = buildClaimedRouteFieldsFromClientPayload({
      undiscoveredRouteId: "route_empty",
      routeSource: "undiscovered_claim",
      routeSummary: { pointCount: 0 },
    });
    expect(fields).toBeNull();
  });

  it("detects durable cold-open route posts from persisted fields", () => {
    const fields = buildClaimedRouteFieldsFromClientPayload({
      undiscoveredRouteId: "route_cold",
      routeSource: "undiscovered_claim",
      routeSummary: {
        encodedPolyline: SAMPLE_POLYLINE,
      },
    });
    expect(fields).not.toBeNull();
    const coldOpen = detectColdOpenRoutePost(fields as Record<string, unknown>);
    expect(coldOpen.isRoutePost).toBe(true);
    expect(coldOpen.routeGeometryPresent).toBe(true);
    expect(coldOpen.sourceUnexploredRouteId).toBe("route_cold");
  });

  it("extracts route fields for API/detail hydration", () => {
    const extracted = extractPersistedRouteFieldsForApi({
      postType: "route",
      isRoute: true,
      undiscoveredRouteId: "route_api",
      routeSummary: {
        routePreviewCoordinates: [
          { lat: 1, lon: 2 },
          { lat: 3, lon: 4 },
        ],
      },
      privacy: "Public Route",
    });
    expect(extracted.postType).toBe("route");
    expect(extracted.sourceUnexploredRouteId).toBe("route_api");
    expect(extracted.privacy).toBe("Public Route");
  });
});
