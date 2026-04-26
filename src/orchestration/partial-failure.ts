export type StepOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

export async function runStep<T>(label: string, fn: () => Promise<T>): Promise<StepOutcome<T>> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, code: `${label}_failed`, message };
  }
}
