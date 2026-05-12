import { randomUUID } from "node:crypto";
import type { PlaceCandidateRunEvent } from "./types.js";

export function createPlaceCandidateRunId(): string {
  return randomUUID();
}

export function placeCandidateEvent(
  input: Omit<PlaceCandidateRunEvent, "runId" | "dryRun"> & { runId: string; dryRun?: boolean },
): PlaceCandidateRunEvent {
  return {
    ...input,
    dryRun: input.dryRun !== false,
  };
}
