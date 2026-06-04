import type { UnexploredRoute, UnexploredSpot } from "../../../contracts/entities/osm-national-entities.contract.js";
import type { OsmNationalWriteTarget } from "./osmNationalWriteGuard.js";
import { OSM_NATIONAL_PIPELINE_VERSION } from "../../../contracts/entities/osm-national-entities.contract.js";
import { LOCAVA_CLASSIFIER_ALGORITHM_VERSION } from "../../../lib/inventory/inventoryLocavaTypes.js";
import type {
  LocavaInventoryRoute,
  LocavaInventorySpot,
} from "../../../lib/inventory/inventoryLocavaTypes.js";
import {
  buildContentHash,
  buildGeometryHash,
  buildUnexploredRouteId,
  buildUnexploredSpotId,
} from "./osmNationalDeterministicIds.js";
import { trimDocForFirestore } from "./osmNationalDocSize.js";

function mapRouteKindToClientRouteType(routeKind: string): UnexploredRoute["routeType"] {
  const k = String(routeKind ?? "").toLowerCase();
  if (k.includes("class_4") || k.includes("class4")) return "offroad_class4_road";
  if (k.includes("class_6") || k.includes("class6")) return "offroad_class6_road";
  if (k.includes("legal_trail")) return "offroad_legal_trail";
  if (k.includes("offroad")) return "offroad_candidate";
  if (k.includes("bike") || k.includes("bicycle")) return "biking_route";
  if (k.includes("walk")) return "walking_route";
  return "hiking_trail";
}

function isPublicMapEligible(input: {
  mapReadiness?: string;
  accessStatus?: string;
  displayPriority?: string;
  includePublicOnly: boolean;
  includeReviewItems: boolean;
}): boolean {
  if (input.accessStatus === "private" || input.accessStatus === "restricted") {
    return false;
  }
  if (input.displayPriority === "hidden") {
    return false;
  }
  if (input.mapReadiness === "hidden") {
    return false;
  }
  if (input.includePublicOnly) {
    return input.mapReadiness === "ready" || (input.includeReviewItems && input.mapReadiness === "review");
  }
  return input.mapReadiness !== "hidden";
}

