import type { PlaceCandidateDevRunState, PlaceCandidateRunEvent } from "./types.js";

const runs = new Map<string, PlaceCandidateDevRunState>();
const eventSubscribers = new Map<string, Set<(event: PlaceCandidateRunEvent) => void>>();

export function savePlaceCandidateRun(run: PlaceCandidateDevRunState): void {
  runs.set(run.runId, run);
}

export function getPlaceCandidateRun(runId: string): PlaceCandidateDevRunState | null {
  return runs.get(runId) ?? null;
}

export function clearPlaceCandidateRuns(): void {
  runs.clear();
  eventSubscribers.clear();
}

function formatLogLine(event: PlaceCandidateRunEvent): string {
  const parts = [event.timestamp ?? new Date().toISOString(), event.type];
  if (event.source) parts.push(`source=${event.source}`);
  if (event.message) parts.push(event.message);
  if (event.counts) parts.push(JSON.stringify(event.counts));
  if (event.elapsedMs != null) parts.push(`elapsedMs=${event.elapsedMs}`);
  return parts.join(" ");
}

export function appendPlaceCandidateRunEvent(
  run: PlaceCandidateDevRunState,
  input: Omit<PlaceCandidateRunEvent, "runId" | "dryRun" | "cursor" | "timestamp">,
): PlaceCandidateRunEvent {
  const event: PlaceCandidateRunEvent = {
    ...input,
    cursor: run.nextEventCursor,
    timestamp: new Date().toISOString(),
    runId: run.runId,
    dryRun: true,
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
  savePlaceCandidateRun(run);
  const subs = eventSubscribers.get(run.runId);
  if (subs) {
    for (const fn of subs) {
      fn(event);
    }
  }
  return event;
}

export function getPlaceCandidateRunEvents(runId: string, since = 0): PlaceCandidateRunEvent[] {
  const run = getPlaceCandidateRun(runId);
  if (!run) return [];
  return run.events.filter((event) => (event.cursor ?? 0) >= since);
}

export function subscribePlaceCandidateRunEvents(
  runId: string,
  listener: (event: PlaceCandidateRunEvent) => void,
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
