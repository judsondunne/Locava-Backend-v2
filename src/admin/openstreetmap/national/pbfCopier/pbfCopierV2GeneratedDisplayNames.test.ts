import { describe, expect, it } from "vitest";
import {
  enrichUnnamedOutdoorDisplayNames,
  inferGeneratedOutdoorName,
  shouldRejectUnnamedBusinessOrBuilding,
} from "./pbfCopierV2GeneratedDisplayNames.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

function spotDoc(tags: Record<string, string>, displayName = ""): PbfCopierPreviewDoc {
  return {
    id: "test",
    kind: "unexplored_spot",
    collection: "unexploredSpots",
    displayName,
    primaryActivity: "osm",
    activities: [],
    primaryCategory: "osm",
    lat: 43.6,
    lng: -72.5,
    center: { lat: 43.6, lng: -72.5 },
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
    importRunId: "test",
    importPipelineVersion: "test",
    pbfFilePath: "/tmp/test.osm.pbf",
    sourceProvider: "osm",
    sourceTagSample: tags,
  };
}

describe("pbfCopierV2GeneratedDisplayNames", () => {
  it("generates Beach for unnamed natural=beach", () => {
    expect(inferGeneratedOutdoorName({ natural: "beach" })?.displayName).toBe("Beach");
    const [enriched] = enrichUnnamedOutdoorDisplayNames([spotDoc({ natural: "beach" })]);
    expect(enriched!.displayName).toBe("Beach");
    expect(enriched!.warnings).toContain("v2_generated_outdoor_name");
  });

  it("rejects unnamed shop but accepts unnamed viewpoint", () => {
    expect(shouldRejectUnnamedBusinessOrBuilding({ shop: "clothes" })).toBe(true);
    expect(shouldRejectUnnamedBusinessOrBuilding({ tourism: "viewpoint" })).toBe(false);
  });

  it("generates sport-specific and shelter names", () => {
    expect(inferGeneratedOutdoorName({ leisure: "pitch", sport: "tennis" })?.displayName).toBe("Tennis Court");
    expect(inferGeneratedOutdoorName({ leisure: "skate_park" })?.displayName).toBe("Skate Park");
    const [shelter] = enrichUnnamedOutdoorDisplayNames([spotDoc({ amenity: "shelter" })]);
    expect(shelter!.displayName).toBe("Shelter");
    expect(shelter!.warnings).toContain("v2_generated_outdoor_name");
    const [peak] = enrichUnnamedOutdoorDisplayNames([spotDoc({ natural: "peak", ele: "1200" })]);
    expect(peak!.displayName).toBe("Summit");
  });
});
