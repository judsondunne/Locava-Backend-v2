import type { LocavaInventoryRoute } from "../inventoryLocavaTypes.js";
import type { OffroadStateRegistry } from "./sources/nationalOffroadSource.types.js";
import {
  buildStateCoverageDiagnostics,
  listOffroadStateRegistries,
} from "./sources/offroadSourceRegistry.js";
import { evaluateOffroadRouteMapReadiness } from "./offroadRouteMapReadiness.js";

export type OffroadMainListExportConfig = {
  /** Routes eligible for OSM classifier acceptedRoutes / future inventory commit */
  includeReady: boolean;
  includeReview: boolean;
  includeHidden: boolean;
  includeOfficialState: boolean;
  includeOfficialFederal: boolean;
  includeOsmExplicit: boolean;
  includeOsmCandidates: boolean;
  minLocavaScore: number;
  activities: string[];
  excludePrivateAccess: boolean;
};

export const DEFAULT_OFFROAD_MAIN_LIST_EXPORT_CONFIG: OffroadMainListExportConfig = {
  includeReady: true,
  includeReview: true,
  includeHidden: false,
  includeOfficialState: true,
  includeOfficialFederal: true,
  includeOsmExplicit: true,
  includeOsmCandidates: false,
  minLocavaScore: 70,
  activities: ["offroading"],
  excludePrivateAccess: true,
};

export type OffroadStateSetupTier =
  | "federal_only"
  | "federal_plus_state_official"
  | "federal_plus_state_area_context"
  | "federal_plus_needs_validation";

export type OffroadStateCatalogEntry = {
  stateCode: string;
  stateName: string;
  enabled: boolean;
  setupTier: OffroadStateSetupTier;
  federalSourcesActive: number;
  stateOfficialSourceId: string | null;
  stateOfficialStatus: string | null;
  needsValidationSourceIds: string[];
  needsSource: boolean;
  dryRunReady: boolean;
  notes: string;
};

function stateSetupTier(registry: OffroadStateRegistry): OffroadStateSetupTier {
  const stateOfficial = registry.sources.find(
    (s) => s.tier === 2 && s.sourceType !== "needs_research" && !s.areaContextOnly
  );
  const areaContext = registry.sources.find((s) => s.areaContextOnly && s.status === "active");
  const needsVal = registry.sources.some((s) => s.status === "needs_validation");

  if (stateOfficial?.status === "active") return "federal_plus_state_official";
  if (areaContext) return "federal_plus_state_area_context";
  if (needsVal) return "federal_plus_needs_validation";
  return "federal_only";
}

export function buildOffroadStateCatalog(): OffroadStateCatalogEntry[] {
  return listOffroadStateRegistries()
    .filter((s) => s.stateCode !== "DC")
    .map((registry) => {
      const stateOfficial = registry.sources.find(
        (s) => s.tier === 2 && s.sourceType !== "needs_research" && !s.areaContextOnly
      );
      const needsValidation = registry.sources
        .filter((s) => s.status === "needs_validation")
        .map((s) => s.sourceId);
      const needsSource = registry.sources.some((s) => s.status === "needs_source");
      const federalActive = registry.sources.filter((s) => s.tier === 1 && s.status === "active").length;
      const tier = stateSetupTier(registry);

      let notes = "Federal: USFS MVUM + BLM GTLF + OSM offroad signals.";
      if (tier === "federal_plus_state_official") {
        notes = `Official state source active: ${stateOfficial?.sourceName ?? stateOfficial?.sourceId}.`;
      } else if (tier === "federal_plus_state_area_context") {
        notes = "Federal + state area context (polygons, not route lines).";
      } else if (tier === "federal_plus_needs_validation") {
        notes = `Federal only until validated: ${needsValidation.join(", ")}.`;
      } else if (needsSource) {
        notes = "Federal only — no verified statewide state DOT/OHV line source yet.";
      }

      return {
        stateCode: registry.stateCode,
        stateName: registry.stateName,
        enabled: registry.enabled,
        setupTier: tier,
        federalSourcesActive: federalActive,
        stateOfficialSourceId: stateOfficial?.sourceId ?? null,
        stateOfficialStatus: stateOfficial?.status ?? null,
        needsValidationSourceIds: needsValidation,
        needsSource,
        dryRunReady: federalActive >= 3,
        notes,
      };
    });
}

