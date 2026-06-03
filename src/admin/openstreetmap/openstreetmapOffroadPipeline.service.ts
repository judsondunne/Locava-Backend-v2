import { randomUUID } from "node:crypto";
import type { LocavaInventoryRoute } from "../../lib/inventory/inventoryLocavaTypes.js";
import { enrichInventoryActivityTitle } from "../../lib/inventory/inventoryActivityTitleEnrichment.js";
import { applyOffroadMapReadinessToRoutes } from "../../lib/inventory/offroad/offroadRouteMapReadiness.js";
import {
  DEFAULT_OFFROAD_MAIN_LIST_EXPORT_CONFIG,
  filterRoutesForMainListExport,
  buildOffroadPipelineSummary,
  type OffroadMainListExportConfig,
} from "../../lib/inventory/offroad/offroadPipelineConfig.js";
import { getOffroadNationalRun } from "./offroadNationalRunStore.js";
import {
  getLatestOpenStreetMapClassificationRun,
  getOpenStreetMapClassificationRun,
  putOpenStreetMapClassificationRun,
} from "./openstreetmapRunStore.js";
import type { OpenStreetMapClassificationResult } from "./openstreetmap.service.js";

let exportConfig: OffroadMainListExportConfig = { ...DEFAULT_OFFROAD_MAIN_LIST_EXPORT_CONFIG };

export function getOffroadMainListExportConfig(): OffroadMainListExportConfig {
  return { ...exportConfig };
}

export function setOffroadMainListExportConfig(config: Partial<OffroadMainListExportConfig>): OffroadMainListExportConfig {
  exportConfig = { ...exportConfig, ...config };
  return getOffroadMainListExportConfig();
}

export function getOffroadPipelineStatus() {
  return {
    ...buildOffroadPipelineSummary(),
    exportConfig: getOffroadMainListExportConfig(),
    latestClassifierRunId: getLatestOpenStreetMapClassificationRun()?.runId ?? null,
    productionWritesBlocked: true as const,
  };
}

export function previewNationalRunMainListExport(input: {
  nationalRunId: string;
  config?: Partial<OffroadMainListExportConfig>;
}) {
  const run = getOffroadNationalRun(input.nationalRunId);
  if (!run) throw new Error("national_run_not_found");

  const config = { ...exportConfig, ...input.config };
  const prepared = prepareRoutesForMainList(run.routes);
  const filtered = filterRoutesForMainListExport(prepared, config);

  return {
    nationalRunId: run.runId,
    stateCode: run.stateCode,
    config,
    ...filtered,
    productionWritesBlocked: true as const,
  };
}

function prepareRoutesForMainList(routes: LocavaInventoryRoute[]): LocavaInventoryRoute[] {
  const withReadiness = applyOffroadMapReadinessToRoutes(routes);
  const enriched = enrichInventoryActivityTitle({ spots: [], routes: withReadiness });
  return enriched.routes;
}

function mergeRoutesIntoClassifier(input: {
  classifierRun: OpenStreetMapClassificationResult;
  incoming: LocavaInventoryRoute[];
  stateCode: string;
  nationalRunId: string;
}): { merged: LocavaInventoryRoute[]; added: number; skipped: number } {
  const existingKeys = new Set(input.classifierRun.acceptedRoutes.map((r) => r.sourceKey));
  const merged = [...input.classifierRun.acceptedRoutes];
  let added = 0;
  let skipped = 0;

  for (const route of input.incoming) {
    if (existingKeys.has(route.sourceKey)) {
      skipped += 1;
      continue;
    }
    merged.push({
      ...route,
      tags: {
        ...route.tags,
        national_offroad_state: input.stateCode,
        national_offroad_run_id: input.nationalRunId,
        staged_to_main_list: "true",
      },
    });
    existingKeys.add(route.sourceKey);
    added += 1;
  }

  return { merged, added, skipped };
}

export function stageNationalOffroadToMainLists(input: {
  nationalRunId: string;
  classifierRunId?: string;
  config?: Partial<OffroadMainListExportConfig>;
  createClassifierShellIfMissing?: boolean;
}): {
  classifierRunId: string;
  stateCode: string;
  routesAdded: number;
  routesSkipped: number;
  exportSummary: ReturnType<typeof filterRoutesForMainListExport>["summary"];
  acceptedRoutesTotal: number;
  acceptedSpotsTotal: number;
  productionWritesBlocked: true;
} {
  const nationalRun = getOffroadNationalRun(input.nationalRunId);
  if (!nationalRun) throw new Error("national_run_not_found");

  const config = { ...exportConfig, ...input.config };
  const prepared = prepareRoutesForMainList(nationalRun.routes);
  const filtered = filterRoutesForMainListExport(prepared, config);

  let classifierRun =
    (input.classifierRunId ? getOpenStreetMapClassificationRun(input.classifierRunId) : null) ??
    getLatestOpenStreetMapClassificationRun();

  if (!classifierRun && input.createClassifierShellIfMissing !== false) {
    classifierRun = {
      label: `${nationalRun.stateCode} offroad (national pipeline)`,
      regionKey: `offroad_${nationalRun.stateCode.toLowerCase()}`,
      bbox: nationalRun.bbox ?? { minLat: 0, minLng: 0, maxLat: 0, maxLng: 0 },
      center: { lat: 0, lng: 0 },
      source: "overpass",
      fetchedAt: new Date().toISOString(),
      runId: randomUUID(),
      config: { foodMode: "local_only", trailMode: "recreation_only", natureMode: "named_or_recreational" },
      rawObjects: 0,
      acceptedSpots: [],
      acceptedRoutes: [],
      rejected: [],
      duplicatesSuppressed: 0,
      productionWritesBlocked: true,
      diagnostics: {} as OpenStreetMapClassificationResult["diagnostics"],
      diagnosticsJson: "{}",
      rawFeatures: [],
    };
  }

  if (!classifierRun) throw new Error("no_classifier_run_available");

  const { merged, added, skipped } = mergeRoutesIntoClassifier({
    classifierRun,
    incoming: filtered.accepted,
    stateCode: nationalRun.stateCode,
    nationalRunId: nationalRun.runId,
  });

  const updated: OpenStreetMapClassificationResult = {
    ...classifierRun,
    acceptedRoutes: merged,
    diagnostics: {
      ...classifierRun.diagnostics,
      ...( {
        nationalOffroadStaged: {
          nationalRunId: nationalRun.runId,
          stateCode: nationalRun.stateCode,
          routesAdded: added,
          routesSkipped: skipped,
          exportConfig: config,
          exportSummary: filtered.summary,
          stagedAt: new Date().toISOString(),
        },
      } as Record<string, unknown> ),
    } as OpenStreetMapClassificationResult["diagnostics"],
  };
  updated.diagnosticsJson = JSON.stringify(updated.diagnostics);

  putOpenStreetMapClassificationRun(updated);

  return {
    classifierRunId: updated.runId,
    stateCode: nationalRun.stateCode,
    routesAdded: added,
    routesSkipped: skipped,
    exportSummary: filtered.summary,
    acceptedRoutesTotal: updated.acceptedRoutes.length,
    acceptedSpotsTotal: updated.acceptedSpots.length,
    productionWritesBlocked: true,
  };
}
