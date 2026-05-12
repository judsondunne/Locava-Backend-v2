import fs from "node:fs";
import path from "node:path";
import type { WikimediaMvpRunEvent, WikimediaMvpRunEventLevel, WikimediaMvpRunState } from "./WikimediaMvpTypes.js";

const runs = new Map<string, WikimediaMvpRunState>();
const eventSubscribers = new Map<string, Set<(event: WikimediaMvpRunEvent) => void>>();

function runsDir(): string {
  return path.resolve(process.cwd(), ".tmp", "wikimedia-mvp-runs");
}

function persistRun(run: WikimediaMvpRunState): void {
  const dir = runsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${run.runId}.json`), JSON.stringify(run, null, 2), "utf8");
}

export function saveWikimediaMvpRun(run: WikimediaMvpRunState): void {
  runs.set(run.runId, run);
  try {
    persistRun(run);
  } catch {
    // Best-effort local persistence for dev runs.
  }
}

export function getWikimediaMvpRun(runId: string): WikimediaMvpRunState | null {
  return runs.get(runId) ?? null;
}

export function clearWikimediaMvpRuns(): void {
  runs.clear();
  eventSubscribers.clear();
  try {
    const dir = runsDir();
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        if (file.endsWith(".json")) {
          fs.unlinkSync(path.join(dir, file));
        }
      }
    }
  } catch {
    // ignore
  }
}

export function appendWikimediaMvpRunLog(run: WikimediaMvpRunState, line: string): void {
  run.logs.push(line);
  if (run.logs.length > 2000) {
    run.logs = run.logs.slice(-2000);
  }
  run.updatedAtMs = Date.now();
  saveWikimediaMvpRun(run);
}

export function appendWikimediaMvpRunEvent(
  run: WikimediaMvpRunState,
  input: {
    level?: WikimediaMvpRunEventLevel;
    placeName?: string;
    message: string;
    data?: Record<string, unknown>;
  },
): WikimediaMvpRunEvent {
  const event: WikimediaMvpRunEvent = {
    cursor: run.nextEventCursor,
    timestamp: new Date().toISOString(),
    level: input.level ?? "info",
    runId: run.runId,
    placeName: input.placeName,
    message: input.message,
    data: input.data,
  };
  run.events.push(event);
  run.nextEventCursor += 1;
  if (run.events.length > 4000) {
    run.events = run.events.slice(-4000);
  }
  appendWikimediaMvpRunLog(run, `[${event.level}] ${event.message}`);
  const subs = eventSubscribers.get(run.runId);
  if (subs) {
    for (const fn of subs) {
      fn(event);
    }
  }
  return event;
}

export function getWikimediaMvpRunEvents(runId: string, since = 0): WikimediaMvpRunEvent[] {
  const run = getWikimediaMvpRun(runId);
  if (!run) return [];
  return run.events.filter((event) => event.cursor >= since);
}

export function subscribeWikimediaMvpRunEvents(
  runId: string,
  listener: (event: WikimediaMvpRunEvent) => void,
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
