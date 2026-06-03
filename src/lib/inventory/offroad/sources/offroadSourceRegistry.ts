import { US_STATE_BOUNDS } from "../offroadStateBounds.js";
import type { OffroadSourceRegistryEntry, OffroadStateRegistry, StateCoverageDiagnostics } from "./nationalOffroadSource.types.js";
import {
  BLM_GTLF_MAPSERVER,
  BLM_GTLF_DEFAULT_LAYERS,
} from "./blmGtlfSource.js";
import { USFS_MVUM_MAPSERVER, USFS_MVUM_ROADS_LAYER, USFS_MVUM_TRAILS_LAYER } from "./usfsMvumSource.js";
import { NHDOT_LEGISLATIVE_CLASS_ENDPOINT, NHDOT_CLASS6_OUT_FIELDS } from "./nhNhdotLegislativeClassSource.js";
import { CA_BLM_OHV_ENDPOINT } from "./offroadAreaContextSource.js";
import {
  BLM_GTLF_WARNINGS,
  OSM_OFFROAD_WARNINGS,
  STATE_CLASS_ROAD_WARNINGS,
  USFS_MVUM_WARNINGS,
} from "./nationalOffroadSource.types.js";

const FEDERAL_USFS: OffroadSourceRegistryEntry = {
  sourceId: "usfs_mvum",
  sourceName: "USFS Motor Vehicle Use Map",
  sourceType: "usfs_mvum",
  tier: 1,
  status: "active",
  endpoint: USFS_MVUM_MAPSERVER,
  layerIds: [USFS_MVUM_ROADS_LAYER, USFS_MVUM_TRAILS_LAYER],
  queryFormat: "arcgis",
  attribution: "U.S. Forest Service — Motor Vehicle Use Map (MVUM)",
  legalWarnings: USFS_MVUM_WARNINGS,
  notes: "Official designated motorized travel on National Forest System roads and trails.",
  supportsBbox: true,
  supportsStatewide: true,
  supportsPagination: true,
  maxRecordCount: 1000,
};

const FEDERAL_BLM: OffroadSourceRegistryEntry = {
  sourceId: "blm_gtlf",
  sourceName: "BLM National Ground Transportation Linear Features",
  sourceType: "blm_gtlf",
  tier: 1,
  status: "active",
  endpoint: BLM_GTLF_MAPSERVER,
  layerIds: BLM_GTLF_DEFAULT_LAYERS,
  queryFormat: "arcgis",
  attribution: "Bureau of Land Management — GTLF Public Display",
  legalWarnings: BLM_GTLF_WARNINGS,
  notes: "Public and limited public motorized roads/trails on BLM lands.",
  supportsBbox: true,
  supportsStatewide: true,
  supportsPagination: true,
  maxRecordCount: 1000,
};

const FEDERAL_OSM: OffroadSourceRegistryEntry = {
  sourceId: "osm_offroad",
  sourceName: "OpenStreetMap offroad signals",
  sourceType: "osm_offroad",
  tier: 1,
  status: "active",
  queryFormat: "overpass",
  attribution: "OpenStreetMap contributors (ODbL)",
  legalWarnings: OSM_OFFROAD_WARNINGS,
  notes: "Lower confidence unless explicit motorized access tags exist.",
  supportsBbox: true,
  supportsStatewide: true,
  supportsPagination: false,
};

function stateSpecificPlaceholder(stateCode: string): OffroadSourceRegistryEntry {
  return {
    sourceId: "state_offroad_source",
    sourceName: `${stateCode} statewide offroad source (unconfigured)`,
    sourceType: "needs_research",
    tier: 2,
    status: "needs_source",
    attribution: "TBD — official state DOT/DNR/OHV GIS",
    legalWarnings: STATE_CLASS_ROAD_WARNINGS,
    notes: "No verified official statewide offroad/Class road GIS source configured yet.",
    supportsBbox: false,
    supportsStatewide: false,
    supportsPagination: false,
  };
}