function routeSourceBucket(route: LocavaInventoryRoute): "official_state" | "official_federal" | "osm_explicit" | "osm_candidate" {
  if (route.source === "vtrans_public_highway_system" || route.source === "nhdot_legislative_class") {
    return "official_state";
  }
  if (route.source === "usfs_mvum" || route.source === "blm_gtlf") return "official_federal";
  const conf = route.offroad?.offroadConfidence;
  if (conf === "explicit" || conf === "strong") return "osm_explicit";
  return "osm_candidate";
}

export function filterRoutesForMainListExport(
  routes: LocavaInventoryRoute[],
  config: OffroadMainListExportConfig = DEFAULT_OFFROAD_MAIN_LIST_EXPORT_CONFIG
): {
  accepted: LocavaInventoryRoute[];
  rejected: Array<{ sourceKey: string; reason: string }>;
  summary: {
    total: number;
    accepted: number;
    ready: number;
    review: number;
    hidden: number;
    bySource: Record<string, number>;
  };
} {
  const rejected: Array<{ sourceKey: string; reason: string }> = [];
  const accepted: LocavaInventoryRoute[] = [];

  for (const route of routes) {
    const readiness = route.mapReadiness ?? evaluateOffroadRouteMapReadiness(route).mapReadiness;
    const bucket = routeSourceBucket(route);
    const access = route.offroad?.accessStatus ?? "unknown";

    if (config.excludePrivateAccess && (access === "private" || access === "restricted")) {
      rejected.push({ sourceKey: route.sourceKey, reason: "private_or_restricted" });
      continue;
    }
    if (route.locavaScore < config.minLocavaScore) {
      rejected.push({ sourceKey: route.sourceKey, reason: "low_locava_score" });
      continue;
    }
    if (!config.activities.includes(route.activity)) {
      rejected.push({ sourceKey: route.sourceKey, reason: "activity_filtered" });
      continue;
    }
    if (readiness === "ready" && !config.includeReady) {
      rejected.push({ sourceKey: route.sourceKey, reason: "ready_excluded_by_config" });
      continue;
    }
    if (readiness === "review" && !config.includeReview) {
      rejected.push({ sourceKey: route.sourceKey, reason: "review_excluded_by_config" });
      continue;
    }
    if (readiness === "hidden" && !config.includeHidden) {
      rejected.push({ sourceKey: route.sourceKey, reason: "hidden_excluded_by_config" });
      continue;
    }
    if (bucket === "official_state" && !config.includeOfficialState) {
      rejected.push({ sourceKey: route.sourceKey, reason: "official_state_excluded" });
      continue;
    }
    if (bucket === "official_federal" && !config.includeOfficialFederal) {
      rejected.push({ sourceKey: route.sourceKey, reason: "official_federal_excluded" });
      continue;
    }
    if (bucket === "osm_explicit" && !config.includeOsmExplicit) {
      rejected.push({ sourceKey: route.sourceKey, reason: "osm_explicit_excluded" });
      continue;
    }
    if (bucket === "osm_candidate" && !config.includeOsmCandidates) {
      rejected.push({ sourceKey: route.sourceKey, reason: "osm_candidate_excluded" });
      continue;
    }
    accepted.push(route);
  }

  const bySource: Record<string, number> = {};
  for (const r of accepted) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  }

  return {
    accepted,
    rejected,
    summary: {
      total: routes.length,
      accepted: accepted.length,
      ready: accepted.filter((r) => (r.mapReadiness ?? "review") === "ready").length,
      review: accepted.filter((r) => r.mapReadiness === "review").length,
      hidden: accepted.filter((r) => r.mapReadiness === "hidden").length,
      bySource,
    },
  };
}

export function buildOffroadPipelineSummary() {
  const catalog = buildOffroadStateCatalog();
  const diagnostics = buildStateCoverageDiagnostics();
  return {
    catalog,
    diagnostics,
    exportConfigDefaults: DEFAULT_OFFROAD_MAIN_LIST_EXPORT_CONFIG,
    statesFederalOnly: catalog.filter((s) => s.setupTier === "federal_only").length,
    statesWithOfficialStateSource: catalog.filter((s) => s.setupTier === "federal_plus_state_official").length,
    statesNeedsValidation: catalog.filter((s) => s.setupTier === "federal_plus_needs_validation").length,
    productionWritesBlocked: true as const,
  };
}
