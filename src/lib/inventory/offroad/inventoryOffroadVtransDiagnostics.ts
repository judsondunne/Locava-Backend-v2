import type { InventoryBbox } from "../../../contracts/entities/inventory-entities.contract.js";
import type { LocavaInventoryRoute } from "../inventoryLocavaTypes.js";
import { mergeOsmAndVtransOffroadRoutes } from "./inventoryOffroadMerge.js";
import type { OffroadClassificationResult } from "./inventoryOffroadClassifier.js";
import type { VtransRoadFeature } from "./sources/vtransPublicHighwaySystemSource.js";
import type { NhdotRoadFeature } from "./sources/nhNhdotLegislativeClassSource.js";
import { NHDOT_LEGISLATIVE_CLASS_ENDPOINT } from "./sources/nhNhdotLegislativeClassSource.js";

export type VtransOffroadDiagnostics = {
  enabled: boolean;
  endpoint: string;
  rawFeatures: number;
  acceptedClass4: number;
  acceptedLegalTrails: number;
  restrictedOrClosed: number;
  pentRoads: number;
  duplicatesMergedWithOsm: number;
  featuresMissingGeometry: number;
  totalMilesFromAotMiles: number;
  sampleClass4: Array<Record<string, unknown>>;
  sampleLegalTrails: Array<Record<string, unknown>>;
  sampleRestricted: Array<Record<string, unknown>>;
  samplePentRoads: Array<Record<string, unknown>>;
  sampleMergedWithOsm: Array<Record<string, unknown>>;
  topVtransRoadNames: string[];
  byAOTCLASS: Record<string, number>;
  byRoadClosed: Record<string, number>;
  byMapYear: Record<string, number>;
  byCertYear: Record<string, number>;
  nh?: NhOffroadDiagnostics;
};

export type NhOffroadDiagnostics = {
  enabled: boolean;
  endpoint: string;
  rawFeatures: number;
  acceptedClass6: number;
  featuresMissingGeometry: number;
  totalMilesFromSectLength: number;
  sampleClass6: Array<Record<string, unknown>>;
  topNhRoadNames: string[];
  byLegisClass: Record<string, number>;
  bySurfType: Record<string, number>;
};

function routeBrief(r: LocavaInventoryRoute): Record<string, unknown> {
  return {
    name: r.name,
    sourceKey: r.sourceKey,
    sourceDatasetName: r.sourceDatasetName,
    distanceMiles: r.distanceMiles,
    offroadCategory: r.offroad?.offroadCategory,
    legalDisplayLabel: r.offroad?.legalDisplayLabel,
    AOTCLASS: r.tags.AOTCLASS,
    AOTMILES: r.offroad?.aotMiles ?? r.tags.AOTMILES,
    accessStatus: r.offroad?.accessStatus,
    warnings: r.offroad?.accessWarnings,
  };
}

