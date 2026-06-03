import { randomUUID } from "node:crypto";
import type { InventoryBbox } from "../../contracts/entities/inventory-entities.contract.js";
import { resolveAdminViewport, type AdminViewportInput } from "../../lib/inventory/inventoryBbox.js";
import { assembleOffroadRoutes } from "../../lib/inventory/offroad/inventoryOffroadAssembler.js";
import {
  buildOffroadDiagnostics,
  buildVtransOffroadDiagnostics,
} from "../../lib/inventory/offroad/inventoryOffroadDiagnostics.js";
import { mergeOsmAndVtransOffroadRoutes } from "../../lib/inventory/offroad/inventoryOffroadMerge.js";
import { importVtransRoutesForBbox } from "../../lib/inventory/offroad/sources/vtransPublicHighwaySystemSource.js";
import type { LocavaInventoryRoute } from "../../lib/inventory/inventoryLocavaTypes.js";
import { isInventoryProductionWriteUnlocked } from "./inventoryWriteGuard.js";

export type OffroadSourceMode = "osm" | "vtrans" | "osm_vtrans";

export type OffroadDryRunInput = {
  sourceMode: OffroadSourceMode;
  viewport?: AdminViewportInput;
  includeClass4?: boolean;
  includeLegalTrails?: boolean;
  includeRestrictedAsHidden?: boolean;
  /** Raw OSM features for OSM modes — supplied by caller when available */
  osmFeatures?: Parameters<typeof assembleOffroadRoutes>[0]["features"];
  usedTrailSourceKeys?: Set<string>;
  accessFeatures?: Parameters<typeof assembleOffroadRoutes>[0]["accessFeatures"];
};

export type OffroadDryRunResult = {
  runId: string;
  bbox: InventoryBbox;
  label: string;
  sourceMode: OffroadSourceMode;
  routes: LocavaInventoryRoute[];
  diagnostics: ReturnType<typeof buildOffroadDiagnostics>;
  productionWritesBlocked: true;
  fetchedAt: string;
};

let latestOffroadRun: OffroadDryRunResult | null = null;

export function getLatestOffroadDryRun(): OffroadDryRunResult | null {
  return latestOffroadRun;
}

export function searchOffroadRoutes(input: {
  q?: string;
  activity?: string;
  offroadCategory?: string;
  source?: string;
  limit?: number;
  offset?: number;
}): { total: number; results: LocavaInventoryRoute[] } | null {
  if (!latestOffroadRun) return null;
  let rows = latestOffroadRun.routes;
  if (input.activity) rows = rows.filter((r) => r.activity === input.activity);
  if (input.offroadCategory) rows = rows.filter((r) => r.offroad?.offroadCategory === input.offroadCategory);
  if (input.source) rows = rows.filter((r) => r.source === input.source);
  if (input.q?.trim()) {
    const q = input.q.trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.sourceKey.toLowerCase().includes(q) ||
        r.sourceDatasetName?.toLowerCase().includes(q) ||
        Object.values(r.tags).some((v) => v.toLowerCase().includes(q))
    );
  }
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 200;
  return { total: rows.length, results: rows.slice(offset, offset + limit) };
}

export async function runOffroadDryRun(input: OffroadDryRunInput): Promise<OffroadDryRunResult> {
  if (isInventoryProductionWriteUnlocked()) {
    throw new Error("offroad_dry_run_requires_production_writes_blocked");
  }

  const region = resolveAdminViewport(input.viewport);
  const runId = randomUUID();
  const importRunId = runId;

  let osmRoutes: LocavaInventoryRoute[] = [];
  let classifications: ReturnType<typeof assembleOffroadRoutes>["classifications"] = [];

  if (input.sourceMode !== "vtrans" && input.osmFeatures) {
    const assembly = assembleOffroadRoutes({
      features: input.osmFeatures,
      usedSourceKeys: input.usedTrailSourceKeys ?? new Set(),
      accessFeatures: input.accessFeatures ?? [],
      importRunId,
    });
    osmRoutes = assembly.routes;
    classifications = assembly.classifications;
  }

  let vtransRoutes: LocavaInventoryRoute[] = [];
  let vtransRaw = { rawFeatures: [] as Awaited<ReturnType<typeof importVtransRoutesForBbox>>["rawFeatures"], missingGeometry: 0 };
  let mergeMeta = { duplicatesMergedWithOsm: 0, mergedPairs: [] as Array<{ vtransSourceKey: string; osmSourceKey: string }> };

  if (input.sourceMode !== "osm") {
    const imported = await importVtransRoutesForBbox({
      bbox: region.bbox,
      includeClass4: input.includeClass4 ?? true,
      includeLegalTrails: input.includeLegalTrails ?? true,
      importRunId,
      localityLabel: region.label,
      includeRestrictedAsHidden: input.includeRestrictedAsHidden ?? true,
    });
    vtransRoutes = imported.routes;
    vtransRaw = { rawFeatures: imported.rawFeatures, missingGeometry: imported.missingGeometry };
  }

  let routes: LocavaInventoryRoute[];
  if (input.sourceMode === "osm") {
    routes = osmRoutes;
  } else if (input.sourceMode === "vtrans") {
    routes = vtransRoutes;
  } else {
    const merged = mergeOsmAndVtransOffroadRoutes({
      osmRoutes,
      vtransRoutes,
      bbox: region.bbox,
    });
    routes = merged.routes;
    mergeMeta = { duplicatesMergedWithOsm: merged.duplicatesMergedWithOsm, mergedPairs: merged.mergedPairs };
  }

  const vtransDiagnostics = buildVtransOffroadDiagnostics({
    enabled: input.sourceMode !== "osm",
    rawFeatures: vtransRaw.rawFeatures,
    routes,
    missingGeometry: vtransRaw.missingGeometry,
    duplicatesMergedWithOsm: mergeMeta.duplicatesMergedWithOsm,
    mergedPairs: mergeMeta.mergedPairs,
  });

  const diagnostics = buildOffroadDiagnostics({
    classifications,
    routes,
    osmOffroadRouteCount: osmRoutes.length,
    stateRouteCount: vtransRoutes.length,
    vtransDiagnostics,
  });

  const result: OffroadDryRunResult = {
    runId,
    bbox: region.bbox,
    label: region.label,
    sourceMode: input.sourceMode,
    routes,
    diagnostics,
    productionWritesBlocked: true,
    fetchedAt: new Date().toISOString(),
  };

  latestOffroadRun = result;
  return result;
}