export function buildUnexploredSpotFromInventory(input: {
  spot: LocavaInventorySpot;
  stateCode: string;
  runId: string;
  chunkId: string;
  writeMode: boolean;
  writeTarget: OsmNationalWriteTarget;
  includePublicOnly: boolean;
  includeReviewItems: boolean;
}): UnexploredSpot | null {
  const displayName = input.spot.displayName ?? input.spot.name;
  const mapReadiness = input.spot.mapReadiness ?? "review";
  const accessStatus = "unknown";
  const publicMapEligible = isPublicMapEligible({
    mapReadiness,
    accessStatus: typeof accessStatus === "string" ? accessStatus : "unknown",
    displayPriority: input.spot.displayPriority,
    includePublicOnly: input.includePublicOnly,
    includeReviewItems: input.includeReviewItems,
  });
  if (input.includePublicOnly && !publicMapEligible) {
    return null;
  }

  const now = new Date().toISOString();
  const id = buildUnexploredSpotId({
    sourceFamily: "openstreetmap",
    sourceKey: input.spot.sourceKey,
    displayName,
    lat: input.spot.lat,
    lng: input.spot.lng,
    category: input.spot.category,
    stateCode: input.stateCode,
  });

  const spot: UnexploredSpot = {
    id,
    kind: "unexplored_spot",
    itemType: "undiscovered_spot",
    sourceCollection: "unexploredSpots",
    origin: "generated_osm",
    sourceFamily: "openstreetmap",
    sourceIds: [input.spot.sourceId],
    sourceKeys: [input.spot.sourceKey],
    sourceAttribution: input.spot.attribution as Record<string, unknown>,
    sourceDatasets: input.spot.attribution.sourceDatasetName
      ? [input.spot.attribution.sourceDatasetName]
      : ["openstreetmap"],
    displayName,
    title: displayName,
    description: undefined,
    subtitle: input.spot.subtitle,
    rawName: input.spot.rawName ?? input.spot.name,
    titleQuality: input.spot.titleQuality,
    primaryActivity: input.spot.primaryActivity ?? null,
    activities: input.spot.activities,
    activityWeights: input.spot.activityWeights,
    searchableAliases: input.spot.searchableAliases,
    searchText: input.spot.searchText,
    searchBoostTerms: input.spot.searchBoostTerms,
    category: input.spot.category,
    categories: input.spot.categories,
    placeKind: input.spot.placeKind,
    parentPlaceId: input.spot.parentPlaceId,
    parentPlaceName: input.spot.parentPlaceName,
    childFeatureTypes: input.spot.childFeatureTypes,
    lat: input.spot.lat,
    lng: input.spot.lng,
    location: {
      lat: input.spot.lat,
      lng: input.spot.lng,
    },
    displayCenter: input.spot.displayCenter,
    areaCenter: input.spot.areaCenter,
    bbox: input.spot.bbox,
    mapReadiness,
    publicMapEligible,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    mediaStatus: "none",
    parking: input.spot.parking as Record<string, unknown> | undefined,
    trailhead: input.spot.trailhead as Record<string, unknown> | undefined,
    accessStatus: typeof accessStatus === "string" ? accessStatus : "unknown",
    confidence: input.spot.confidence,
    locavaScore: input.spot.locavaScore,
    displayPriority: input.spot.displayPriority,
    showAtZoom: input.spot.showAtZoom,
    sourceTags: input.spot.tags,
    source: {
      provider: "openstreetmap",
      osmType: input.spot.sourceType as "node" | "way" | "relation",
      osmId: input.spot.sourceId,
      tags: input.spot.tags as Record<string, string>,
      wikidata: (input.spot.tags?.wikidata as string | undefined) ?? undefined,
      wikipedia: (input.spot.tags?.wikipedia as string | undefined) ?? undefined,
      website: (input.spot.tags?.website as string | undefined) ?? undefined,
      image: (input.spot.tags?.image as string | undefined) ?? undefined,
      mapillary: (input.spot.tags?.mapillary as string | undefined) ?? undefined,
    },
    status: {
      undiscovered: true,
      needsCapture: true,
      hasUserMedia: false,
      publicMapEligible,
      mapReadiness,
    },
    social: {
      saveCount: 0,
      shareCount: 0,
      viewCount: 0,
    },
    rawProperties: { tags: input.spot.tags },
    classification: {
      algorithmVersion: LOCAVA_CLASSIFIER_ALGORITHM_VERSION,
      reason: input.spot.classificationReason,
      tagSignals: input.spot.tagSignals,
      negativeSignals: input.spot.negativeSignals,
      warnings: input.spot.nameWarnings ?? [],
    },
    import: {
      runId: input.runId,
      stateCode: input.stateCode,
      chunkId: input.chunkId,
      importedAt: now,
      pipelineVersion: OSM_NATIONAL_PIPELINE_VERSION,
      writeMode: input.writeMode,
      writeTarget: input.writeTarget,
    },
    audit: {
      createdBy: "national_osm_importer",
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      contentHash: "",
      geometryHash: buildGeometryHash({ bbox: input.spot.bbox }),
    },
    stateCode: input.stateCode,
  };

  spot.audit.contentHash = buildContentHash({
    id: spot.id,
    displayName: spot.displayName,
    lat: spot.lat,
    lng: spot.lng,
    category: spot.category,
  });

  const trimmed = trimDocForFirestore(spot as unknown as Record<string, unknown>);
  return trimmed.doc as unknown as UnexploredSpot;
}

