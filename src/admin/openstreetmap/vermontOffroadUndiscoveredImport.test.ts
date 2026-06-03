import { describe, expect, it } from "vitest";
import { buildVermontWritePreview, buildEligibleUnexploredRoutes, searchVermontOffroadRoutes } from "./vermontOffroadUndiscoveredImport.service.js";
import { putOffroadNationalRun } from "./offroadNationalRunStore.js";
import type { LocavaInventoryRoute } from "../../lib/inventory/inventoryLocavaTypes.js";

function mockOffroadRoute(overrides: Partial<LocavaInventoryRoute> = {}): LocavaInventoryRoute {
  return {
    source: "usfs_mvum",
    sourceType: "line",
    sourceId: "1",
    sourceKey: "mvum/1",
    sourceKeys: ["mvum/1"],
    name: "Test OHV Route",
    categories: ["offroad"],
    category: "offroad",
    activity: "offroad",
    routeKind: "offroad_ohv",
    center: { lat: 44.0, lng: -72.5 },
    bbox: { minLat: 43.99, minLng: -72.51, maxLat: 44.01, maxLng: -72.49 },
    distanceMeters: 2000,
    distanceMiles: 1.24,
    distanceLabel: "1.2 mi",
    geometryType: "line",
    encodedPolyline: "abc",
    coordinates: [{ lat: 44.0, lng: -72.5 }],
    activities: ["offroad"],
    primaryActivity: "offroad",
    activityWeights: {},
    searchableAliases: [],
    subtitle: "",
    confidence: "high",
    locavaScore: 80,
    displayPriority: "high",
    showAtZoom: 12,
    mapReadiness: "ready",
    tags: {},
    attribution: { sourceDatasetName: "usfs_mvum" },
    classificationReason: "offroad",
    tagSignals: [],
    negativeSignals: [],
    offroad: {
      accessStatus: "open",
      offroadCategory: "ohv",
      offroadConfidence: "high",
      accessWarnings: [],
      seasonalWarnings: [],
    },
    ...overrides,
  } as LocavaInventoryRoute;
}

describe("vermontOffroadUndiscoveredImport", () => {
  it("counts eligible public-ready routes in preview", () => {
    const routes = [
      mockOffroadRoute({ sourceKey: "a", mapReadiness: "ready" }),
      mockOffroadRoute({ sourceKey: "b", mapReadiness: "review" }),
      mockOffroadRoute({ sourceKey: "c", mapReadiness: "hidden", displayPriority: "hidden" }),
    ];
    const preview = buildVermontWritePreview({
      routes,
      runId: "run-test",
      includePublicOnly: true,
      includeReviewItems: false,
    });
    expect(preview.totalRoutesFetched).toBe(3);
    expect(preview.eligibleUndiscoveredPosts).toBe(1);
    expect(preview.filteredOutByPublicOnly).toBe(2);
  });

  it("respects write limit", () => {
    const routes = [
      mockOffroadRoute({ sourceKey: "a" }),
      mockOffroadRoute({ sourceKey: "b" }),
      mockOffroadRoute({ sourceKey: "c" }),
    ];
    const docs = buildEligibleUnexploredRoutes({
      routes,
      runId: "run-test",
      includePublicOnly: true,
      includeReviewItems: true,
      limit: 1,
    });
    expect(docs).toHaveLength(1);
  });

  it("searches routes by name query", () => {
    const runId = "search-test-run";
    putOffroadNationalRun({
      runId,
      stateCode: "VT",
      sourceIds: ["usfs_mvum"],
      status: "completed",
      dryRun: true,
      productionWritesBlocked: true,
      startedAt: new Date().toISOString(),
      sourceCounts: [],
      routes: [
        mockOffroadRoute({ sourceKey: "a", name: "Bear Brook Trail" }),
        mockOffroadRoute({ sourceKey: "b", name: "Town Highway 42" }),
      ],
      areaContexts: [],
      rejectedCount: 0,
    });

    const res = searchVermontOffroadRoutes({ runId, q: "bear brook", eligibleOnly: false });
    expect(res.total).toBe(1);
    expect(res.results[0]?.name).toBe("Bear Brook Trail");
  });
});
