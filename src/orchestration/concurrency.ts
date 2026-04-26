export async function runLimited<T>(items: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
  if (limit < 1) {
    throw new Error("limit must be >= 1");
  }

  const results: T[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const currentIndex = next;
      next += 1;
      const task = items[currentIndex];
      if (!task) {
        break;
      }
      results[currentIndex] = await task();
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