export function buildVtransOffroadDiagnostics(input: {
  enabled: boolean;
  rawFeatures: VtransRoadFeature[];
  routes: LocavaInventoryRoute[];
  missingGeometry: number;
  duplicatesMergedWithOsm: number;
  mergedPairs: Array<{ vtransSourceKey: string; osmSourceKey: string }>;
}): VtransOffroadDiagnostics {
  const vtransRoutes = input.routes.filter((r) => r.source === "vtrans_public_highway_system");
  const class4 = vtransRoutes.filter((r) => r.offroad?.offroadCategory === "class4_road");
  const legal = vtransRoutes.filter((r) => r.offroad?.offroadCategory === "legal_trail");
  const restricted = vtransRoutes.filter((r) => r.offroad?.accessStatus === "restricted");
  const pent = vtransRoutes.filter((r) => r.offroad?.pentRoadRaw && /y|yes|pent/i.test(r.offroad.pentRoadRaw));

  const byAOTCLASS: Record<string, number> = {};
  const byRoadClosed: Record<string, number> = {};
  const byMapYear: Record<string, number> = {};
  const byCertYear: Record<string, number> = {};

  let totalMilesFromAotMiles = 0;
  for (const r of vtransRoutes) {
    const aot = r.offroad?.aotMiles ?? (r.tags.AOTMILES ? Number(r.tags.AOTMILES) : 0);
    if (Number.isFinite(aot) && aot > 0) totalMilesFromAotMiles += aot;
    const cls = r.tags.AOTCLASS ?? "unknown";
    byAOTCLASS[cls] = (byAOTCLASS[cls] ?? 0) + 1;
    const rc = r.offroad?.roadClosedRaw ?? "none";
    byRoadClosed[rc] = (byRoadClosed[rc] ?? 0) + 1;
    const my = r.offroad?.mapYear != null ? String(r.offroad.mapYear) : "unknown";
    byMapYear[my] = (byMapYear[my] ?? 0) + 1;
    const cy = r.offroad?.certYear != null ? String(r.offroad.certYear) : "unknown";
    byCertYear[cy] = (byCertYear[cy] ?? 0) + 1;
  }

  const nameCounts = new Map<string, number>();
  for (const r of vtransRoutes) {
    nameCounts.set(r.name, (nameCounts.get(r.name) ?? 0) + 1);
  }
  const topVtransRoadNames = [...nameCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => name);

  return {
    enabled: input.enabled,
    endpoint: "PublicHighwaySystem/MapServer/6/query",
    rawFeatures: input.rawFeatures.length,
    acceptedClass4: class4.length,
    acceptedLegalTrails: legal.length,
    restrictedOrClosed: restricted.length,
    pentRoads: pent.length,
    duplicatesMergedWithOsm: input.duplicatesMergedWithOsm,
    featuresMissingGeometry: input.missingGeometry,
    totalMilesFromAotMiles: Math.round(totalMilesFromAotMiles * 100) / 100,
    sampleClass4: class4.slice(0, 10).map(routeBrief),
    sampleLegalTrails: legal.slice(0, 10).map(routeBrief),
    sampleRestricted: restricted.slice(0, 10).map(routeBrief),
    samplePentRoads: pent.slice(0, 10).map(routeBrief),
    sampleMergedWithOsm: input.mergedPairs.slice(0, 10).map((p) => ({ ...p })),
    topVtransRoadNames,
    byAOTCLASS,
    byRoadClosed,
    byMapYear,
    byCertYear,
  };
}

export function buildNhOffroadDiagnostics(input: {
  enabled: boolean;
  rawFeatures: NhdotRoadFeature[];
  routes: LocavaInventoryRoute[];
  missingGeometry: number;
}): NhOffroadDiagnostics {
  const nhRoutes = input.routes.filter((r) => r.source === "nhdot_legislative_class");
  const class6 = nhRoutes.filter((r) => r.offroad?.offroadCategory === "class6_road");

  const byLegisClass: Record<string, number> = {};
  const bySurfType: Record<string, number> = {};
  let totalMilesFromSectLength = 0;

  for (const r of nhRoutes) {
    const cls = r.tags.LEGIS_CLASS ?? "unknown";
    byLegisClass[cls] = (byLegisClass[cls] ?? 0) + 1;
    const surf = r.tags.SURF_TYPE ?? r.offroad?.surfaceRaw ?? "unknown";
    bySurfType[surf] = (bySurfType[surf] ?? 0) + 1;
    const sect = r.tags.SECT_LENGTH ? Number(r.tags.SECT_LENGTH) : r.distanceMiles;
    if (Number.isFinite(sect) && sect > 0) totalMilesFromSectLength += sect;
  }

  const nameCounts = new Map<string, number>();
  for (const r of nhRoutes) nameCounts.set(r.name, (nameCounts.get(r.name) ?? 0) + 1);
  const topNhRoadNames = [...nameCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name]) => name);

  return {
    enabled: input.enabled,
    endpoint: NHDOT_LEGISLATIVE_CLASS_ENDPOINT,
    rawFeatures: input.rawFeatures.length,
    acceptedClass6: class6.length,
    featuresMissingGeometry: input.missingGeometry,
    totalMilesFromSectLength: Math.round(totalMilesFromSectLength * 100) / 100,
    sampleClass6: class6.slice(0, 10).map(routeBrief),
    topNhRoadNames,
    byLegisClass,
    bySurfType,
  };
}

