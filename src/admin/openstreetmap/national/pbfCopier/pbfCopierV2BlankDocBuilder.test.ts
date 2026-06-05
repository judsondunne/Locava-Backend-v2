import { describe, expect, it } from "vitest";
import {
  buildBlankRouteFromV2Preview,
  buildBlankSpotFromV2Preview,
} from "./pbfCopierV2BlankDocBuilder.js";
import { validateUnexploredRouteForCopier, validateUnexploredSpotForCopier } from "../copier/osmNationalCopierRunner.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

const baseInput = { runId: "test-run", writeTarget: "none" as const, stateCode: "VT" };

describe("pbfCopierV2BlankDocBuilder", () => {
  it("builds valid unexplored spot from raw preview doc", () => {
    const doc: PbfCopierPreviewDoc = {
      id: "raw:node/1",
      kind: "unexplored_spot",
      collection: "unexploredSpots",
      displayName: "Pierson Peak",
      primaryActivity: "hiking",
      activities: ["hiking"],
      primaryCategory: "peak",
      lat: 43.54,
      lng: -72.39,
      sourceFamily: "openstreetmap_pbf_v2_raw",
      sourceKeys: ["node/1"],
      sourceIds: ["1"],
      osmType: "node",
      osmId: 1,
      origin: "generated_osm",
      mapReadiness: "review",
      publicMapEligible: false,
      undiscovered: true,
      needsCapture: true,
      hasUserMedia: false,
      importRunId: "v2",
      importPipelineVersion: "v2",
      pbfFilePath: "./data/osm/vermont-latest.osm.pbf",
      sourceProvider: "geofabrik",
      sourceTagSample: { natural: "peak", name: "Pierson Peak" },
      warnings: [],
    };
    const spot = buildBlankSpotFromV2Preview(doc, baseInput);
    expect(spot).toBeTruthy();
    expect(validateUnexploredSpotForCopier(spot!)).toEqual([]);
    expect(spot!.id.startsWith("unx_spot_")).toBe(true);
  });

  it("builds valid unexplored route with polyline", () => {
    const doc: PbfCopierPreviewDoc = {
      id: "raw:way/2",
      kind: "unexplored_route",
      collection: "unexploredRoutes",
      displayName: "Howland Trail",
      primaryActivity: "hiking",
      activities: ["hiking"],
      primaryCategory: "path",
      lat: 43.54,
      lng: -72.39,
      sourceFamily: "openstreetmap_pbf_v2_raw",
      sourceKeys: ["way/2"],
      sourceIds: ["2"],
      osmType: "way",
      osmId: 2,
      origin: "generated_osm",
      mapReadiness: "review",
      publicMapEligible: false,
      undiscovered: true,
      needsCapture: true,
      hasUserMedia: false,
      importRunId: "v2",
      importPipelineVersion: "v2",
      pbfFilePath: "./data/osm/vermont-latest.osm.pbf",
      sourceProvider: "geofabrik",
      sourceTagSample: { highway: "path", name: "Howland Trail" },
      warnings: [],
      routeLineCoordinates: [
        { lat: 43.54, lng: -72.39 },
        { lat: 43.541, lng: -72.388 },
        { lat: 43.542, lng: -72.386 },
      ],
    };
    const route = buildBlankRouteFromV2Preview(doc, baseInput);
    expect(route).toBeTruthy();
    expect(validateUnexploredRouteForCopier(route!)).toEqual([]);
    expect(route!.encodedPolyline).toBeTruthy();
    expect(route!.distanceMeters).toBeGreaterThan(0);
  });

  it("sets map-ready fields on production writes", () => {
    const doc: PbfCopierPreviewDoc = {
      id: "raw:node/3",
      kind: "unexplored_spot",
      collection: "unexploredSpots",
      displayName: "Test Peak",
      primaryActivity: "hiking",
      activities: ["hiking"],
      primaryCategory: "peak",
      lat: 43.54,
      lng: -72.39,
      sourceFamily: "openstreetmap_pbf_v2_raw",
      sourceKeys: ["node/3"],
      sourceIds: ["3"],
      osmType: "node",
      osmId: 3,
      origin: "generated_osm",
      mapReadiness: "review",
      publicMapEligible: false,
      undiscovered: true,
      needsCapture: true,
      hasUserMedia: false,
      importRunId: "v2",
      importPipelineVersion: "v2",
      pbfFilePath: "./data/osm/vermont-latest.osm.pbf",
      sourceProvider: "geofabrik",
      sourceTagSample: {},
      warnings: [],
    };
    const spot = buildBlankSpotFromV2Preview(doc, { ...baseInput, writeTarget: "production" });
    expect(spot?.publicMapEligible).toBe(true);
    expect(spot?.mapReadiness).toBe("ready");
  });
});
