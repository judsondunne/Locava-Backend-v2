import { AsyncLocalStorage } from "node:async_hooks";
import { getAuditRequestContext, getRequestContext, runOutsideRequestContext } from "../observability/request-context.js";
import type { FirebaseAccessGate } from "./firebase-access-gate-context.js";
import { runWithFirebaseAccessGate } from "./firebase-access-gate-context.js";

export type BackgroundWorkOrigin = {
  auditRunId: string | null;
  auditSpecId: string | null;
  auditSpecName: string | null;
  requestId: string | null;
  source: "request" | "background" | "unknown";
  firebaseGate?: FirebaseAccessGate;
};

export type BackgroundWorkFilter = {
  auditRunId?: string;
  auditSpecId?: string;
};

type BackgroundJob = {
  id: number;
  timer: NodeJS.Timeout;
  promise: Promise<void>;
  resolve: () => void;
  work: () => Promise<void> | void;
  delayMs: number;
  state: "queued" | "running";
  scheduledAtEpochMs: number;
  startedAtEpochMs: number | null;
  label: string | null;
  origin: BackgroundWorkOrigin;
};

const pendingJobs = new Set<BackgroundJob>();
const readyQueue: BackgroundJob[] = [];
const originStorage = new AsyncLocalStorage<BackgroundWorkOrigin | undefined>();
let nextJobId = 1;
let activeJobCount = 0;
const MAX_CONCURRENT_BACKGROUND_JOBS = 1;

function trackJob(job: BackgroundJob): void {
  pendingJobs.add(job);
  void job.promise.finally(() => {
    pendingJobs.delete(job);
  });
}

export function scheduleBackgroundWork(
  work: () => Promise<void> | void,
  delayMs = 0,
  options: { label?: string } = {}
): void {
  let resolveJob!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveJob = resolve;
  });
  const job: BackgroundJob = {
    id: nextJobId++,
    timer: undefined as unknown as NodeJS.Timeout,
    promise,
    resolve: resolveJob,
    work,
    delayMs: Math.max(0, delayMs),
    state: "queued",
    scheduledAtEpochMs: Date.now(),
    startedAtEpochMs: null,
    label: options.label?.trim() || null,
    origin: captureBackgroundWorkOrigin()
  };
  const timer = setTimeout(() => {
    readyQueue.push(job);
    drainBackgroundQueue();
  }, job.delayMs);
  job.timer = timer;
  timer.unref?.();
  trackJob(job);
}

export async function flushBackgroundWorkForTests(
  filter: BackgroundWorkFilter & { timeoutMs?: number } = {}
): Promise<void> {
  const timeoutMs = Math.max(1_000, filter.timeoutMs ?? 30_000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const jobs = getMatchingBackgroundJobs(filter);
    if (jobs.length === 0) return;
    setJobsTimerRef(jobs, true);
    try {
      await Promise.allSettled(jobs.map((job) => job.promise));
      // Let job-finally cleanup remove settled entries from the pending set
      // before the next polling iteration snapshots background work state.
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      setJobsTimerRef(jobs, false);
    }
  }
  const snapshot = getBackgroundWorkSnapshotForTests(filter);
  throw new Error(
    `background_work_drain_timeout:${snapshot.total}:queued=${snapshot.queued}:active=${snapshot.active}`
  );
}

export function resetBackgroundWorkForTests(): void {
  for (const job of pendingJobs) {
    clearTimeout(job.timer);
    job.resolve();
  }
  pendingJobs.clear();
  readyQueue.length = 0;
  activeJobCount = 0;
}

export function getBackgroundWorkSnapshotForTests(filter: BackgroundWorkFilter = {}): {
  total: number;
  queued: number;
  active: number;
  jobs: Array<{
    id: number;
    delayMs: number;
    state: "queued" | "running";
    label: string | null;
    origin: BackgroundWorkOrigin;
  }>;
} {
  const jobs = getMatchingBackgroundJobs(filter);
  return {
    total: jobs.length,
    queued: jobs.filter((job) => job.state === "queued").length,
    active: jobs.filter((job) => job.state === "running").length,
    jobs: jobs.map((job) => ({
      id: job.id,
      delayMs: job.delayMs,
      state: job.state,
      label: job.label,
      origin: { ...job.origin }
    }))
  };
}

function getMatchingBackgroundJobs(filter: BackgroundWorkFilter): BackgroundJob[] {
  return [...pendingJobs].filter((job) => matchesFilter(job.origin, filter));
}

function setJobsTimerRef(jobs: BackgroundJob[], shouldRef: boolean): void {
  for (const job of jobs) {
    if (shouldRef) {
      job.timer.ref?.();
    } else {
      job.timer.unref?.();
    }
  }
}

function matchesFilter(origin: BackgroundWorkOrigin, filter: BackgroundWorkFilter): boolean {
  if (filter.auditRunId && origin.auditRunId !== filter.auditRunId) return false;
  if (filter.auditSpecId && origin.auditSpecId !== filter.auditSpecId) return false;
  return true;
}

function captureBackgroundWorkOrigin(): BackgroundWorkOrigin {
  const inherited = originStorage.getStore();
  if (inherited) {
    return { ...inherited, source: "background" };
  }
  const audit = getAuditRequestContext();
  const request = getRequestContext();
  return {
    auditRunId: audit?.auditRunId ?? null,
    auditSpecId: audit?.auditSpecId ?? null,
    auditSpecName: audit?.auditSpecName ?? null,
    requestId: request?.requestId ?? null,
    source: request ? "request" : "unknown",
    firebaseGate: request?.firebaseAccess
  };
}

function drainBackgroundQueue(): void {
  while (activeJobCount < MAX_CONCURRENT_BACKGROUND_JOBS && readyQueue.length > 0) {
    const job = readyQueue.shift();
    if (!job) return;
    activeJobCount += 1;
    job.state = "running";
    job.startedAtEpochMs = Date.now();
    runOutsideRequestContext(() => {
      originStorage.run(job.origin, () => {
        const gate: FirebaseAccessGate =
          job.origin.firebaseGate ??
          ({
            allowCategory: "BACKEND_V2_ALLOWED",
            legacy: false,
            surface: "background-default"
          } satisfies FirebaseAccessGate);
        runWithFirebaseAccessGate(gate, () => {
          void Promise.resolve()
            .then(job.work)
            .catch(() => undefined)
            .finally(() => {
              activeJobCount = Math.max(0, activeJobCount - 1);
              job.resolve();
              drainBackgroundQueue();
            });
        });
      });
    });
  }
}