export type OffroadDiagnostics = {
  algorithmVersion: "locava_offroad_v1";
  rawOffroadCandidates: number;
  acceptedOffroadRoutes: number;
  osmOffroadRouteCount?: number;
  stateOffroadRouteCount?: number;
  vtransOffroadRouteCount?: number;
  hiddenOffroadCandidates: number;
  rejectedOffroadCandidates: number;
  byOffroadCategory: Record<string, number>;
  byOffroadConfidence: Record<string, number>;
  byAccessStatus: Record<string, number>;
  bySurface: Record<string, number>;
  byTracktype: Record<string, number>;
  bySmoothness: Record<string, number>;
  class4Signals: number;
  class6Signals: number;
  legalTrailSignals: number;
  atvSignals: number;
  ohvSignals: number;
  ohrvSignals: number;
  fourWdOnlySignals: number;
  routesWithParking: number;
  routesWithoutParking: number;
  privateRejected: number;
  accessUnknownAccepted: number;
  longestOffroadRoutes: Array<Record<string, unknown>>;
  sampleExplicitOffroad: Array<Record<string, unknown>>;
  sampleClass4: Array<Record<string, unknown>>;
  sampleClass6: Array<Record<string, unknown>>;
  sampleAtvOhv: Array<Record<string, unknown>>;
  sample4wd: Array<Record<string, unknown>>;
  sampleCandidates: Array<Record<string, unknown>>;
  sampleRejectedPrivate: Array<Record<string, unknown>>;
  possibleMisses: Array<Record<string, unknown>>;
  warnings: string[];
  vtrans?: VtransOffroadDiagnostics;
};

function routeBriefShort(r: LocavaInventoryRoute): Record<string, unknown> {
  return {
    name: r.name,
    displayName: r.offroad?.legalDisplayLabel ?? r.name,
    sourceKey: r.sourceKey,
    distanceMiles: r.distanceMiles,
    offroadCategory: r.offroad?.offroadCategory,
    offroadConfidence: r.offroad?.offroadConfidence,
    accessStatus: r.offroad?.accessStatus,
  };
}