export function buildUnexploredRouteFromInventory(input: {
  route: LocavaInventoryRoute;
  stateCode: string;
  runId: string;
  chunkId: string;
  writeMode: boolean;
  writeTarget: OsmNationalWriteTarget;
  includePublicOnly: boolean;
  includeReviewItems: boolean;
}): UnexploredRoute | null {
  const displayName = input.route.name;
  const mapReadiness = input.route.mapReadiness ?? "review";
  const accessStatus = input.route.offroad?.accessStatus ?? "unknown";
  const publicMapEligible = isPublicMapEligible({
    mapReadiness,
    accessStatus,
    displayPriority: input.route.displayPriority,
    includePublicOnly: input.includePublicOnly,
    includeReviewItems: input.includeReviewItems,
  });
  if (input.includePublicOnly && !publicMapEligible) {
    return null;
  }

  const geometryHash = buildGeometryHash({
    encodedPolyline: input.route.encodedPolyline,
    coordinates: input.route.coordinates,
    bbox: input.route.bbox,
  });

  const now = new Date().toISOString();
  const id = buildUnexploredRouteId({
    sourceFamily: input.route.source.includes("openstreetmap") ? "openstreetmap" : input.route.source,
    sourceKey: input.route.sourceKey,
    displayName,
    geometryHash,
    stateCode: input.stateCode,
  });

  const pointCount = input.route.coordinates?.length ?? 0;
  const segmentCount = input.route.segments?.length ?? 1;

  const route: UnexploredRoute = {
    id,
    kind: "unexplored_route",
    itemType: "undiscovered_route",
    sourceCollection: "unexploredRoutes",
    routeKind: input.route.routeKind,
    routeType: mapRouteKindToClientRouteType(input.route.routeKind),
    origin: "generated_osm",
    sourceFamily: input.route.source.includes("openstreetmap") ? "openstreetmap" : input.route.source,
    sourceIds: [input.route.sourceId],
    sourceKeys: input.route.sourceKeys,
    sourceAttribution: input.route.attribution as Record<string, unknown>,
    sourceDatasets: input.route.attribution.sourceDatasetName
      ? [input.route.attribution.sourceDatasetName]
      : [input.route.source],
    displayName,
    title: displayName,
    description: undefined,
    subtitle: input.route.subtitle,
    rawName: input.route.name,
    legalDisplayLabel: input.route.offroad?.legalDisplayLabel,
    primaryActivity: input.route.primaryActivity ?? null,
    activities: input.route.activities,
    activityWeights: input.route.activityWeights,
    searchableAliases: input.route.searchableAliases,
    category: input.route.primaryActivity ?? input.route.categories[0],
    categories: input.route.primaryActivity
      ? [input.route.primaryActivity, ...input.route.categories.filter((c) => c !== input.route.primaryActivity)]
      : input.route.categories,
    routeActivity: input.route.activity,
    offroadCategory: input.route.offroad?.offroadCategory,
    offroadConfidence: input.route.offroad?.offroadConfidence,
    accessStatus,
    accessWarnings: input.route.offroad?.accessWarnings ?? [],
    seasonalWarnings: input.route.offroad?.seasonalWarnings ?? [],
    center: input.route.center,
    location: {
      lat: input.route.center.lat,
      lng: input.route.center.lng,
    },
    bbox: input.route.bbox,
    distanceMeters: input.route.distanceMeters,
    distanceMiles: input.route.distanceMiles,
    distanceLabel: input.route.distanceLabel,
    geometryType: input.route.geometryType,
    encodedPolyline: input.route.encodedPolyline,
    simplifiedPolylines: undefined,
    coordinatesPreview: input.route.coordinates?.slice(0, 20),
    geometry: {
      pointCount,
      encodedPolyline: input.route.encodedPolyline,
      previewPoints: input.route.coordinates?.slice(0, 20),
      geometryChunked: pointCount > 500,
    },
    geometryStorage: {
      mode: pointCount > 500 ? "chunked_subcollection" : "inline",
      pointCount,
      segmentCount,
      geometryHash,
    },
    selectedTrailhead: input.route.selectedTrailhead as Record<string, unknown> | null,
    selectedParking: input.route.selectedParking as Record<string, unknown> | null,
    parkingCandidatesSummary: input.route.parkingCandidates?.slice(0, 5) as Array<Record<string, unknown>>,
    trailheadCandidatesSummary: input.route.trailheadCandidates?.slice(0, 5) as Array<Record<string, unknown>>,
    parentPlaceId: input.route.parentPlaceId,
    parentPlaceName: input.route.parentPlaceName,
    mapReadiness,
    publicMapEligible,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    confidence: input.route.confidence,
    locavaScore: input.route.locavaScore,
    displayPriority: input.route.displayPriority,
    showAtZoom: input.route.showAtZoom,
    sourceTags: input.route.tags,
    source: {
      provider: input.route.source.includes("openstreetmap") ? "openstreetmap" : "geofabrik_pbf",
      osmType: input.route.sourceType === "relation" ? "relation" : "way",
      osmId: input.route.sourceId,
      tags: input.route.tags as Record<string, string>,
    },
    status: {
      undiscovered: true,
      needsCapture: true,
      hasUserMedia: false,
      publicMapEligible,
      mapReadiness,
    },
    social: {
      saveCount: 0,
      shareCount: 0,
      viewCount: 0,
    },
    rawProperties: { tags: input.route.tags },
    classification: {
      algorithmVersion: LOCAVA_CLASSIFIER_ALGORITHM_VERSION,
      reason: input.route.classificationReason,
      tagSignals: input.route.tagSignals,
      negativeSignals: input.route.negativeSignals,
      warnings: input.route.assemblyWarnings ?? [],
    },
    import: {
      runId: input.runId,
      stateCode: input.stateCode,
      chunkId: input.chunkId,
      importedAt: now,
      pipelineVersion: OSM_NATIONAL_PIPELINE_VERSION,
      writeMode: input.writeMode,
      writeTarget: input.writeTarget,
    },
    audit: {
      createdBy: "national_osm_importer",
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      contentHash: "",
      geometryHash,
    },
    stateCode: input.stateCode,
  };

  route.audit.contentHash = buildContentHash({
    id: route.id,
    displayName: route.displayName,
    geometryHash,
    distanceMeters: route.distanceMeters,
  });

  const trimmed = trimDocForFirestore(route as unknown as Record<string, unknown>);
  return trimmed.doc as unknown as UnexploredRoute;
}

