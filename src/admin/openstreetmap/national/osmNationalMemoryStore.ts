import type {
  OsmChunkRun,
  OsmNationalEvent,
  OsmNationalRun,
  OsmStateRun,
} from "../../../contracts/entities/osm-national-entities.contract.js";

const runs = new Map<string, OsmNationalRun>();
const stateRuns = new Map<string, OsmStateRun>();
const chunkRuns = new Map<string, OsmChunkRun>();
const events = new Map<string, OsmNationalEvent>();

function stateKey(runId: string, stateCode: string): string {
  return `${runId}:${stateCode.toUpperCase()}`;
}

function chunkKey(runId: string, stateCode: string, chunkId: string): string {
  return `${runId}:${stateCode.toUpperCase()}:${chunkId}`;
}

function eventKey(runId: string, eventId: string): string {
  return `${runId}:${eventId}`;
}

function effectiveNodeEnv(): string {
  return process.env.NODE_ENV?.trim() || "development";
}

export function isOsmNationalMemoryStoreEnabled(): boolean {
  if (process.env.OSM_NATIONAL_MEMORY_STORE === "false") return false;
  if (process.env.OSM_NATIONAL_MEMORY_STORE === "true") return true;
  const nodeEnv = effectiveNodeEnv();
  if (nodeEnv === "test") return true;
  // Local admin dashboard dry-runs should work without Firestore credentials.
  if (nodeEnv === "development") return true;
  return false;
}

export function memoryPutNationalRun(run: OsmNationalRun): void {
  runs.set(run.runId, run);
}

export function memoryGetNationalRun(runId: string): OsmNationalRun | null {
  return runs.get(runId) ?? null;
}

export function memoryListNationalRuns(limit = 20): OsmNationalRun[] {
  return [...runs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function memoryPutStateRun(run: OsmStateRun): void {
  stateRuns.set(stateKey(run.runId, run.stateCode), run);
}

export function memoryListStateRuns(runId: string): OsmStateRun[] {
  return [...stateRuns.values()].filter((s) => s.runId === runId);
}

export function memoryGetStateRun(runId: string, stateCode: string): OsmStateRun | null {
  return stateRuns.get(stateKey(runId, stateCode)) ?? null;
}

export function memoryPutChunkRun(chunk: OsmChunkRun): void {
  chunkRuns.set(chunkKey(chunk.runId, chunk.stateCode, chunk.chunkId), chunk);
}

export function memoryListChunkRuns(
  runId: string,
  stateCode: string,
  input?: { limit?: number; status?: OsmChunkRun["status"] }
): OsmChunkRun[] {
  let list = [...chunkRuns.values()].filter(
    (c) => c.runId === runId && c.stateCode.toUpperCase() === stateCode.toUpperCase()
  );
  if (input?.status) list = list.filter((c) => c.status === input.status);
  list.sort((a, b) => a.chunkIndex - b.chunkIndex);
  return list.slice(0, input?.limit ?? 200);
}

export function memoryGetChunkRun(runId: string, stateCode: string, chunkId: string): OsmChunkRun | null {
  return chunkRuns.get(chunkKey(runId, stateCode, chunkId)) ?? null;
}

export function memoryPutEvent(event: OsmNationalEvent): void {
  events.set(eventKey(event.runId, event.eventId), event);
}

export function memoryListEvents(runId: string, limit = 100): OsmNationalEvent[] {
  return [...events.values()]
    .filter((e) => e.runId === runId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function resetOsmNationalMemoryStore(): void {
  runs.clear();
  stateRuns.clear();
  chunkRuns.clear();
  events.clear();
}