export function buildOffroadDiagnostics(input: {
  classifications: OffroadClassificationResult[];
  routes: LocavaInventoryRoute[];
  stateRouteCount?: number;
  osmOffroadRouteCount?: number;
  vtransDiagnostics?: VtransOffroadDiagnostics;
}): OffroadDiagnostics {
  const accepted = input.routes.filter((r) => r.activity === "offroading");
  const byOffroadCategory: Record<string, number> = {};
  const byOffroadConfidence: Record<string, number> = {};
  const byAccessStatus: Record<string, number> = {};
  const bySurface: Record<string, number> = {};
  const byTracktype: Record<string, number> = {};
  const bySmoothness: Record<string, number> = {};

  for (const r of accepted) {
    const o = r.offroad;
    if (!o) continue;
    byOffroadCategory[o.offroadCategory] = (byOffroadCategory[o.offroadCategory] ?? 0) + 1;
    byOffroadConfidence[o.offroadConfidence] = (byOffroadConfidence[o.offroadConfidence] ?? 0) + 1;
    byAccessStatus[o.accessStatus] = (byAccessStatus[o.accessStatus] ?? 0) + 1;
    const surface = r.tags.surface ?? r.tags.SURFACETYPE;
    if (surface) bySurface[surface] = (bySurface[surface] ?? 0) + 1;
    const tracktype = r.tags.tracktype;
    if (tracktype) byTracktype[tracktype] = (byTracktype[tracktype] ?? 0) + 1;
    const smoothness = r.tags.smoothness;
    if (smoothness) bySmoothness[smoothness] = (bySmoothness[smoothness] ?? 0) + 1;
  }

  const class4Signals = input.classifications.filter((c) => c.roadClassSignals.vtClass4).length;
  const class6Signals = input.classifications.filter((c) => c.roadClassSignals.nhClass6).length;
  const legalTrailSignals = input.classifications.filter((c) => c.roadClassSignals.legalTrail).length;
  const atvSignals = input.classifications.filter((c) => c.vehicleSignals.atv).length;
  const ohvSignals = input.classifications.filter((c) => c.vehicleSignals.ohv).length;
  const ohrvSignals = input.classifications.filter((c) => c.vehicleSignals.ohrv).length;
  const fourWdOnlySignals = input.classifications.filter((c) => c.vehicleSignals.fourWdOnly).length;

  const vtransCount = accepted.filter((r) => r.source === "vtrans_public_highway_system").length;
  const warnings = ["Offroading labels are activity/category hints only; users must verify legal access locally."];
  if (vtransCount === 0 && !input.vtransDiagnostics?.enabled) {
    warnings.push(
      "No VTrans Class 4 / Legal Trail routes loaded — use Offroad Sources panel or live VTrans PHS fetch for complete VT town highway coverage."
    );
  }

  return {
    algorithmVersion: "locava_offroad_v1",
    rawOffroadCandidates: input.classifications.length,
    acceptedOffroadRoutes: accepted.length,
    osmOffroadRouteCount: input.osmOffroadRouteCount,
    stateOffroadRouteCount: input.stateRouteCount,
    vtransOffroadRouteCount: vtransCount,
    hiddenOffroadCandidates: input.classifications.filter((c) => c.decision === "candidate").length,
    rejectedOffroadCandidates: input.classifications.filter((c) => c.decision === "reject").length,
    byOffroadCategory,
    byOffroadConfidence,
    byAccessStatus,
    bySurface,
    byTracktype,
    bySmoothness,
    class4Signals,
    class6Signals,
    legalTrailSignals,
    atvSignals,
    ohvSignals,
    ohrvSignals,
    fourWdOnlySignals,
    routesWithParking: accepted.filter((r) => r.selectedParking).length,
    routesWithoutParking: accepted.filter((r) => !r.selectedParking).length,
    privateRejected: input.classifications.filter((c) => c.rejectionReason === "private_access").length,
    accessUnknownAccepted: accepted.filter((r) => r.offroad?.accessStatus === "unknown").length,
    longestOffroadRoutes: [...accepted].sort((a, b) => b.distanceMeters - a.distanceMeters).slice(0, 10).map(routeBriefShort),
    sampleExplicitOffroad: accepted.filter((r) => r.offroad?.offroadConfidence === "explicit").slice(0, 10).map(routeBriefShort),
    sampleClass4: accepted.filter((r) => r.offroad?.offroadCategory === "class4_road").slice(0, 10).map(routeBriefShort),
    sampleClass6: accepted.filter((r) => r.offroad?.offroadCategory === "class6_road").slice(0, 10).map(routeBriefShort),
    sampleAtvOhv: accepted.filter((r) => ["atv_trail", "ohv_trail", "ohrv_trail"].includes(r.offroad?.offroadCategory ?? "")).slice(0, 10).map(routeBriefShort),
    sample4wd: accepted.filter((r) => r.offroad?.offroadCategory === "4wd_track").slice(0, 10).map(routeBriefShort),
    sampleCandidates: input.classifications.filter((c) => c.decision === "candidate").slice(0, 10).map((c) => ({ name: c.displayName, score: c.score, sourceKey: c.sourceKey })),
    sampleRejectedPrivate: input.classifications.filter((c) => c.rejectionReason === "private_access").slice(0, 10).map((c) => ({ name: c.displayName, sourceKey: c.sourceKey })),
    possibleMisses: [],
    warnings,
    vtrans: input.vtransDiagnostics,
  };
}
