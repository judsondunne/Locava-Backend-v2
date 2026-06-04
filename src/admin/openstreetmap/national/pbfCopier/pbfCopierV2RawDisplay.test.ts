import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import {
  enrichHikingTrailLineRoute,
  isHikingTrailPreviewDoc,
  isResidentialHomeOnly,
  mergeHikingTrailPreviewDocs,
  postProcessRawOsmPreviewDocs,
} from "./pbfCopierV2RawDisplay.js";

function routeDoc(overrides: Partial<PbfCopierPreviewDoc> & { displayName: string }): PbfCopierPreviewDoc {
  const { displayName, ...rest } = overrides;
  return {
    id: "way/1",
    kind: "unexplored_route",
    collection: "unexploredRoutes",
    displayName,
    primaryActivity: "hiking",
    activities: ["hiking"],
    primaryCategory: "path",
    lat: 43.64,
    lng: -72.41,
    sourceFamily: "raw",
    sourceKeys: ["way/1"],
    sourceIds: ["1"],
    osmType: "way",
    osmId: 1,
    origin: "generated_osm",
    mapReadiness: "review",
    publicMapEligible: false,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: "test",
    importPipelineVersion: "test",
    pbfFilePath: "/tmp/test.pbf",
    sourceProvider: "pbf",
    sourceTagSample: { highway: "path", name: displayName },
    warnings: ["v2_raw_osm_unfiltered"],
    routeLineCoordinates: rest.routeLineCoordinates ?? [
      { lat: 43.64, lng: -72.41 },
      { lat: 43.641, lng: -72.409 },
    ],
    ...rest,
  } as PbfCopierPreviewDoc;
}

function spotDoc(tags: Record<string, string>, displayName: string): PbfCopierPreviewDoc {
  return {
    id: "way/99",
    kind: "unexplored_spot",
    collection: "unexploredSpots",
    displayName,
    primaryActivity: null,
    activities: [],
    primaryCategory: "building",
    lat: 43.64,
    lng: -72.41,
    sourceFamily: "raw",
    sourceKeys: ["way/99"],
    sourceIds: ["99"],
    osmType: "way",
    osmId: 99,
    origin: "generated_osm",
    mapReadiness: "review",
    publicMapEligible: false,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: "test",
    importPipelineVersion: "test",
    pbfFilePath: "/tmp/test.pbf",
    sourceProvider: "pbf",
    sourceTagSample: tags,
    warnings: ["v2_raw_osm_unfiltered"],
  };
}

describe("pbfCopierV2RawDisplay", () => {
  it("isResidentialHomeOnly drops plain houses but keeps destinations", () => {
    expect(isResidentialHomeOnly({ building: "house" })).toBe(true);
    expect(isResidentialHomeOnly({ building: "yes", "addr:housenumber": "355" })).toBe(true);
    expect(
      isResidentialHomeOnly({ building: "yes", man_made: "tower", "tower:type": "observation", name: "Platform" })
    ).toBe(false);
    expect(isResidentialHomeOnly({ building: "commercial", shop: "bakery" })).toBe(false);
  });

  it("isHikingTrailPreviewDoc detects path ways", () => {
    expect(isHikingTrailPreviewDoc(routeDoc({ displayName: "McKnight Trail" }))).toBe(true);
    expect(
      isHikingTrailPreviewDoc(
        routeDoc({
          displayName: "Main St",
          sourceTagSample: { highway: "residential" },
        })
      )
    ).toBe(false);
    expect(
      isHikingTrailPreviewDoc(
        routeDoc({
          displayName: "Laughlin Connector",
          sourceTagSample: { highway: "track", foot: "yes", name: "Laughlin Connector" },
        })
      )
    ).toBe(true);
  });

  it("enrichHikingTrailLineRoute assigns color and trailhead for unnamed path segments", () => {
    const unnamed = routeDoc({
      id: "way/20",
      displayName: "highway=path",
      osmId: 20,
      sourceTagSample: { highway: "path", foot: "yes" },
      warnings: ["v2_raw_osm_unfiltered", "v2_line_no_marker"],
    });
    const enriched = enrichHikingTrailLineRoute(unnamed);
    expect(enriched.routeLineColor).toMatch(/^#/);
    expect(enriched.routeMarkerCoordinate?.lat).toBeCloseTo(43.64, 4);
    expect(enriched.primaryActivity).toBe("hiking");
  });

  it("postProcessRawOsmPreviewDocs merges named hiking segments and filters homes", () => {
    const segA = routeDoc({
      id: "way/10",
      displayName: "Laughlin Trail",
      osmId: 10,
      routeLineCoordinates: [
        { lat: 43.64, lng: -72.41 },
        { lat: 43.641, lng: -72.409 },
      ],
    });
    const segB = routeDoc({
      id: "way/11",
      displayName: "Laughlin Trail",
      osmId: 11,
      routeLineCoordinates: [
        { lat: 43.641, lng: -72.409 },
        { lat: 43.642, lng: -72.408 },
      ],
    });
    const home = spotDoc({ building: "house" }, "Private Home");
    const platform = spotDoc(
      { man_made: "tower", "tower:type": "observation", name: "Barrette Family Interpretive Platform" },
      "Barrette Family Interpretive Platform"
    );

    const result = postProcessRawOsmPreviewDocs([segA, segB, home, platform]);

    expect(result.residentialHomesFiltered).toBe(1);
    expect(result.hikingTrailGroupsMerged).toBe(1);
    expect(result.hikingTrailSegmentsCollapsed).toBe(1);
    expect(result.items.filter((d) => d.kind === "unexplored_spot")).toHaveLength(1);
    const trail = result.items.find((d) => d.warnings?.includes("v2_hiking_trail_merged"));
    expect(trail?.displayName).toBe("Laughlin Trail");
    expect(trail?.routeLineCoordinates?.length).toBeGreaterThanOrEqual(3);
    expect(trail?.routeLineColor).toBeTruthy();
  });

  it("mergeHikingTrailPreviewDocs anchors marker at trail start", () => {
    const merged = mergeHikingTrailPreviewDocs([
      routeDoc({
        displayName: "Knight Trail",
        routeLineCoordinates: [
          { lat: 43.65, lng: -72.42 },
          { lat: 43.651, lng: -72.419 },
        ],
      }),
    ]);
    expect(merged.lat).toBeCloseTo(43.65, 4);
    expect(merged.lng).toBeCloseTo(-72.42, 4);
    expect(merged.warnings).toContain("v2_hiking_trail_merged");
  });
});
