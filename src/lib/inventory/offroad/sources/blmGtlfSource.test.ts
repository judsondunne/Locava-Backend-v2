import { describe, expect, it } from "vitest";
import {
  BLM_GTLF_LIMITED_ROADS,
  BLM_GTLF_PUBLIC_ROADS,
  BLM_GTLF_NOT_ASSESSED_ROADS,
  blmGtlfAdapter,
  blmGtlfLayerQueryUrl,
} from "./blmGtlfSource.js";

const bbox = { minLat: 38.5, minLng: -109.5, maxLat: 39.0, maxLng: -109.0 };

describe("blmGtlfSource", () => {
  it("queries default layers 0-3", () => {
    expect(blmGtlfLayerQueryUrl(bbox, BLM_GTLF_PUBLIC_ROADS)).toContain("/0/query");
    expect(blmGtlfLayerQueryUrl(bbox, BLM_GTLF_LIMITED_ROADS)).toContain("/1/query");
  });

  it("public motorized becomes accessStatus public", () => {
    const route = blmGtlfAdapter.normalizeFeature(
      {
        sourceId: "blm_gtlf",
        sourceType: "blm_gtlf",
        featureId: "blm_gtlf/l0/1",
        geometryType: "LineString",
        geometry: { type: "LineString", coordinates: [[-109.2, 38.6], [-109.19, 38.61]] },
        properties: { OBJECTID: 1 },
        layerId: BLM_GTLF_PUBLIC_ROADS,
      },
      { importRunId: "t", stateCode: "UT" }
    );
    expect(route && "offroad" in route && route.offroad?.accessStatus).toBe("public");
    expect(route && "offroad" in route && route.offroad?.legalDisplayLabel).toBe("Motorized route");
  });

  it("limited public motorized becomes accessStatus limited", () => {
    const route = blmGtlfAdapter.normalizeFeature(
      {
        sourceId: "blm_gtlf",
        sourceType: "blm_gtlf",
        featureId: "blm_gtlf/l1/2",
        geometryType: "LineString",
        geometry: { type: "LineString", coordinates: [[-109.2, 38.6], [-109.18, 38.62]] },
        properties: { OBJECTID: 2 },
        layerId: BLM_GTLF_LIMITED_ROADS,
      },
      { importRunId: "t", stateCode: "UT" }
    );
    expect(route && "offroad" in route && route.offroad?.accessStatus).toBe("limited");
    expect(route && "offroad" in route && route.offroad?.legalDisplayLabel).toBe("Limited motorized route");
  });

  it("not assessed layer is hidden when included", () => {
    const route = blmGtlfAdapter.normalizeFeature(
      {
        sourceId: "blm_gtlf",
        sourceType: "blm_gtlf",
        featureId: "blm_gtlf/l6/3",
        geometryType: "LineString",
        geometry: { type: "LineString", coordinates: [[-109.2, 38.6], [-109.17, 38.63]] },
        properties: { OBJECTID: 3 },
        layerId: BLM_GTLF_NOT_ASSESSED_ROADS,
      },
      { importRunId: "t", stateCode: "UT" }
    );
    expect(route && "displayPriority" in route && route.displayPriority).toBe("hidden");
    expect(route && "offroad" in route && route.offroad?.accessWarnings?.[0]).toContain("BLM");
  });
});
