import { describe, expect, it } from "vitest";
import {
  buildNhdotClass6Where,
  buildNhdotQueryParams,
  normalizeNhdotRoadFeatureToInventoryRoute,
  NHDOT_LEGISLATIVE_CLASS_ENDPOINT,
} from "./nhNhdotLegislativeClassSource.js";

const lebanonBbox = { minLat: 43.62, minLng: -72.35, maxLat: 43.68, maxLng: -72.22 };

describe("nhNhdotLegislativeClassSource", () => {
  it("query params use bbox and LEGIS_CLASS=VI filter", () => {
    const params = buildNhdotQueryParams({ bbox: lebanonBbox, includeClass6: true });
    expect(params.get("geometry")).toBe("-72.35,43.62,-72.22,43.68");
    expect(params.get("where")).toBe("LEGIS_CLASS='VI'");
    expect(params.get("geometryType")).toBe("esriGeometryEnvelope");
    expect(`${NHDOT_LEGISLATIVE_CLASS_ENDPOINT}?${params.toString()}`).toContain("Legislative_Class_Groups/MapServer/5/query");
  });

  it("where clause disables fetch when includeClass6 is false", () => {
    expect(buildNhdotClass6Where(true)).toBe("LEGIS_CLASS='VI'");
    expect(buildNhdotClass6Where(false)).toBe("1=0");
  });

  it("LEGIS_CLASS=VI becomes class6_road offroading route", () => {
    const route = normalizeNhdotRoadFeatureToInventoryRoute(
      {
        type: "Feature",
        properties: {
          OBJECTID: 42,
          LEGIS_CLASS: "VI",
          STREET: "Bean Road",
          TOWN_NAME: "Lebanon",
          SECT_LENGTH: 0.42,
          SURF_TYPE: "GRAVEL",
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [-72.29, 43.65],
            [-72.288, 43.651],
          ],
        },
      },
      { importRunId: "test" }
    );
    expect(route?.activity).toBe("offroading");
    expect(route?.offroad?.offroadCategory).toBe("class6_road");
    expect(route?.routeKind).toBe("offroad_class6_road");
    expect(route?.offroad?.legalDisplayLabel).toBe("Unmaintained road");
    expect(route?.source).toBe("nhdot_legislative_class");
    expect(route?.sourceKey).toBe("nhdot_legislative_class/42");
    expect(route?.name).toContain("Bean Road");
  });

  it("rejects non-VI legislative class", () => {
    const route = normalizeNhdotRoadFeatureToInventoryRoute(
      {
        type: "Feature",
        properties: { OBJECTID: 1, LEGIS_CLASS: "IV", STREET: "Main St" },
        geometry: { type: "LineString", coordinates: [[-72.29, 43.65], [-72.288, 43.651]] },
      },
      { importRunId: "test" }
    );
    expect(route).toBeNull();
  });
});
