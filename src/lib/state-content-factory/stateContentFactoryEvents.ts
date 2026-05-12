import { randomUUID } from "node:crypto";
import type { StateContentFactoryRunEvent } from "./types.js";

export function createStateContentFactoryRunId(): string {
  return `scf_${randomUUID()}`;
}

export function stateContentFactoryEvent(
  input: Omit<StateContentFactoryRunEvent, "cursor" | "timestamp">,
): StateContentFactoryRunEvent {
  return {
    ...input,
    timestamp: new Date().toISOString(),
  };
}
