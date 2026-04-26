import { recordConcurrencyWait } from "../observability/request-context.js";

const activeByKey = new Map<string, number>();
const queueByKey = new Map<string, Array<() => void>>();

export async function withConcurrencyLimit<T>(key: string, limit: number, work: () => Promise<T>): Promise<T> {
  if (limit < 1) {
    throw new Error("concurrency limit must be >= 1");
  }

  const active = activeByKey.get(key) ?? 0;
  if (active >= limit) {
    recordConcurrencyWait();
    await new Promise<void>((resolve) => {
      const queue = queueByKey.get(key) ?? [];
      queue.push(resolve);
      queueByKey.set(key, queue);
    });
  }

  activeByKey.set(key, (activeByKey.get(key) ?? 0) + 1);
  try {
    return await work();
  } finally {
    const nextActive = Math.max(0, (activeByKey.get(key) ?? 1) - 1);
    activeByKey.set(key, nextActive);
    const queue = queueByKey.get(key) ?? [];
    const next = queue.shift();
    if (queue.length === 0) {
      queueByKey.delete(key);
    } else {
      queueByKey.set(key, queue);
    }
    if (next) {
      next();
    }
  }
}
