export const LOCAVA_CLASSIFIER_ALGORITHM_VERSION = "locava_osm_classifier_v3";

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
  /** Set when a PBF spatial pass found hiking trail geometry near a bare peak/hill. */
  nearbyHikingTrail?: boolean;
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

export type LocavaRouteKind =
  | "full_trail"
  | "route_relation"
  | "named_way_group"
  | "park_trail_network"
  | "single_way_segment"
  | "offroad_unmaintained_road"
  | "offroad_class4_road"
  | "offroad_class6_road"
  | "offroad_legal_trail"
  | "offroad_atv_trail"
  | "offroad_4wd_track"
  | "offroad_candidate";

export type OffroadLegalDisplayLabel =
  | "Unmaintained road"
  | "Motorized route"
  | "Limited motorized route"
  | "Offroad candidate";

export type OffroadRouteFields = {
  legalDisplayLabel: OffroadLegalDisplayLabel;
  offroadCategory: string;
  offroadConfidence: "explicit" | "strong" | "medium" | "candidate";
  accessStatus: "public" | "limited" | "permissive" | "designated" | "unknown" | "private" | "restricted";
  accessWarnings: string[];
  seasonalWarnings: string[];
  sourceSignals: string[];
  vehicleSignals: {
    atv?: string;
    ohv?: string;
    ohrv?: string;
    motorcycle?: string;
    motorVehicle?: string;
    motorcar?: string;
    fourWdOnly?: boolean;
    hgv?: string;
  };
  roadClassSignals: {
    vtClass4?: boolean;
    nhClass6?: boolean;
    legalTrail?: boolean;
    classTagRaw?: string;
    maintenanceRaw?: string;
  };
  surfaceRaw?: string;
  roadClosedRaw?: string;
  pentRoadRaw?: string;
  townRouteRaw?: string;
  mapYear?: string | number;
  certYear?: string | number;
  aotMiles?: number;
  arcMiles?: number;
};

export type PlaceKind = "parent_place" | "child_feature" | "standalone_place" | "support_feature";

export type PlaceHierarchyFields = {
  placeKind?: PlaceKind;
  parentPlaceId?: string;
  parentPlaceName?: string;
  parentSourceKey?: string;
  childFeatureTypes?: string[];
  childSpotIds?: string[];
  childRouteIds?: string[];
  mainFeatureSourceKey?: string;
  displayCenter?: { lat: number; lng: number };
  entranceCenter?: { lat: number; lng: number };
  visitorCenter?: { lat: number; lng: number };
};

export type ParkingSelection = {
  lat: number;
  lng: number;
  name?: string | null;
  sourceKey?: string;
  accessStatus?: string;
  distanceToPlaceMeters?: number;
  distanceToRouteMeters?: number;
  distanceToTrailheadMeters?: number;
  notes?: string[];
};

export type TrailheadSelection = {
  lat: number;
  lng: number;
  name?: string | null;
  sourceKey?: string;
  source?: "explicit_trailhead" | "parking_near_endpoint" | "route_endpoint" | "park_entrance" | "unknown";
  distanceToRouteMeters?: number;
  distanceToPlaceMeters?: number;
  notes?: string[];
};

export type SpotParkingFields = {
  parking?: {
    hasParking: boolean;
    selectedParking?: ParkingSelection;
    parkingCandidates: ParkingSelection[];
  };
  trailhead?: {
    hasTrailhead: boolean;
    selectedTrailhead?: TrailheadSelection;
    trailheadCandidates: TrailheadSelection[];
  };
};

export type LocavaInventorySpot = {
  id: string;
  kind: "inventory_spot";
  name: string;
  displayName?: string;
  rawName?: string | null;
  normalizedName: string;
  category: string;
  categories: string[];
  activities: string[];
  lat: number;
  lng: number;
  areaCenter?: { lat: number; lng: number };
  displayCenter?: { lat: number; lng: number };
  primaryAnchor?: {
    anchorType: string;
    name?: string;
    sourceKey?: string;
    lat: number;
    lng: number;
    distanceFromAreaCenterMeters?: number;
    reason: string;
  };
  anchorQuality?: "exact" | "bbox_match" | "nearby_match" | "area_center_fallback";
  childHighlights?: Array<{
    sourceKey: string;
    type: string;
    name: string;
    displayName: string;
    lat: number;
    lng: number;
    distanceFromDisplayCenterMeters?: number;
  }>;
  parentContext?: {
    parentName?: string;
    parentCategory?: string;
    parentSourceKey?: string;
    relation: string;
    distanceMeters?: number;
  };
  nameQuality?: "osm_name" | "generated_from_parent" | "generated_from_category" | "weak_generic" | "unnamed";
  nameWarnings?: string[];
  displayNameGenerated?: boolean;
  generatedNameReason?: string;
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
  attribution: { provider: string; license: string; sourceDatasetName?: string };
} & PlaceHierarchyFields & SpotParkingFields & InventoryActivityTitleFields;

export type InventoryActivityTitleFields = {
  primaryActivity?: string | null;
  activityWeights?: Record<string, number>;
  activityReasons?: Array<{ activity: string; weight: number; reason: string; source: string }>;
  searchableAliases?: string[];
  searchText?: string;
  searchBoostTerms?: string[];
  activityConfidence?: "high" | "medium" | "low";
  activityWarnings?: string[];
  subtitle?: string;
  titleQuality?: "official" | "contextual" | "generated" | "weak" | "bad";
  titleReason?: string;
  titleWarnings?: string[];
  mapReadiness?: "ready" | "review" | "hidden";
  readinessReason?: string;
};

export type LocavaInventoryRoute = {
  id: string;
  kind: "inventory_route";
  routeKind: LocavaRouteKind;
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
  sourceDatasetName?: string;
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
  offroad?: OffroadRouteFields;
  parentPlaceId?: string;
  parentPlaceName?: string;
  parentSourceKey?: string;
  placeKind?: PlaceKind;
  assemblyWarnings: string[];
  classificationReason: string;
  tagSignals: string[];
  negativeSignals: string[];
  rejectionReason: null;
  tags: Record<string, string>;
  attribution: { provider: string; license: string; sourceDatasetName?: string };
  importRunId: string;
  createdAt: string;
  updatedAt: string;
} & InventoryActivityTitleFields;

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
