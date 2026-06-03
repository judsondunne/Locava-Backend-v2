import { createHash } from "node:crypto";
import type {
  OsmNationalCopierEvent,
  OsmNationalCopierRun,
} from "./osmNationalCopierTypes.js";

/**
 * In-memory progress store for copier runs.
 *
 * The copier never writes its progress to Firestore. Runs only live as long
 * as the server process; reloads start fresh. This is intentional — we want
 * the path that writes unexploredSpots/unexploredRoutes to be the ONLY thing
 * that touches Firestore in the copier flow.
 */

const runs = new Map<string, OsmNationalCopierRun>();
const events = new Map<string, OsmNationalCopierEvent[]>();
const MAX_EVENTS_PER_RUN = 500;

export function copierBuildRunId(): string {
  const ts = Date.now().toString(36);
  const rand = createHash("sha256")
    .update(`${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 8);
  return `osm_copier_${ts}_${rand}`;
}

export function copierBuildEventId(): string {
  return `cevt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function putCopierRun(run: OsmNationalCopierRun): void {
  runs.set(run.runId, { ...run, updatedAt: new Date().toISOString() });
}

export function getCopierRun(runId: string): OsmNationalCopierRun | null {
  return runs.get(runId) ?? null;
}

export function listCopierRuns(limit = 20): OsmNationalCopierRun[] {
  return [...runs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function deleteCopierRun(runId: string): void {
  runs.delete(runId);
  events.delete(runId);
}

export function appendCopierEvent(event: OsmNationalCopierEvent): void {
  const list = events.get(event.runId) ?? [];
  list.unshift(event);
  if (list.length > MAX_EVENTS_PER_RUN) list.length = MAX_EVENTS_PER_RUN;
  events.set(event.runId, list);
}

export function listCopierEvents(runId: string, limit = 100): OsmNationalCopierEvent[] {
  return (events.get(runId) ?? []).slice(0, limit);
}

export function resetCopierProgressStoreForTests(): void {
  runs.clear();
  events.clear();
}
