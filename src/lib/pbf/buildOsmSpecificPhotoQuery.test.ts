import { describe, expect, it } from "vitest";
import { buildOsmSpecificPhotoQuery, MIN_QUERY_SPECIFICITY_SCORE } from "./buildOsmSpecificPhotoQuery.js";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";

function baseDoc(overrides: Partial<PbfCopierPreviewDoc> = {}): PbfCopierPreviewDoc {
  return {
    id: "spot-1",
    kind: "unexplored_spot",
    collection: "unexploredSpots",
    displayName: "Quechee Covered Bridge",
    primaryActivity: "sightseeing",
    activities: ["sightseeing"],
    primaryCategory: "covered_bridge",
    lat: 43.646,
    lng: -72.408,
    sourceFamily: "osm",
    sourceKeys: ["osm-v2:way:1"],
    sourceIds: ["way/1"],
    osmType: "way",
    osmId: 1,
    origin: "generated_osm",
    publicMapEligible: true,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: "run",
    importPipelineVersion: "v2",
    pbfFilePath: "/tmp/vt.osm.pbf",
    sourceProvider: "geofabrik_pbf",
    sourceTagSample: { "addr:city": "Quechee" },
    warnings: [],
    mapReadiness: "ready",
    ...overrides,
  };
}

describe("buildOsmSpecificPhotoQuery", () => {
  it("builds a specific bridge query with town and state", () => {
    const result = buildOsmSpecificPhotoQuery(baseDoc());
    expect(result.skip).toBe(false);
    expect(result.query).toContain("Quechee Covered Bridge");
    expect(result.query).toContain("Quechee");
    expect(result.query).toContain("Vermont");
    expect(result.querySpecificityScore).toBeGreaterThanOrEqual(MIN_QUERY_SPECIFICITY_SCORE);
  });

  it("skips generic shelter without town/context", () => {
    const result = buildOsmSpecificPhotoQuery(
      baseDoc({
        displayName: "Shelter",
        primaryCategory: "shelter",
        sourceTagSample: {},
        warnings: ["v2_generated_outdoor_name"],
      }),
    );
    expect(result.skip).toBe(true);
    expect(result.skipReason).toBe("query_too_generic_no_town");
  });

  it("contextualizes weak swimming area with town", () => {
    const result = buildOsmSpecificPhotoQuery(
      baseDoc({
        displayName: "Mink Brook Swimming Area",
        primaryCategory: "swimming",
        sourceTagSample: { "addr:city": "Norwich" },
      }),
    );
    expect(result.skip).toBe(false);
    expect(result.query).toMatch(/Mink Brook Swimming Area/);
    expect(result.query).toMatch(/Norwich/);
    expect(result.query).toMatch(/Vermont/);
  });

  it("skips raw highway footway labels", () => {
    const result = buildOsmSpecificPhotoQuery(
      baseDoc({
        displayName: "highway=footway",
        primaryCategory: "hiking",
      }),
    );
    expect(result.skip).toBe(true);
  });

  it("does not treat person-name tokens in landmark titles as towns", () => {
    const result = buildOsmSpecificPhotoQuery(
      baseDoc({
        displayName: "Old Seth Warner Shelter Site",
        primaryCategory: "camp_site",
        sourceTagSample: {
          "addr:city": "Bennington",
          "addr:state": "Vermont",
          operator: "Green Mountain Club",
        },
      }),
    );
    expect(result.skip).toBe(false);
    expect(result.query).toContain("Seth Warner");
    expect(result.query).toContain("Bennington");
    expect(result.confidenceHints.some((h) => h === "town:Warner")).toBe(false);
  });

  it("adds trail context for named hiking routes", () => {
    const result = buildOsmSpecificPhotoQuery(
      baseDoc({
        kind: "unexplored_route",
        collection: "unexploredRoutes",
        displayName: "Alana Cole Loop Trail",
        primaryCategory: "hiking_trail",
        sourceTagSample: { "addr:city": "Norwich" },
      }),
    );
    expect(result.skip).toBe(false);
    expect(result.query).toMatch(/Alana Cole Loop Trail/);
    expect(result.query).toMatch(/Norwich/);
  });
});
