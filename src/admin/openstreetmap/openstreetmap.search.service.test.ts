import { describe, expect, it, beforeEach } from "vitest";
import { putOpenStreetMapClassificationRun, clearOpenStreetMapClassificationRuns } from "./openstreetmapRunStore.js";
import { searchOpenStreetMapClassification } from "./openstreetmap.search.service.js";
import type { OpenStreetMapClassificationResult } from "./openstreetmap.service.js";
import { DEFAULT_LOCAVA_CLASSIFIER_CONFIG } from "../../lib/inventory/inventoryLocavaTypes.js";

function fixtureRun(): OpenStreetMapClassificationResult {
  return {
    label: "Hartland",
    regionKey: "hartland_vt_mvp",
    bbox: { minLat: 43.45, minLng: -72.55, maxLat: 43.63, maxLng: -72.25 },
    center: { lat: 43.54, lng: -72.39 },
    source: "fixture",
    runId: "test-run",
    fetchedAt: new Date().toISOString(),
    config: DEFAULT_LOCAVA_CLASSIFIER_CONFIG,
    rawObjects: 3,
    acceptedSpots: [
      {
        id: "spot:node/1",
        kind: "inventory_spot",
        name: "Sweet Ice Cream",
        normalizedName: "sweet ice cream",
        category: "ice_cream",
        categories: ["ice_cream"],
        activities: ["food"],
        lat: 43.54,
        lng: -72.39,
        bbox: { minLat: 43.54, minLng: -72.39, maxLat: 43.54, maxLng: -72.39 },
        source: "openstreetmap",
        sourceType: "node",
        sourceId: "1",
        sourceKey: "node/1",
        hasMedia: false,
        status: "active",
        locavaScore: 80,
        confidence: "high",
        displayPriority: "high",
        showAtZoom: 12,
        classificationReason: "ice_cream",
        tagSignals: ["amenity=ice_cream"],
        negativeSignals: [],
        rejectionReason: null,
        tags: { amenity: "ice_cream", name: "Sweet Ice Cream" },
        attribution: { provider: "openstreetmap", license: "ODbL" },
      },
    ],
    acceptedRoutes: [],
    rejected: [
      {
        sourceKey: "node/2",
        sourceId: "2",
        name: "Hartland Fire Station",
        sourceType: "node",
        lat: 43.55,
        lng: -72.38,
        coordinatesSummary: "43.55,-72.38",
        rawTypeLabel: "amenity=fire_station",
        topTags: { amenity: "fire_station", name: "Hartland Fire Station" },
        locavaScore: 10,
        decision: "reject",
        rejectionReason: "civic_amenity",
        tagSignals: [],
        negativeSignals: ["civic_amenity"],
        warnings: [],
      },
    ],
    duplicatesSuppressed: 0,
    productionWritesBlocked: true,
    diagnostics: {
      algorithmVersion: "locava_osm_classifier_v2",
      samples: {
        heroSpots: [],
        highSpots: [],
        mediumSpots: [],
        heroRoutes: [],
        highRoutes: [],
        mediumRoutes: [],
        rejectedInfrastructure: [],
        rejectedBuildings: [],
        rejectedRoads: [],
        rejectedFoodOrLocal: [],
        rejectedNature: [],
        duplicates: [],
        coordinateWarnings: [],
      },
      debugQuestionsForReview: [],
      filterAudit: {
        verdict: "good",
        acceptedJunkCategories: {},
        suspiciousSpotCategories: {},
        suspiciousRouteActivities: {},
        acceptedRoadsAsSpots: [],
        acceptedInfrastructureAsSpots: [],
        acceptedCivicAsSpots: [],
        acceptedTinyRouteFragments: [],
        acceptedRoadRoutes: [],
        trailsWithoutParking: [],
        trailsWithoutFullGeometry: [],
        rejectedLikelyGoodNature: [],
        rejectedLikelyGoodFood: [],
        rejectedLikelyGoodTrails: [],
        suggestedNextRules: [],
      },
      trailDiagnostics: {
        rawRouteRelations: 0,
        rawTrailLikeWays: 0,
        fullTrailsAssembled: 0,
        relationTrails: 0,
        namedWayGroupTrails: 0,
        parkTrailNetworks: 0,
        singleWaySegments: 0,
        suppressedTinySegments: 0,
        suppressedMemberWays: 0,
        routesWithParking: 0,
        routesWithoutParking: 0,
        routesWithTrailhead: 0,
        routesWithoutTrailhead: 0,
        routesUnder100m: 0,
        routesOver1Mile: 0,
        routesOver3Miles: 0,
        averageDistanceMiles: 0,
        longestRoutes: [],
        shortestAcceptedRoutes: [],
        routesMissingParkingSamples: [],
        assembledTrailSamples: [],
        suppressedSegmentSamples: [],
        routeMapHighlightReady: true,
      },
    },
    diagnosticsJson: "{}",
    rawFeatures: [],
  } as unknown as OpenStreetMapClassificationResult;
}

describe("openstreetmap search", () => {
  beforeEach(() => {
    clearOpenStreetMapClassificationRuns();
    putOpenStreetMapClassificationRun(fixtureRun());
  });

  it("returns accepted and rejected", () => {
    const res = searchOpenStreetMapClassification({ decision: "all", limit: 50 });
    expect(res).not.toBeNull();
    expect(res!.total).toBe(2);
    expect(res!.results[0]?.decision).toBe("accepted");
    expect(res!.results[1]?.decision).toBe("rejected");
  });

  it("finds rejected fire station", () => {
    const res = searchOpenStreetMapClassification({ q: "fire station", decision: "all" });
    expect(res!.results.some((r) => r.rejectionReason != null && r.name?.includes("Fire"))).toBe(true);
  });

  it("finds accepted ice cream", () => {
    const res = searchOpenStreetMapClassification({ q: "ice cream", decision: "all" });
    expect(res!.results.some((r) => r.decision === "accepted" && r.category === "ice_cream")).toBe(true);
  });
});
