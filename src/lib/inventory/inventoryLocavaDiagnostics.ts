import { LOCAVA_CLASSIFIER_ALGORITHM_VERSION } from "./inventoryLocavaTypes.js";
import { buildLocavaFilterAudit } from "./inventoryFilterAudit.js";
import type {
  LocavaClassificationResult,
  LocavaClassifierConfig,
  LocavaInventoryRoute,
  LocavaInventorySpot,
  LocavaRejectedItem,
} from "./inventoryLocavaTypes.js";
import type { InventoryBbox } from "../../contracts/entities/inventory-entities.contract.js";

export type LocavaDiagnosticsJson = {
  algorithmVersion: string;
  generatedAt: string;
  config: LocavaClassifierConfig;
  region: {
    regionKey: string;
    label: string;
    bbox: InventoryBbox;
  };
  run: {
    runId: string;
    source: "overpass" | "fixture" | "geojson";
    rawObjects: number;
    acceptedSpots: number;
    acceptedRoutes: number;
    rejected: number;
    duplicatesSuppressed: number;
    coordinateWarnings: number;
    likelySwappedCoordinates: number;
    missingGeometry: number;
    outsideBbox: number;
  };
  acceptedBreakdown: {
    spotsByCategory: Record<string, number>;
    routesByActivity: Record<string, number>;
    byDisplayPriority: Record<string, number>;
    byConfidence: Record<string, number>;
    byShowAtZoom: Record<string, number>;
  };
  rejectionBreakdown: {
    byReason: Record<string, number>;
    byRawType: Record<string, number>;
    topRejectedTagCombos: Array<{ combo: string; count: number }>;
  };
  quality: {
    scoreHistogram: Record<string, number>;
    lowestAccepted: Array<Record<string, unknown>>;
    highestRejected: Array<Record<string, unknown>>;
    possibleFalsePositives: Array<Record<string, unknown>>;
    possibleFalseNegatives: Array<Record<string, unknown>>;
  };
  samples: {
    heroSpots: Array<Record<string, unknown>>;
    highSpots: Array<Record<string, unknown>>;
    mediumSpots: Array<Record<string, unknown>>;
    heroRoutes: Array<Record<string, unknown>>;
    highRoutes: Array<Record<string, unknown>>;
    mediumRoutes: Array<Record<string, unknown>>;
    rejectedInfrastructure: Array<Record<string, unknown>>;
    rejectedBuildings: Array<Record<string, unknown>>;
    rejectedRoads: Array<Record<string, unknown>>;
    rejectedFoodOrLocal: Array<Record<string, unknown>>;
    rejectedNature: Array<Record<string, unknown>>;
    duplicates: Array<Record<string, unknown>>;
    coordinateWarnings: Array<Record<string, unknown>>;
  };
  debugQuestionsForReview: string[];
  filterAudit?: import("./inventoryFilterAudit.js").LocavaFilterAudit;
  trailDiagnostics?: Record<string, unknown>;
  finalPolishDiagnostics?: import("./inventoryFinalPolishDiagnostics.js").FinalPolishDiagnostics;
  existingMediaDiagnostics?: import("./media/inventoryExistingMediaDiagnostics.js").ExistingMediaDiagnostics;
  offroadDiagnostics?: import("./offroad/inventoryOffroadDiagnostics.js").OffroadDiagnostics;
  placeHierarchyDiagnostics?: import("./inventoryPlaceHierarchy.js").PlaceHierarchyDiagnostics;
  parkingDiagnostics?: import("./inventoryParking.js").ParkingDiagnostics;
  activityTitleDiagnostics?: import("./inventoryActivityTitleDiagnostics.js").ActivityTitleDiagnostics;
};

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function scoreBucket(score: number): string {
  if (score < 20) return "0-19";
  if (score < 40) return "20-39";
  if (score < 60) return "40-59";
  if (score < 80) return "60-79";
  return "80-100";
}

function spotSample(spot: LocavaInventorySpot): Record<string, unknown> {
  return {
    name: spot.displayName ?? spot.name,
    rawName: spot.rawName,
    category: spot.category,
    score: spot.locavaScore,
    confidence: spot.confidence,
    displayPriority: spot.displayPriority,
    sourceKey: spot.sourceKey,
    lat: spot.lat,
    lng: spot.lng,
    anchor: spot.primaryAnchor?.anchorType,
    nameQuality: spot.nameQuality,
    reason: spot.classificationReason,
    negativeSignals: spot.negativeSignals.slice(0, 5),
  };
}

