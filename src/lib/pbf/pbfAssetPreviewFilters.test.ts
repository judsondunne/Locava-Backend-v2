import { describe, expect, it } from "vitest";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import {
  isJunkAssetPreviewName,
  selectPbfAssetPreviewCandidates,
} from "./pbfAssetPreviewFilters.js";

function doc(displayName: string, overrides: Partial<PbfCopierPreviewDoc> = {}): PbfCopierPreviewDoc {
  return {
    id: `id-${displayName}`,
    kind: "unexplored_spot",
    collection: "unexploredSpots",
    displayName,
    primaryActivity: "hiking",
    activities: ["hiking"],
    primaryCategory: "peak",
    lat: 43.1,
    lng: -73.1,
    sourceFamily: "osm",
    sourceKeys: ["osm-v2:node:1"],
    sourceIds: ["node/1"],
    osmType: "node",
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
    sourceTagSample: {},
    warnings: [],
    mapReadiness: "ready",
    ...overrides,
  };
}

describe("pbfAssetPreviewFilters", () => {
  it("flags raw OSM tag display names as junk", () => {
    expect(isJunkAssetPreviewName("aeroway=runway")).toBe(true);
    expect(isJunkAssetPreviewName("abandoned=yes")).toBe(true);
    expect(isJunkAssetPreviewName("13/31")).toBe(true);
    expect(isJunkAssetPreviewName("Bald Mountain")).toBe(false);
  });

  it("prefers named destinations over junk when selecting preview candidates", () => {
    const selection = selectPbfAssetPreviewCandidates(
      [
        doc("13/31", { kind: "unexplored_route", collection: "unexploredRoutes", osmType: "way", osmId: 10, id: "r-10" }),
        doc("abandoned=yes", { osmId: 11, id: "s-11" }),
        doc("Bald Mountain", { primaryCategory: "peak", primaryActivity: "hiking", osmId: 20, id: "s-20" }),
        doc("Paper Mill Village Bridge", {
          primaryCategory: "covered_bridge",
          sourceTagSample: { "addr:city": "Bennington" },
          osmId: 21,
          id: "s-21",
        }),
        doc("Bennington Historical Museum", {
          primaryActivity: "museum",
          primaryCategory: "museum",
          sourceTagSample: { "addr:city": "Bennington" },
          osmId: 22,
          id: "s-22",
        }),
      ],
      3,
    );

    const names = selection.selected.map((item) => item.displayName);
    expect(names).not.toContain("13/31");
    expect(names).not.toContain("abandoned=yes");
    expect(names).toContain("Bennington Historical Museum");
    expect(names).toContain("Paper Mill Village Bridge");
    expect(names).toContain("Bald Mountain");
    expect(selection.junkExcludedCount).toBeGreaterThan(0);
    expect(selection.photoQueryReadyCount).toBeGreaterThanOrEqual(3);
  });
});