function buildStateSources(stateCode: string): OffroadSourceRegistryEntry[] {
  const federal = [FEDERAL_USFS, FEDERAL_BLM, FEDERAL_OSM];
  const code = stateCode.toUpperCase();

  if (code === "VT") {
    return [
      ...federal,
      {
        sourceId: "vt_vtrans_public_highway_system",
        sourceName: "VTrans PublicHighwaySystem Local Roads",
        sourceType: "state_arcgis",
        tier: 2,
        status: "active",
        endpoint:
          "https://maps.vtrans.vermont.gov/arcgis/rest/services/Layers/PublicHighwaySystem/MapServer/6/query",
        layerIds: [6],
        queryFormat: "arcgis",
        whereClause: "AOTCLASS IN (4,7)",
        attribution: "Vermont Agency of Transportation — Public Highway System",
        legalWarnings: STATE_CLASS_ROAD_WARNINGS,
        notes: "AOTCLASS 4 = Class 4 town highway; AOTCLASS 7 = Legal Trail.",
        supportsBbox: true,
        supportsStatewide: true,
        supportsPagination: true,
        maxRecordCount: 1000,
      },
    ];
  }

  if (code === "CA") {
    return [
      ...federal,
      {
        sourceId: "ca_blm_ohv_areas",
        sourceName: "BLM CA Off Highway Vehicle Areas",
        sourceType: "area_context",
        tier: 2,
        status: "active",
        endpoint: CA_BLM_OHV_ENDPOINT,
        layerIds: [0],
        queryFormat: "arcgis",
        attribution: "BLM California — OHV area designations",
        legalWarnings: [
          "OHV area polygons provide context only — verify route-level access separately.",
          ...BLM_GTLF_WARNINGS,
        ],
        notes: "Polygon OHV open/limited/closed areas — does not create route lines.",
        supportsBbox: true,
        supportsStatewide: true,
        supportsPagination: true,
        areaContextOnly: true,
        maxRecordCount: 500,
      },
      {
        ...stateSpecificPlaceholder(code),
        sourceName: "California statewide OHV route GIS (unverified)",
        notes: "State OHV route line dataset not verified — use federal + BLM CA area context.",
      },
    ];
  }

  if (code === "ME") {
    return [
      ...federal,
      {
        sourceId: "me_atv_trails",
        sourceName: "Maine Bureau of Parks and Lands ATV trails",
        sourceType: "state_arcgis",
        tier: 2,
        status: "needs_validation",
        attribution: "Maine Bureau of Parks and Lands — Off-Road Vehicle Program",
        legalWarnings: STATE_CLASS_ROAD_WARNINGS,
        notes:
          "ArcGIS item ATV_MooseReg_MASTER (0548959a7a3f4447b06b3696ee0bb3b1) — FeatureServer URL must be verified before active import.",
        supportsBbox: false,
        supportsStatewide: false,
        supportsPagination: false,
      },
      stateSpecificPlaceholder(code),
    ];
  }

  if (code === "NH") {
    return [
      ...federal,
      {
        sourceId: "nh_class_vi_roads",
        sourceName: "NHDOT Legislative Class VI roads",
        sourceType: "state_arcgis",
        tier: 2,
        status: "active",
        endpoint: NHDOT_LEGISLATIVE_CLASS_ENDPOINT,
        layerIds: [5],
        queryFormat: "arcgis",
        whereClause: "LEGIS_CLASS='VI'",
        outFields: NHDOT_CLASS6_OUT_FIELDS,
        attribution: "New Hampshire Department of Transportation — Legislative Class Groups",
        legalWarnings: [
          ...STATE_CLASS_ROAD_WARNINGS,
          "Class VI roads may have local access restrictions — verify signage.",
        ],
        notes: "Official NHDOT ArcGIS Class VI (unmaintained town highways). ~3,000+ segments statewide.",
        supportsBbox: true,
        supportsStatewide: true,
        supportsPagination: true,
        maxRecordCount: 1000,
      },
    ];
  }

  return [...federal, stateSpecificPlaceholder(code)];
}

