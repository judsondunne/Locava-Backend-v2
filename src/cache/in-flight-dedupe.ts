import { recordDedupeHit, recordDedupeMiss } from "../observability/request-context.js";
import { getCoherenceProvider } from "../runtime/coherence-provider.js";

const inFlight = new Map<string, Promise<unknown>>();
const DISTRIBUTED_LEASE_TTL_MS = 5_000;
const DISTRIBUTED_RESULT_TTL_MS = 2_000;
const DISTRIBUTED_WAIT_WINDOW_MS = 3_000;
const DISTRIBUTED_WAIT_STEP_MS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function dedupeInFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    recordDedupeHit();
    return existing as Promise<T>;
  }

  const promise = runWithOptionalDistributedDedupe(key, work).finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

async function runWithOptionalDistributedDedupe<T>(key: string, work: () => Promise<T>): Promise<T> {
  const provider = getCoherenceProvider();
  if (!provider.isDistributed) {
    recordDedupeMiss();
    return work();
  }

  const existingResult = await provider.getDedupeResult<T>(key);
  if (existingResult !== undefined) {
    recordDedupeHit();
    return existingResult;
  }

  const lease = await provider.tryAcquireLease(`dedupe:${key}`, DISTRIBUTED_LEASE_TTL_MS);
  if (lease.acquired) {
    recordDedupeMiss();
    try {
      const result = await work();
      await provider.setDedupeResult(key, result, DISTRIBUTED_RESULT_TTL_MS);
      return result;
    } finally {
      await provider.releaseLease(`dedupe:${key}`, lease.token);
    }
  }

  recordDedupeHit();
  const attempts = Math.max(1, Math.floor(DISTRIBUTED_WAIT_WINDOW_MS / DISTRIBUTED_WAIT_STEP_MS));
  for (let i = 0; i < attempts; i += 1) {
    await sleep(DISTRIBUTED_WAIT_STEP_MS);
    const result = await provider.getDedupeResult<T>(key);
    if (result !== undefined) {
      return result;
    }
  }

  // Fallback guard: avoid request hangs if lease holder crashes.
  recordDedupeMiss();
  return work();
}
