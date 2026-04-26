import { getCoherenceProvider } from "../runtime/coherence-provider.js";

const tails = new Map<string, Promise<void>>();
const DISTRIBUTED_LOCK_TTL_MS = 8_000;
const DISTRIBUTED_LOCK_WAIT_MS = 6_000;
const DISTRIBUTED_LOCK_STEP_MS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withMutationLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const provider = getCoherenceProvider();
  if (provider.isDistributed) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < DISTRIBUTED_LOCK_WAIT_MS) {
      const lease = await provider.tryAcquireLease(`mutation:${key}`, DISTRIBUTED_LOCK_TTL_MS);
      if (lease.acquired) {
        try {
          return await fn();
        } finally {
          await provider.releaseLease(`mutation:${key}`, lease.token);
        }
      }
      await sleep(DISTRIBUTED_LOCK_STEP_MS);
    }
    throw new Error("mutation_lock_timeout");
  }

  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  tails.set(key, previous.then(() => next));
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === next) {
      tails.delete(key);
    }
  }
}
