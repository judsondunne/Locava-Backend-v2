import type {
  InventoryImportRun,
  InventoryRoute,
  InventorySpot,
  InventoryTilePayload,
} from "../../contracts/entities/inventory-entities.contract.js";

export type InventoryRunArtifacts = {
  stagedSpots: InventorySpot[];
  stagedRoutes: InventoryRoute[];
  tilePreview: InventoryTilePayload[];
};

const runs = new Map<string, InventoryImportRun>();
const artifacts = new Map<string, InventoryRunArtifacts>();
let latestRunId: string | null = null;

export function putInventoryRun(run: InventoryImportRun, staged?: Partial<InventoryRunArtifacts>): void {
  runs.set(run.runId, run);
  latestRunId = run.runId;
  if (staged) {
    artifacts.set(run.runId, {
      stagedSpots: staged.stagedSpots ?? artifacts.get(run.runId)?.stagedSpots ?? [],
      stagedRoutes: staged.stagedRoutes ?? artifacts.get(run.runId)?.stagedRoutes ?? [],
      tilePreview: staged.tilePreview ?? artifacts.get(run.runId)?.tilePreview ?? [],
    });
  }
}

export function getInventoryRunMemory(runId: string): InventoryImportRun | null {
  return runs.get(runId) ?? null;
}

export function getInventoryRunArtifacts(runId: string): InventoryRunArtifacts | null {
  return artifacts.get(runId) ?? null;
}

export function listInventoryRunsMemory(limit = 50): InventoryImportRun[] {
  return [...runs.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

export function getLatestInventoryRunMemory(): InventoryImportRun | null {
  if (!latestRunId) return null;
  return runs.get(latestRunId) ?? null;
}

export function updateInventoryRunMemory(runId: string, patch: Partial<InventoryImportRun>): InventoryImportRun | null {
  const existing = runs.get(runId);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  runs.set(runId, next);
  return next;
}

export function setInventoryRunTilePreview(runId: string, tilePreview: InventoryTilePayload[]): void {
  const existing = artifacts.get(runId) ?? { stagedSpots: [], stagedRoutes: [], tilePreview: [] };
  artifacts.set(runId, { ...existing, tilePreview });
}

export function resetInventoryRunStoreForTests(): void {
  runs.clear();
  artifacts.clear();
  latestRunId = null;
}

/** Clears in-memory run state so the admin UI starts fresh. */
export function clearInventorySession(): void {
  resetInventoryRunStoreForTests();
}
