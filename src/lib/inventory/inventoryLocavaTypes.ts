export const LOCAVA_CLASSIFIER_ALGORITHM_VERSION = "locava_osm_classifier_v2";

export type LocavaDecision = "spot" | "route" | "reject";
export type LocavaConfidence = "high" | "medium" | "low";
export type LocavaDisplayPriority = "hero" | "high" | "medium" | "low" | "hidden";
export type LocavaGeometryIntent = "dot" | "line" | "area_center" | "none";
export type LocavaFoodMode = "local_only" | "all_named_food";
export type LocavaTrailMode = "recreation_only" | "all_paths";
export type LocavaNatureMode = "named_or_recreational" | "broad_natural";

export type LocavaClassifierConfig = {
  foodMode: LocavaFoodMode;
  trailMode: LocavaTrailMode;
  natureMode: LocavaNatureMode;
};

export const DEFAULT_LOCAVA_CLASSIFIER_CONFIG: LocavaClassifierConfig = {
  foodMode: "local_only",
  trailMode: "recreation_only",
  natureMode: "named_or_recreational",
};

export type LocavaClassifierFeatureInput = {
  sourceKey: string;
  sourceType: "node" | "way" | "relation" | "geojson" | "unknown";
  sourceId: string;
  name: string | null;
  normalizedName?: string;
  tags: Record<string, string>;
  geometryKind: "point" | "line" | "polygon" | "unknown";
  lat?: number;
  lng?: number;
  coordinates?: Array<{ lat: number; lng: number }>;
  closed?: boolean;
  rawTypeLabel?: string;
  coordValid?: boolean;
  coordSwapped?: boolean;
};

export type LocavaClassificationResult = {
  sourceKey: string;
  sourceType: LocavaClassifierFeatureInput["sourceType"];
  sourceId: string;
  name: string | null;
  normalizedName: string | null;
  decision: LocavaDecision;
  confidence: LocavaConfidence;
  locavaScore: number;
  primaryCategory: string | null;
  secondaryCategories: string[];
  activities: string[];
  geometryIntent: LocavaGeometryIntent;
  reason: string;
  rejectionReason?: string;
  displayPriority: LocavaDisplayPriority;
  showAtZoom: number;
  tagSignals: string[];
  negativeSignals: string[];
  warnings: string[];
  diagnostics: {
    spotScore: number;
    routeScore: number;
    hardReject: boolean;
    visitorOverride: boolean;
  };
};

export type LocavaInventorySpot = {
  id: string;
  kind: "inventory_spot";
  name: string;
  normalizedName: string;
  category: string;
  categories: string[];
  activities: string[];
  lat: number;
  lng: number;
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  source: string;
  sourceType: string;
  sourceId: string;
  sourceKey: string;
  hasMedia: false;
  status: "active";
  locavaScore: number;
  confidence: LocavaConfidence;
  displayPriority: LocavaDisplayPriority;
  showAtZoom: number;
  classificationReason: string;
  tagSignals: string[];
  negativeSignals: string[];
  rejectionReason: null;
  tags: Record<string, string>;
  attribution: { provider: "openstreetmap"; license: "ODbL" };
};

export type LocavaInventoryRoute = {
  id: string;
  kind: "inventory_route";
  routeKind: "full_trail" | "route_relation" | "named_way_group" | "park_trail_network" | "single_way_segment";
  name: string;
  normalizedName: string;
  activity: string;
  categories: string[];
  activities: string[];
  center: { lat: number; lng: number };
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  distanceMeters: number;
  distanceMiles: number;
  distanceLabel: string;
  geometryType: "LineString" | "MultiLineString";
  coordinates?: Array<{ lat: number; lng: number }>;
  segments?: Array<Array<{ lat: number; lng: number }>>;
  encodedPolyline?: string;
  source: string;
  sourceType: string;
  sourceId: string;
  sourceKey: string;
  sourceKeys: string[];
  memberWayIds: string[];
  hasMedia: false;
  status: "active";
  locavaScore: number;
  confidence: LocavaConfidence;
  displayPriority: LocavaDisplayPriority;
  showAtZoom: number;
  selectedTrailhead: {
    lat: number;
    lng: number;
    source: string;
    name: string | null;
    sourceKey: string;
    distanceToTrailMeters: number;
  } | null;
  selectedParking: {
    lat: number;
    lng: number;
    name: string | null;
    sourceKey: string;
    distanceToTrailheadMeters: number;
    access?: string | null;
  } | null;
  parkingCandidates: Array<{ lat: number; lng: number; name: string | null; sourceKey: string; distanceToTrailMeters: number }>;
  trailheadCandidates: Array<{ lat: number; lng: number; name: string | null; sourceKey: string; source: string; distanceToTrailMeters: number }>;
  assemblyWarnings: string[];
  classificationReason: string;
  tagSignals: string[];
  negativeSignals: string[];
  rejectionReason: null;
  tags: Record<string, string>;
  attribution: { provider: "openstreetmap"; license: "ODbL" };
  importRunId: string;
  createdAt: string;
  updatedAt: string;
};

export type LocavaRejectedItem = {
  sourceKey: string;
  sourceId: string;
  name: string | null;
  sourceType: string;
  coordinatesSummary: string | null;
  rawTypeLabel: string;
  topTags: Record<string, string>;
  locavaScore: number;
  decision: "reject";
  rejectionReason: string;
  tagSignals: string[];
  negativeSignals: string[];
  warnings: string[];
  lat?: number;
  lng?: number;
  coordinates?: Array<{ lat: number; lng: number }>;
};

export type LocavaDedupeResult = {
  spots: LocavaInventorySpot[];
  routes: LocavaInventoryRoute[];
  duplicatesSuppressed: number;
  duplicateDiagnostics: Array<{ kept: string; suppressed: string; reason: string }>;
};