function routeSample(route: LocavaInventoryRoute): Record<string, unknown> {
  return {
    name: route.name,
    activity: route.activity,
    score: route.locavaScore,
    confidence: route.confidence,
    displayPriority: route.displayPriority,
    sourceKey: route.sourceKey,
    pointCount: route.coordinates?.length ?? route.segments?.flat().length ?? 0,
    distanceMeters: route.distanceMeters,
    reason: route.classificationReason,
  };
}

function rejectedSample(item: LocavaRejectedItem): Record<string, unknown> {
  return {
    name: item.name,
    rawTypeLabel: item.rawTypeLabel,
    score: item.locavaScore,
    rejectionReason: item.rejectionReason,
    sourceKey: item.sourceKey,
    negativeSignals: item.negativeSignals.slice(0, 5),
    tagSignals: item.tagSignals.slice(0, 5),
  };
}

export function buildLocavaDiagnosticsJson(input: {
  runId: string;
  source: "overpass" | "fixture" | "geojson";
  region: { regionKey: string; label: string; bbox: InventoryBbox };
  config: LocavaClassifierConfig;
  rawObjects: number;
  spots: LocavaInventorySpot[];
  routes: LocavaInventoryRoute[];
  rejected: LocavaRejectedItem[];
  classifications: LocavaClassificationResult[];
  duplicatesSuppressed: number;
  duplicateDiagnostics: Array<{ kept: string; suppressed: string; reason: string }>;
  coordinateWarnings?: number;
  likelySwappedCoordinates?: number;
  missingGeometry?: number;
  outsideBbox?: number;
  trailDiagnostics?: Record<string, unknown>;
  finalPolishDiagnostics?: import("./inventoryFinalPolishDiagnostics.js").FinalPolishDiagnostics;
  offroadDiagnostics?: import("./offroad/inventoryOffroadDiagnostics.js").OffroadDiagnostics;
  placeHierarchyDiagnostics?: import("./inventoryPlaceHierarchy.js").PlaceHierarchyDiagnostics;
  parkingDiagnostics?: import("./inventoryParking.js").ParkingDiagnostics;
  activityTitleDiagnostics?: import("./inventoryActivityTitleDiagnostics.js").ActivityTitleDiagnostics;
}): LocavaDiagnosticsJson {
  const allAccepted = [...input.spots, ...input.routes];
  const allScores = [...input.classifications.map((c) => c.locavaScore)];

  const scoreHistogram: Record<string, number> = {
    "0-19": 0,
    "20-39": 0,
    "40-59": 0,
    "60-79": 0,
    "80-100": 0,
  };
  for (const score of allScores) {
    scoreHistogram[scoreBucket(score)] = (scoreHistogram[scoreBucket(score)] ?? 0) + 1;
  }

  const acceptedSorted = allAccepted
    .map((item) => ({ name: "name" in item ? item.name : "", score: item.locavaScore, item }))
    .sort((a, b) => a.score - b.score);

  const rejectedSorted = input.rejected.slice().sort((a, b) => b.locavaScore - a.locavaScore);

  const possibleFalsePositives = input.spots
    .filter((s) => s.negativeSignals.length >= 2 || s.locavaScore < 55)
    .slice(0, 15)
    .map(spotSample);

  const possibleFalseNegatives = input.rejected
    .filter(
      (r) =>
        r.locavaScore >= 35 ||
        r.tagSignals.some((s) => s.includes("viewpoint") || s.includes("cafe") || s.includes("path"))
    )
    .slice(0, 15)
    .map(rejectedSample);

  const tagComboCounts = countBy(input.rejected, (r) => r.rawTypeLabel);
  const topRejectedTagCombos = Object.entries(tagComboCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([combo, count]) => ({ combo, count }));

  const filterAudit = buildLocavaFilterAudit({ spots: input.spots, routes: input.routes, rejected: input.rejected });

  return {
    algorithmVersion: LOCAVA_CLASSIFIER_ALGORITHM_VERSION,
    generatedAt: new Date().toISOString(),
    config: input.config,
    region: input.region,
    run: {
      runId: input.runId,
      source: input.source,
      rawObjects: input.rawObjects,
      acceptedSpots: input.spots.length,
      acceptedRoutes: input.routes.length,
      rejected: input.rejected.length,
      duplicatesSuppressed: input.duplicatesSuppressed,
      coordinateWarnings: input.coordinateWarnings ?? 0,
      likelySwappedCoordinates: input.likelySwappedCoordinates ?? 0,
      missingGeometry: input.missingGeometry ?? 0,
      outsideBbox: input.outsideBbox ?? 0,
    },
    acceptedBreakdown: {
      spotsByCategory: countBy(input.spots, (s) => s.category),
      routesByActivity: countBy(input.routes, (r) => r.activity),
      byDisplayPriority: countBy(allAccepted, (a) => a.displayPriority),
      byConfidence: countBy(allAccepted, (a) => a.confidence),
      byShowAtZoom: countBy(allAccepted, (a) => String(a.showAtZoom)),
    },
    rejectionBreakdown: {
      byReason: countBy(input.rejected, (r) => r.rejectionReason),
      byRawType: countBy(input.rejected, (r) => r.rawTypeLabel),
      topRejectedTagCombos,
    },
    quality: {
      scoreHistogram,
      lowestAccepted: acceptedSorted.slice(0, 15).map((x) => spotSample(x.item as LocavaInventorySpot)),
      highestRejected: rejectedSorted.slice(0, 15).map(rejectedSample),
      possibleFalsePositives,
      possibleFalseNegatives,
    },
    samples: {
      heroSpots: input.spots.filter((s) => s.displayPriority === "hero").slice(0, 10).map(spotSample),
      highSpots: input.spots.filter((s) => s.displayPriority === "high").slice(0, 10).map(spotSample),
      mediumSpots: input.spots.filter((s) => s.displayPriority === "medium").slice(0, 10).map(spotSample),
      heroRoutes: input.routes.filter((r) => r.displayPriority === "hero").slice(0, 10).map(routeSample),
      highRoutes: input.routes.filter((r) => r.displayPriority === "high").slice(0, 10).map(routeSample),
      mediumRoutes: input.routes.filter((r) => r.displayPriority === "medium").slice(0, 10).map(routeSample),
      rejectedInfrastructure: input.rejected
        .filter((r) => /highway|aeroway|power|building|service|residential/.test(r.rawTypeLabel))
        .slice(0, 10)
        .map(rejectedSample),
      rejectedBuildings: input.rejected.filter((r) => r.rawTypeLabel.startsWith("building=")).slice(0, 10).map(rejectedSample),
      rejectedRoads: input.rejected.filter((r) => r.rawTypeLabel.startsWith("highway=")).slice(0, 10).map(rejectedSample),
      rejectedFoodOrLocal: input.rejected.filter((r) => r.rawTypeLabel.includes("amenity=")).slice(0, 10).map(rejectedSample),
      rejectedNature: input.rejected.filter((r) => /natural=|leisure=|wetland/.test(r.rawTypeLabel)).slice(0, 10).map(rejectedSample),
      duplicates: input.duplicateDiagnostics.slice(0, 20).map((d) => ({ ...d })),
      coordinateWarnings: [],
    },
    debugQuestionsForReview: [
      "Are too many restaurants/fast food chains included?",
      "Are sidewalks being imported as trails?",
      "Are parks/wetlands/water bodies becoming dots correctly?",
      "Are hiking routes becoming lines?",
      "Are useful unnamed trails being hidden or rejected?",
      "Are obvious junk infrastructure objects rejected?",
    ],
    filterAudit,
    trailDiagnostics: input.trailDiagnostics,
    finalPolishDiagnostics: input.finalPolishDiagnostics,
    offroadDiagnostics: input.offroadDiagnostics,
    placeHierarchyDiagnostics: input.placeHierarchyDiagnostics,
    parkingDiagnostics: input.parkingDiagnostics,
    activityTitleDiagnostics: input.activityTitleDiagnostics,
  };
}

export function diagnosticsJsonString(diagnostics: LocavaDiagnosticsJson): string {
  return JSON.stringify(diagnostics, null, 2);
}
