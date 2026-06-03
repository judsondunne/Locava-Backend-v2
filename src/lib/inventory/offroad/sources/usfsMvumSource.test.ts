import { describe, expect, it, vi, afterEach } from "vitest";
import { buildArcgisEnvelopeQueryParams } from "./arcgisOffroadQuery.js";
import {
  USFS_MVUM_ROADS_LAYER,
  USFS_MVUM_TRAILS_LAYER,
  usfsMvumAdapter,
  usfsMvumLayerQueryUrl,
} from "./usfsMvumSource.js";

const bbox = { minLat: 39.0, minLng: -106.0, maxLat: 39.5, maxLng: -105.5 };

describe("usfsMvumSource", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds ArcGIS query with bbox for roads layer", () => {
    const url = usfsMvumLayerQueryUrl(bbox, USFS_MVUM_ROADS_LAYER);
    expect(url).toContain("EDW_MVUM_01/MapServer/1/query");
    expect(url).toContain("geometry=-106");
    const params = buildArcgisEnvelopeQueryParams({ bbox });
    expect(params.get("geometry")).toBe("-106,39,-105.5,39.5");
  });

  it("queries layers 1 and 2", () => {
    expect(usfsMvumLayerQueryUrl(bbox, USFS_MVUM_ROADS_LAYER)).toContain("/1/query");
    expect(usfsMvumLayerQueryUrl(bbox, USFS_MVUM_TRAILS_LAYER)).toContain("/2/query");
  });

  it("normalizes LineString with offroading activity and MVUM warning", () => {
    const route = usfsMvumAdapter.normalizeFeature(
      {
        sourceId: "usfs_mvum",
        sourceType: "usfs_mvum",
        featureId: "usfs_mvum/l1/99",
        geometryType: "LineString",
        geometry: {
          type: "LineString",
          coordinates: [
            [-106.1, 39.1],
            [-106.09, 39.11],
          ],
        },
        properties: { OBJECTID: 99, ROUTE_NAME: "FR 123" },
        layerId: USFS_MVUM_ROADS_LAYER,
      },
      { importRunId: "t", stateCode: "CO" }
    );
    expect(route && "activity" in route && route.activity).toBe("offroading");
    expect(route && "offroad" in route && route.offroad?.legalDisplayLabel).toBe("Motorized route");
    expect(route && "offroad" in route && route.offroad?.accessWarnings?.[0]).toContain("MVUM");
  });

  it("handles pagination via fetch mock", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          features: [
            {
              attributes: { OBJECTID: 1 },
              geometry: { paths: [[[-106.1, 39.1], [-106.09, 39.11]]] },
            },
          ],
          exceededTransferLimit: false,
        }),
      }))
    );
    const raw = await usfsMvumAdapter.fetchForBbox({
      bbox,
      dryRun: true,
      importRunId: "t",
      pageSize: 1000,
      maxPages: 2,
    });
    expect(raw.length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalled();
  });
});
