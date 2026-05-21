import type {
  InventoryCommitResult,
  InventoryCommitTarget,
  InventoryImportDryRunResult,
  InventoryImportRun,
} from "../../contracts/entities/inventory-entities.contract.js";
import { emptyInventoryImportCounts } from "../../contracts/entities/inventory-entities.contract.js";
import { buildInventoryImportRunId } from "../../lib/inventory/inventoryIds.js";
import { resolveInventoryRegion } from "../../lib/inventory/inventoryBbox.js";
import { normalizeInventoryRawObjects } from "../../lib/inventory/inventoryNormalize.js";
import { fixtureInventorySource } from "../../lib/inventory/sources/fixtureInventorySource.js";
import {
  osmLikeGeojsonInventorySource,
  overpassJsonInventorySource,
} from "../../lib/inventory/sources/osmLikeGeojsonInventorySource.js";
import type { InventoryImportInput, InventorySourceAdapter } from "../../lib/inventory/sources/inventorySource.types.js";
import {
  getInventoryRunArtifacts,
  getInventoryRunMemory,
  getLatestInventoryRunMemory,
  listInventoryRunsMemory,
  putInventoryRun,
  updateInventoryRunMemory,
} from "./inventoryImportRunStore.js";
import { bulkWriteInventoryRoutes } from "../../repositories/source-of-truth/inventory-routes-firestore.adapter.js";
import { bulkWriteInventorySpots } from "../../repositories/source-of-truth/inventory-spots-firestore.adapter.js";
import {
  getInventoryImportRun,
  listInventoryImportRuns,
  writeInventoryImportRun,
} from "../../repositories/source-of-truth/inventory-import-runs-firestore.adapter.js";
import { isFirestoreEmulatorActive } from "./inventoryWriteGuard.js";
import { loadEnv } from "../../config/env.js";

export type InventoryDryRunInput = {
  source?: "fixture" | "geojson" | "overpass_json_file";
  regionKey?: string;
  geojsonPath?: string;
  overpassJsonPath?: string;
  limit?: number;
  writeRunDoc?: boolean;
};

export type InventoryCommitInput = {
  runId: string;
  commitTarget?: InventoryCommitTarget;
  dryRun?: boolean;
  confirmProductionWrite?: string;
};

function resolveSourceAdapter(source: "fixture" | "geojson" | "overpass_json_file"): InventorySourceAdapter {
  if (source === "geojson") return osmLikeGeojsonInventorySource;
  if (source === "overpass_json_file") return overpassJsonInventorySource;
  return fixtureInventorySource;
}

function shouldWriteDryRunDoc(explicit?: boolean): boolean {
  if (explicit === true) return true;
  if (explicit === false) return false;
  const env = loadEnv();
  if (env.INVENTORY_DRY_RUN_WRITE_RUN_DOC === true) return true;
  return isFirestoreEmulatorActive();
}

function buildImportInput(input: InventoryDryRunInput): InventoryImportInput {
  const region = resolveInventoryRegion(input.regionKey);
  return {
    source: input.source ?? "fixture",
    regionKey: region.regionKey,
    regionLabel: region.label,
    bbox: region.bbox,
    limit: input.limit,
    geojsonPath: input.geojsonPath,
    overpassJsonPath: input.overpassJsonPath,
  };
}

export async function startInventoryDryRun(input: InventoryDryRunInput = {}): Promise<InventoryImportRun> {
  const result = await processInventorySource(input);
  return result.run;
}