export function buildUnexploredDocsFromClassification(input: {
  spots: LocavaInventorySpot[];
  routes: LocavaInventoryRoute[];
  stateCode: string;
  runId: string;
  chunkId: string;
  writeMode: boolean;
  writeTarget: OsmNationalWriteTarget;
  includePublicOnly: boolean;
  includeReviewItems: boolean;
  includeOsmSpots: boolean;
  includeOsmRoutes: boolean;
  includeOffroad: boolean;
}): { spots: UnexploredSpot[]; routes: UnexploredRoute[] } {
  const spots: UnexploredSpot[] = [];
  const routes: UnexploredRoute[] = [];

  if (input.includeOsmSpots) {
    for (const spot of input.spots) {
      const doc = buildUnexploredSpotFromInventory({
        spot,
        stateCode: input.stateCode,
        runId: input.runId,
        chunkId: input.chunkId,
        writeMode: input.writeMode,
        writeTarget: input.writeTarget,
        includePublicOnly: input.includePublicOnly,
        includeReviewItems: input.includeReviewItems,
      });
      if (doc) spots.push(doc);
    }
  }

  if (input.includeOsmRoutes || input.includeOffroad) {
    for (const route of input.routes) {
      const isOffroad = route.routeKind.startsWith("offroad");
      if (isOffroad && !input.includeOffroad) continue;
      if (!isOffroad && !input.includeOsmRoutes) continue;
      const doc = buildUnexploredRouteFromInventory({
        route,
        stateCode: input.stateCode,
        runId: input.runId,
        chunkId: input.chunkId,
        writeMode: input.writeMode,
        writeTarget: input.writeTarget,
        includePublicOnly: input.includePublicOnly,
        includeReviewItems: input.includeReviewItems,
      });
      if (doc) routes.push(doc);
    }
  }

  return { spots, routes };
}
