import { describe, expect, it } from "vitest";
import {
  createHillPeakTrailSpatialIndex,
  evaluateHillPeakSpatialGate,
  isOsmBareHillOrPeakTags,
  registerHikingTrailOnSpatialIndex,
  registerViewpointOnSpatialIndex,
} from "./inventoryHillPeakGate.js";
import { classifyOsmFeatureForLocava } from "./inventoryLocavaClassifier.js";
import { DEFAULT_LOCAVA_CLASSIFIER_CONFIG } from "./inventoryLocavaTypes.js";

describe("inventoryHillPeakGate", () => {
  it("detects bare hill/peak tags", () => {
    expect(isOsmBareHillOrPeakTags({ natural: "hill", name: "Random Hill" })).toBe(true);
    expect(isOsmBareHillOrPeakTags({ natural: "peak", name: "Summit" })).toBe(true);
    expect(isOsmBareHillOrPeakTags({ tourism: "viewpoint", name: "Lookout" })).toBe(false);
    expect(isOsmBareHillOrPeakTags({ natural: "peak", tourism: "viewpoint" })).toBe(false);
  });

  it("accepts peak near indexed hiking trail and rejects isolated peak", () => {
    const index = createHillPeakTrailSpatialIndex();
    registerHikingTrailOnSpatialIndex(index, {
      tags: { highway: "path" },
      geometryKind: "line",
      lat: 43.7,
      lng: -72.3,
      coordinates: [
        { lat: 43.7, lng: -72.31 },
        { lat: 43.701, lng: -72.3 },
      ],
    });
    expect(evaluateHillPeakSpatialGate(index, 43.7005, -72.3005).accept).toBe(true);
    expect(evaluateHillPeakSpatialGate(index, 44.5, -71.0).accept).toBe(false);
  });

  it("suppresses bare peak when a viewpoint is at the same spot", () => {
    const index = createHillPeakTrailSpatialIndex();
    registerViewpointOnSpatialIndex(index, 43.7, -72.3);
    registerHikingTrailOnSpatialIndex(index, {
      tags: { highway: "path" },
      geometryKind: "line",
      lat: 43.7,
      lng: -72.3,
      coordinates: [
        { lat: 43.7, lng: -72.31 },
        { lat: 43.701, lng: -72.3 },
      ],
    });
    const gate = evaluateHillPeakSpatialGate(index, 43.7, -72.3);
    expect(gate.accept).toBe(false);
    expect(gate.reason).toBe("suppressed_by_nearby_viewpoint");
  });
});

describe("classifier hill/peak policy", () => {
  it("rejects bare natural=hill and bare natural=peak", () => {
    const hill = classifyOsmFeatureForLocava(
      {
        sourceKey: "node/1",
        sourceType: "node",
        sourceId: "1",
        name: "Random Hill",
        tags: { natural: "hill", name: "Random Hill" },
        geometryKind: "point",
        lat: 43.7,
        lng: -72.3,
      },
      DEFAULT_LOCAVA_CLASSIFIER_CONFIG
    );
    expect(hill.decision).toBe("reject");
    expect(hill.rejectionReason).toBe("bare_hill_no_trail_or_viewpoint");

    const peak = classifyOsmFeatureForLocava(
      {
        sourceKey: "node/2",
        sourceType: "node",
        sourceId: "2",
        name: "Lonely Summit",
        tags: { natural: "peak", name: "Lonely Summit" },
        geometryKind: "point",
        lat: 43.7,
        lng: -72.3,
      },
      DEFAULT_LOCAVA_CLASSIFIER_CONFIG
    );
    expect(peak.decision).toBe("reject");
    expect(peak.rejectionReason).toBe("bare_peak_no_trail_or_viewpoint");
  });

  it("accepts tourism=viewpoint and peak with nearbyHikingTrail flag", () => {
    const vp = classifyOsmFeatureForLocava(
      {
        sourceKey: "node/3",
        sourceType: "node",
        sourceId: "3",
        name: "Lookout",
        tags: { tourism: "viewpoint", name: "Lookout" },
        geometryKind: "point",
        lat: 43.7,
        lng: -72.3,
      },
      DEFAULT_LOCAVA_CLASSIFIER_CONFIG
    );
    expect(vp.decision).toBe("spot");

    const peakNearTrail = classifyOsmFeatureForLocava(
      {
        sourceKey: "node/4",
        sourceType: "node",
        sourceId: "4",
        name: "Trail Summit",
        tags: { natural: "peak", name: "Trail Summit" },
        geometryKind: "point",
        lat: 43.7,
        lng: -72.3,
        nearbyHikingTrail: true,
      },
      DEFAULT_LOCAVA_CLASSIFIER_CONFIG
    );
    expect(peakNearTrail.decision).toBe("spot");
  });
});
