import { createHash } from "node:crypto";
import type { PbfCopierEvent, PbfCopierRun } from "./pbfCopierTypes.js";

/**
 * In-memory progress store for PBF copier runs.
 *
 * Identical pattern to the Overpass copier — the only thing that ever
 * touches Firestore in the PBF copier flow is the write path
 * (`bulkWriteUnexploredSpots` / `bulkWriteUnexploredRoutes`), and only
 * when the user has explicitly chosen write mode + a write target. Progress
 * itself is never persisted.
 */

const runs = new Map<string, PbfCopierRun>();
const events = new Map<string, PbfCopierEvent[]>();
const dryRunProofs = new Map<string, { runId: string; createdAt: string }>();

const MAX_EVENTS_PER_RUN = 500;
const MAX_DRY_RUN_PROOFS = 50;

export function pbfBuildRunId(): string {
  const ts = Date.now().toString(36);
  const rand = createHash("sha256")
    .update(`${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 8);
  return `osm_pbf_copier_${ts}_${rand}`;
}

export function pbfBuildEventId(): string {
  return `pbfevt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function putPbfRun(run: PbfCopierRun): void {
  runs.set(run.runId, { ...run, updatedAt: new Date().toISOString() });
}

export function getPbfRun(runId: string): PbfCopierRun | null {
  return runs.get(runId) ?? null;
}

export function listPbfRuns(limit = 20): PbfCopierRun[] {
  return [...runs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function deletePbfRun(runId: string): void {
  runs.delete(runId);
  events.delete(runId);
}

export function appendPbfEvent(event: PbfCopierEvent): void {
  const list = events.get(event.runId) ?? [];
  list.unshift(event);
  if (list.length > MAX_EVENTS_PER_RUN) list.length = MAX_EVENTS_PER_RUN;
  events.set(event.runId, list);
}

export function listPbfEvents(runId: string, limit = 100): PbfCopierEvent[] {
  return (events.get(runId) ?? []).slice(0, limit);
}

export function rememberPbfDryRunProof(token: string, runId: string): void {
  dryRunProofs.set(token, { runId, createdAt: new Date().toISOString() });
  if (dryRunProofs.size > MAX_DRY_RUN_PROOFS) {
    const oldestKey = [...dryRunProofs.keys()][0];
    if (oldestKey) dryRunProofs.delete(oldestKey);
  }
}

export function hasPbfDryRunProof(token: string): boolean {
  return dryRunProofs.has(token);
}

export function listPbfDryRunProofs(): Array<{ token: string; runId: string; createdAt: string }> {
  return [...dryRunProofs.entries()].map(([token, info]) => ({ token, ...info }));
}

export function resetPbfCopierStoreForTests(): void {
  runs.clear();
  events.clear();
  dryRunProofs.clear();
}