function defaultEnabledForState(sources: OffroadSourceRegistryEntry[]): string[] {
  return sources.filter((s) => s.status === "active" && !s.areaContextOnly).map((s) => s.sourceId);
}

export const OFFROAD_STATE_REGISTRY: OffroadStateRegistry[] = US_STATE_BOUNDS.map((state) => {
  const sources = buildStateSources(state.stateCode);
  return {
    stateCode: state.stateCode,
    stateName: state.stateName,
    enabled: true,
    defaultEnabledSources: defaultEnabledForState(sources),
    sources,
  };
});

const REGISTRY_BY_CODE = new Map(OFFROAD_STATE_REGISTRY.map((s) => [s.stateCode, s]));

export function getOffroadStateRegistry(stateCode: string): OffroadStateRegistry | null {
  return REGISTRY_BY_CODE.get(stateCode.toUpperCase()) ?? null;
}

export function listOffroadStateRegistries(): OffroadStateRegistry[] {
  return OFFROAD_STATE_REGISTRY;
}

export function buildStateCoverageDiagnostics(): StateCoverageDiagnostics {
  const byState: StateCoverageDiagnostics["byState"] = {};
  let statesWithFederalCoverage = 0;
  let statesWithActiveStateSpecificSource = 0;
  let statesWithNeedsValidationStateSource = 0;
  let statesNeedingStateSource = 0;

  const registryStates = OFFROAD_STATE_REGISTRY.filter((s) => s.stateCode !== "DC");

  for (const state of registryStates) {
    const federalActive = state.sources.filter(
      (s) => s.tier === 1 && s.status === "active"
    ).length;
    const stateActive = state.sources.filter(
      (s) => s.tier === 2 && s.status === "active" && s.sourceType !== "needs_research"
    ).length;
    const needsValidation = state.sources.filter((s) => s.status === "needs_validation").length;
    const needsSource = state.sources.filter((s) => s.status === "needs_source").length;

    if (federalActive >= 3) statesWithFederalCoverage += 1;
    if (stateActive > 0) statesWithActiveStateSpecificSource += 1;
    if (needsValidation > 0) statesWithNeedsValidationStateSource += 1;
    if (needsSource > 0) statesNeedingStateSource += 1;

    byState[state.stateCode] = {
      enabled: state.enabled,
      federalActive,
      stateActive,
      needsValidation,
      needsSource,
    };
  }

  const contiguousStates = registryStates;

  return {
    totalStates: contiguousStates.length,
    statesWithFederalCoverage,
    statesWithActiveStateSpecificSource,
    statesWithNeedsValidationStateSource,
    statesNeedingStateSource,
    byState,
    sourceTotals: {
      usfsMvumActiveStates: contiguousStates.filter((s) =>
        s.sources.some((x) => x.sourceId === "usfs_mvum" && x.status === "active")
      ).length,
      blmGtlfActiveStates: contiguousStates.filter((s) =>
        s.sources.some((x) => x.sourceId === "blm_gtlf" && x.status === "active")
      ).length,
      osmActiveStates: contiguousStates.filter((s) =>
        s.sources.some((x) => x.sourceId === "osm_offroad" && x.status === "active")
      ).length,
      activeStateSpecificSources: OFFROAD_STATE_REGISTRY.flatMap((s) => s.sources).filter(
        (x) => x.tier === 2 && x.status === "active"
      ).length,
      needsValidationSources: OFFROAD_STATE_REGISTRY.flatMap((s) => s.sources).filter(
        (x) => x.status === "needs_validation"
      ).length,
      needsSourceSources: OFFROAD_STATE_REGISTRY.flatMap((s) => s.sources).filter(
        (x) => x.status === "needs_source"
      ).length,
    },
  };
}
