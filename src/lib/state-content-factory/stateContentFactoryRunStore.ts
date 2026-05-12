import type { StateContentFactoryDevRunState, StateContentFactoryRunEvent } from "./types.js";

const runs = new Map<string, StateContentFactoryDevRunState>();
const eventSubscribers = new Map<string, Set<(event: StateContentFactoryRunEvent) => void>>();

export function saveStateContentFactoryRun(run: StateContentFactoryDevRunState): void {
  runs.set(run.runId, run);
}

export function getStateContentFactoryRun(runId: string): StateContentFactoryDevRunState | null {
  return runs.get(runId) ?? null;
}

export function listStateContentFactoryRuns(limit = 20): StateContentFactoryDevRunState[] {
  return [...runs.values()]
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, Math.max(1, limit));
}

export function clearStateContentFactoryRuns(): void {
  runs.clear();
  eventSubscribers.clear();
}

function formatLogLine(event: StateContentFactoryRunEvent): string {
  const parts = [event.timestamp ?? new Date().toISOString(), event.type];
  if (event.phase) parts.push(`phase=${event.phase}`);
  if (event.placeName) parts.push(`place=${event.placeName}`);
  if (event.message) parts.push(event.message);
  if (event.counts) parts.push(JSON.stringify(event.counts));
  if (event.elapsedMs != null) parts.push(`elapsedMs=${event.elapsedMs}`);
  return parts.join(" ");
}

export function appendStateContentFactoryRunEvent(
  run: StateContentFactoryDevRunState,
  input: Omit<StateContentFactoryRunEvent, "runId" | "cursor" | "timestamp">,
): StateContentFactoryRunEvent {
  const event: StateContentFactoryRunEvent = {
    ...input,
    cursor: run.nextEventCursor,
    timestamp: new Date().toISOString(),
    runId: run.runId,
    dryRun: run.request.runMode === "dry_run",
    allowStagingWrites: run.request.allowStagingWrites,
    publicPostsWritten: run.result?.publicPostsWritten ?? 0,
  };
  run.events.push(event);
  run.nextEventCursor += 1;
  if (run.events.length > 4000) {
    run.events = run.events.slice(-4000);
  }
  run.logs.push(formatLogLine(event));
  if (run.logs.length > 2000) {
    run.logs = run.logs.slice(-2000);
  }
  run.updatedAtMs = Date.now();
  saveStateContentFactoryRun(run);
  const subs = eventSubscribers.get(run.runId);
  if (subs) {
    for (const fn of subs) {
      fn(event);
    }
  }
  return event;
}

export function getStateContentFactoryRunEvents(runId: string, since = 0): StateContentFactoryRunEvent[] {
  const run = getStateContentFactoryRun(runId);
  if (!run) return [];
  return run.events.filter((event) => (event.cursor ?? 0) >= since);
}

export function subscribeStateContentFactoryRunEvents(
  runId: string,
  listener: (event: StateContentFactoryRunEvent) => void,
): () => void {
  const set = eventSubscribers.get(runId) ?? new Set();
  set.add(listener);
  eventSubscribers.set(runId, set);
  return () => {
    const current = eventSubscribers.get(runId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      eventSubscribers.delete(runId);
    }
  };
}