export async function processInventorySource(input: InventoryDryRunInput = {}): Promise<InventoryImportDryRunResult> {
  const importInput = buildImportInput(input);
  const runId = buildInventoryImportRunId();
  const startedAt = new Date().toISOString();
  const run: InventoryImportRun = {
    runId,
    source: importInput.source,
    regionKey: importInput.regionKey,
    regionLabel: importInput.regionLabel,
    bbox: importInput.bbox,
    status: "dry_run_running",
    dryRun: true,
    commitTarget: "none",
    counts: emptyInventoryImportCounts(),
    errors: [],
    warnings: [],
    sampleSpots: [],
    sampleRoutes: [],
    startedAt,
  };
  putInventoryRun(run, { stagedSpots: [], stagedRoutes: [], tilePreview: [] });

  try {
    const adapter = resolveSourceAdapter(importInput.source);
    const rawObjects = await adapter.loadRawObjects(importInput);
    const normalized = normalizeInventoryRawObjects({
      rawObjects,
      regionKey: importInput.regionKey,
      regionBbox: importInput.bbox,
      importRunId: runId,
    });

    const finishedAt = new Date().toISOString();
    const completed: InventoryImportRun = {
      ...run,
      status: "dry_run_complete",
      finishedAt,
      counts: {
        rawObjects: rawObjects.length,
        acceptedSpots: normalized.spots.length,
        acceptedRoutes: normalized.routes.length,
        rejected: normalized.rejected.length,
        duplicates: normalized.duplicates,
        tilesGenerated: 0,
        firestoreSpotWrites: 0,
        firestoreRouteWrites: 0,
        firestoreTileWrites: 0,
      },
      errors: normalized.rejected.slice(0, 50),
      warnings: [
        ...normalized.warnings.slice(0, 40),
        ...normalized.coordinateWarnings.slice(0, 10).map((w) => ({
          code: w.code,
          message: w.message,
          sample: { context: w.context, lat: w.lat, lng: w.lng },
        })),
      ],
      sampleSpots: normalized.spots.slice(0, 10),
      sampleRoutes: normalized.routes.slice(0, 10),
    };

    putInventoryRun(completed, {
      stagedSpots: normalized.spots,
      stagedRoutes: normalized.routes,
      tilePreview: [],
    });

    if (shouldWriteDryRunDoc(input.writeRunDoc)) {
      await writeInventoryImportRun(completed, {
        commitTarget: "emulator",
        operation: "inventory.dry_run.write_run_doc",
      }).catch(() => undefined);
    }

    return {
      run: completed,
      stagedSpots: normalized.spots,
      stagedRoutes: normalized.routes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateInventoryRunMemory(runId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      errors: [{ code: "dry_run_failed", message }],
    });
    throw error instanceof Error ? error : new Error(message);
  }
}

export async function commitInventoryRun(input: InventoryCommitInput): Promise<InventoryCommitResult> {
  if (input.dryRun !== false) {
    throw new Error("commitInventoryRun requires dryRun=false");
  }
  const commitTarget = input.commitTarget ?? "emulator";
  const memoryRun = getInventoryRunMemory(input.runId) ?? (await getInventoryImportRun(input.runId));
  if (!memoryRun) throw new Error(`run_not_found:${input.runId}`);
  const artifacts = getInventoryRunArtifacts(input.runId);
  if (!artifacts) throw new Error(`run_artifacts_not_found:${input.runId}`);

  updateInventoryRunMemory(input.runId, { status: "commit_running", commitTarget });

  const activeSpots = artifacts.stagedSpots.map((s) => ({ ...s, status: "active" as const }));
  const activeRoutes = artifacts.stagedRoutes.map((r) => ({ ...r, status: "active" as const }));

  const spotWrites = await bulkWriteInventorySpots(activeSpots, {
    commitTarget,
    operation: "inventory.commit.spots",
    confirmProductionWrite: input.confirmProductionWrite,
  });
  const routeWrites = await bulkWriteInventoryRoutes(activeRoutes, {
    commitTarget,
    operation: "inventory.commit.routes",
    confirmProductionWrite: input.confirmProductionWrite,
  });

  const committedAt = new Date().toISOString();
  const committed: InventoryImportRun = {
    ...memoryRun,
    status: "committed",
    dryRun: false,
    commitTarget,
    committedAt,
    counts: {
      ...memoryRun.counts,
      firestoreSpotWrites: spotWrites,
      firestoreRouteWrites: routeWrites,
    },
  };
  putInventoryRun(committed, artifacts);
  await writeInventoryImportRun(committed, {
    commitTarget,
    operation: "inventory.commit.run_doc",
    confirmProductionWrite: input.confirmProductionWrite,
  }).catch(() => undefined);

  return {
    runId: input.runId,
    commitTarget,
    spotWrites,
    routeWrites,
    runWrite: true,
  };
}

export async function rollbackInventoryRun(runId: string): Promise<InventoryImportRun | null> {
  const run = getInventoryRunMemory(runId);
  if (!run) return null;
  const rolled = updateInventoryRunMemory(runId, { status: "rolled_back", finishedAt: new Date().toISOString() });
  if (rolled && isFirestoreEmulatorActive()) {
    await writeInventoryImportRun(rolled, {
      commitTarget: "emulator",
      operation: "inventory.rollback.run_doc",
    }).catch(() => undefined);
  }
  return rolled;
}

export async function listInventoryRuns(limit = 50): Promise<InventoryImportRun[]> {
  const memory = listInventoryRunsMemory(limit);
  if (memory.length > 0) return memory;
  return listInventoryImportRuns(limit);
}

export async function getInventoryRun(runId: string): Promise<InventoryImportRun | null> {
  return getInventoryRunMemory(runId) ?? (await getInventoryImportRun(runId));
}

export function getLatestInventoryRun(): InventoryImportRun | null {
  return getLatestInventoryRunMemory();
}
