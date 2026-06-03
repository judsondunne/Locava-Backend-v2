import { describe, expect, it } from "vitest";
import {
  buildUnexploredRouteFromInventory,
  buildUnexploredSpotFromInventory,
} from "./osmNationalDocBuilder.js";

describe("osmNationalDocBuilder post-like write shape", () => {
  it("builds unexplored spot with post-like metadata fields", () => {
    const doc = buildUnexploredSpotFromInventory({
      spot: {
        sourceType: "node",
        sourceId: "1",
        sourceKey: "node/1",
        displayName: "Cadys falls",
        name: "Cadys falls",
        rawName: "Cadys falls",
        titleQuality: "exact_name",
        primaryActivity: "waterfall",
        activities: ["waterfall", "hiking"],
        activityWeights: {},
        searchableAliases: [],
        searchText: "cadys falls",
        searchBoostTerms: [],
        category: "waterfall",
        categories: ["waterfall"],
        lat: 44.57,
        lng: -72.61,
        confidence: "high",
        locavaScore: 100,
        displayPriority: "hero",
        showAtZoom: 10,
        tags: { waterway: "waterfall", name: "Cadys falls" },
        attribution: { sourceDatasetName: "openstreetmap" },
        classificationReason: "destination_signals",
        tagSignals: [],
        negativeSignals: [],
      } as any,
      stateCode: "VT",
      runId: "run1",
      chunkId: "chunk1",
      writeMode: true,
      writeTarget: "emulator",
      includePublicOnly: true,
      includeReviewItems: true,
    });
    expect(doc).toBeTruthy();
    expect(doc?.sourceCollection).toBe("unexploredSpots");
    expect(doc?.itemType).toBe("undiscovered_spot");
    expect(doc?.title).toBe("Cadys falls");
    expect(doc?.location?.lat).toBeCloseTo(44.57);
    expect(doc?.status?.needsCapture).toBe(true);
    expect(doc?.social?.viewCount).toBe(0);
  });

  it("builds unexplored route with post-like metadata fields", () => {
    const doc = buildUnexploredRouteFromInventory({
      route: {
        source: "openstreetmap",
        sourceType: "way",
        sourceId: "12",
        sourceKey: "way/12",
        sourceKeys: ["way/12"],
        name: "Sample Trail",
        categories: ["trail"],
        category: "trail",
        activity: "hiking",
        routeKind: "hiking_trail",
        center: { lat: 44.5, lng: -72.5 },
        bbox: { minLat: 44.49, minLng: -72.51, maxLat: 44.51, maxLng: -72.49 },
        distanceMeters: 1000,
        distanceMiles: 0.62,
        distanceLabel: "0.6 mi",
        geometryType: "line",
        encodedPolyline: "abc",
        coordinates: [{ lat: 44.5, lng: -72.5 }],
        activities: ["hiking"],
        primaryActivity: "hiking",
        activityWeights: {},
        searchableAliases: [],
        subtitle: "",
        confidence: "high",
        locavaScore: 88,
        displayPriority: "high",
        showAtZoom: 12,
        tags: { highway: "path", hiking: "yes" },
        attribution: { sourceDatasetName: "openstreetmap" },
        classificationReason: "trail_route_signals",
        tagSignals: [],
        negativeSignals: [],
      } as any,
      stateCode: "VT",
      runId: "run1",
      chunkId: "chunk1",
      writeMode: true,
      writeTarget: "emulator",
      includePublicOnly: true,
      includeReviewItems: true,
    });
    expect(doc).toBeTruthy();
    expect(doc?.sourceCollection).toBe("unexploredRoutes");
    expect(doc?.itemType).toBe("undiscovered_route");
    expect(doc?.routeType).toBe("hiking_trail");
    expect(doc?.geometry?.pointCount).toBe(1);
    expect(doc?.status?.needsCapture).toBe(true);
  });
});
