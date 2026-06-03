import type {
  OsmNationalRun,
  UnexploredRoute,
  UnexploredSpot,
} from "../../../contracts/entities/osm-national-entities.contract.js";
import { bulkWriteUnexploredRoutes } from "../../../repositories/source-of-truth/unexplored-routes-firestore.adapter.js";
import { bulkWriteUnexploredSpots } from "../../../repositories/source-of-truth/unexplored-spots-firestore.adapter.js";
import { writeRouteGeometryChunk, type OsmNationalWriteOptions } from "../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";
import type { LocavaInventoryRoute } from "../../../lib/inventory/inventoryLocavaTypes.js";
import {
  assertWriteBudgetAllows,
  createWriteBudgetState,
  OsmNationalBudgetExceededError,
  recordWriteBudgetUsage,
  type OsmNationalWriteBudget,
  type OsmNationalWriteBudgetState,
} from "./osmNationalWriteGuard.js";
import { splitLargeGeometry } from "./osmNationalDocSize.js";

const budgetStates = new Map<string, OsmNationalWriteBudgetState>();

export function getWriteBudgetState(runId: string): OsmNationalWriteBudgetState {
  let state = budgetStates.get(runId);
  if (!state) {
    state = createWriteBudgetState();
    budgetStates.set(runId, state);
  }
  return state;
}

export function resetWriteBudgetStateForTests(): void {
  budgetStates.clear();
}

async function rateLimitDelay(maxWritesPerSecond: number): Promise<void> {
  if (maxWritesPerSecond <= 0) return;
  const delayMs = Math.ceil(1000 / maxWritesPerSecond);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function writeUnexploredChunkDocs(input: {
  run: OsmNationalRun;
  spots: UnexploredSpot[];
  routes: UnexploredRoute[];
  routeGeometry?: Array<{ routeId: string; coordinates: Array<{ lat: number; lng: number }> }>;
}): Promise<{
  writtenSpots: number;
  writtenRoutes: number;
  writeErrors: number;
  skippedBecauseDryRun: boolean;
}> {
  const dryRun = !input.run.writeMode || input.run.config.dryRunOnly;
  if (dryRun) {
    return {
      writtenSpots: 0,
      writtenRoutes: 0,
      writeErrors: 0,
      skippedBecauseDryRun: true,
    };
  }

  const writeTarget = input.run.writeTarget;
  const writeOptions: OsmNationalWriteOptions = {
    writeTarget,
    operation: "writeUnexploredChunkDocs",
    confirmProductionWrite: input.run.confirmProductionWrite,
  };

  const budget: OsmNationalWriteBudget = {
    maxTotalWrites: input.run.config.maxTotalWrites,
    maxWritesPerMinute: input.run.config.maxWritesPerMinute,
    maxWritesPerSecond: input.run.config.maxWritesPerSecond,
    maxStateWrites: input.run.config.maxStateWrites,
    maxChunkWrites: input.run.config.maxChunkWrites,
    stopOnBudgetExceeded: input.run.config.stopOnBudgetExceeded,
  };

  const budgetState = getWriteBudgetState(input.run.runId);
  let writeErrors = 0;

  try {
    const pending = input.spots.length + input.routes.length;
    assertWriteBudgetAllows(budget, budgetState, pending);
  } catch (error) {
    if (error instanceof OsmNationalBudgetExceededError) {
      throw error;
    }
    throw error;
  }

  await rateLimitDelay(input.run.config.maxWritesPerSecond);

  let writtenSpots = 0;
  let writtenRoutes = 0;

  try {
    writtenSpots = await bulkWriteUnexploredSpots(input.spots, writeOptions);
    recordWriteBudgetUsage(budgetState, writtenSpots);
  } catch (error) {
    writeErrors += 1;
    console.error("bulkWriteUnexploredSpots_failed", error);
  }

  try {
    writtenRoutes = await bulkWriteUnexploredRoutes(input.routes, writeOptions);
    recordWriteBudgetUsage(budgetState, writtenRoutes);
  } catch (error) {
    writeErrors += 1;
    console.error("bulkWriteUnexploredRoutes_failed", error);
  }

  if (input.routeGeometry) {
    for (const item of input.routeGeometry) {
      const chunks = splitLargeGeometry({ coordinates: item.coordinates });
      if (chunks.length <= 1) continue;
      for (let i = 0; i < chunks.length; i += 1) {
        try {
          await writeRouteGeometryChunk({
            routeId: item.routeId,
            chunkIndex: i,
            coordinates: chunks[i],
            options: writeOptions,
          });
        } catch (error) {
          writeErrors += 1;
          console.error("writeRouteGeometryChunk_failed", error);
        }
      }
    }
  }

  return { writtenSpots, writtenRoutes, writeErrors, skippedBecauseDryRun: false };
}

export function collectRouteGeometryOverflow(routes: UnexploredRoute[], inventoryRoutes: LocavaInventoryRoute[]): Array<{
  routeId: string;
  coordinates: Array<{ lat: number; lng: number }>;
}> {
  const bySourceKey = new Map(inventoryRoutes.map((r) => [r.sourceKey, r]));
  const out: Array<{ routeId: string; coordinates: Array<{ lat: number; lng: number }> }> = [];
  for (const route of routes) {
    if (route.geometryStorage.mode !== "chunked_subcollection") continue;
    const inv = bySourceKey.get(route.sourceKeys[0] ?? "");
    if (inv?.coordinates && inv.coordinates.length > 500) {
      out.push({ routeId: route.id, coordinates: inv.coordinates });
    }
  }
  return out;
}
