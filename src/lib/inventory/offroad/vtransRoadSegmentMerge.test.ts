import { describe, expect, it } from "vitest";
import {
  mergeVtransInventoryRoutes,
  mergeVtransRoadFeaturesByIdentity,
  vtransRoadMergeKeyFromProps,
} from "./vtransRoadSegmentMerge.js";
import { normalizeVtransRoadFeatureToInventoryRoute } from "./sources/vtransPublicHighwaySystemSource.js";
import type { LocavaInventoryRoute } from "../inventoryLocavaTypes.js";

describe("vtransRoadSegmentMerge", () => {
  it("builds merge key from town + road name + class", () => {
    const key = vtransRoadMergeKeyFromProps({
      AOTCLASS: 4,
      TWN_LR: "Hartland",
      RDFLNAME: "FERRY ROAD",
    });
    expect(key).toContain("4|hartland|");
    expect(key).toContain("ferry");
  });

  it("merges ArcGIS features with the same logical road identity", () => {
    const merged = mergeVtransRoadFeaturesByIdentity([
      {
        type: "Feature",
        properties: { OBJECTID: 1, AOTCLASS: 4, TWN_LR: "Hartland", RDFLNAME: "FERRY RD" },
        geometry: {
          type: "LineString",
          coordinates: [
            [-72.39, 43.54],
            [-72.388, 43.541],
          ],
        },
      },
      {
        type: "Feature",
        properties: { OBJECTID: 2, AOTCLASS: 4, TWN_LR: "Hartland", RDFLNAME: "FERRY RD" },
        geometry: {
          type: "LineString",
          coordinates: [
            [-72.388, 43.541],
            [-72.385, 43.543],
          ],
        },
      },
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0]!.properties?._mergedSegmentCount).toBe("2");
    expect(merged[0]!.geometry?.type).toBe("LineString");
  });

  it("merges normalized inventory routes from chunked statewide fetch", () => {
    const segA = normalizeVtransRoadFeatureToInventoryRoute(
      {
        type: "Feature",
        properties: { OBJECTID: 10, AOTCLASS: 4, TWN_LR: "Hartland", RDFLNAME: "FERRY RD" },
        geometry: { type: "LineString", coordinates: [[-72.39, 43.54], [-72.388, 43.541]] },
      },
      { importRunId: "test" }
    )!;
    const segB = normalizeVtransRoadFeatureToInventoryRoute(
      {
        type: "Feature",
        properties: { OBJECTID: 11, AOTCLASS: 4, TWN_LR: "Hartland", RDFLNAME: "FERRY RD" },
        geometry: { type: "LineString", coordinates: [[-72.388, 43.541], [-72.385, 43.543]] },
      },
      { importRunId: "test" }
    )!;
    const usfsStub = { source: "usfs_mvum", distanceMeters: 100 } as LocavaInventoryRoute;

    const out = mergeVtransInventoryRoutes([segA, segB, usfsStub]);
    const vtrans = out.filter((r) => r.source === "vtrans_public_highway_system");
    expect(vtrans.length).toBe(1);
    expect(vtrans[0]!.tags._mergedSegmentCount).toBe("2");
    expect(out.some((r) => r.source === "usfs_mvum")).toBe(true);
  });
});
