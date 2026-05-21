import { randomUUID } from "node:crypto";

type JobListener = (line: string) => void;

export type WikiCurationJobRecord = {
  id: string;
  secret: string;
  logs: string[];
  listeners: Set<JobListener>;
  result: unknown | null;
  error: string | null;
  status: "running" | "complete" | "failed";
  createdAtMs: number;
};

const jobs = new Map<string, WikiCurationJobRecord>();
const JOB_TTL_MS = 60 * 60 * 1000;

function pruneOldJobs(): void {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.createdAtMs > JOB_TTL_MS) jobs.delete(id);
  }
}

export function wikiCurationCreateJob(): { jobId: string; secret: string } {
  pruneOldJobs();
  const jobId = randomUUID();
  const secret = randomUUID();
  jobs.set(jobId, {
    id: jobId,
    secret,
    logs: [],
    listeners: new Set(),
    result: null,
    error: null,
    status: "running",
    createdAtMs: Date.now()
  });
  return { jobId, secret };
}

export function wikiCurationGetJob(jobId: string): WikiCurationJobRecord | undefined {
  return jobs.get(jobId);
}

export function wikiCurationVerifyJobSecret(job: WikiCurationJobRecord, secret: string): boolean {
  return Boolean(secret) && secret === job.secret;
}

export function wikiCurationAppendLog(jobId: string, line: string): void {
  const j = jobs.get(jobId);
  if (!j) return;
  const safe = String(line || "").replace(/\r|\n/g, " ").slice(0, 800);
  j.logs.push(safe);
  for (const fn of j.listeners) {
    try {
      fn(safe);
    } catch {
      /* ignore */
    }
  }
}

export function wikiCurationSubscribe(jobId: string, fn: JobListener): () => void {
  const j = jobs.get(jobId);
  if (!j) return () => {};
  j.listeners.add(fn);
  return () => {
    j.listeners.delete(fn);
  };
}

export function wikiCurationCompleteJob(jobId: string, result: unknown): void {
  const j = jobs.get(jobId);
  if (!j) return;
  j.status = "complete";
  j.result = result;
  wikiCurationAppendLog(jobId, "dry-run complete");
}

export function wikiCurationFailJob(jobId: string, message: string): void {
  const j = jobs.get(jobId);
  if (!j) return;
  j.status = "failed";
  j.error = String(message || "failed").slice(0, 2000);
  wikiCurationAppendLog(jobId, `error: ${j.error}`);
}
