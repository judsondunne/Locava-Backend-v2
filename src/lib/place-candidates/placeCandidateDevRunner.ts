import { createPlaceCandidateRunId } from "./placeCandidateRunEvents.js";
import { generateStatePlaceCandidates } from "./generateStatePlaceCandidates.js";
import {
  appendPlaceCandidateRunEvent,
  getPlaceCandidateRun,
  savePlaceCandidateRun,
} from "./placeCandidateRunStore.js";
import type { GenerateStatePlaceCandidatesRequest, PlaceCandidateDevRunState } from "./types.js";

export function startPlaceCandidateDevRun(
  request: GenerateStatePlaceCandidatesRequest,
): PlaceCandidateDevRunState {
  const run: PlaceCandidateDevRunState = {
    runId: createPlaceCandidateRunId(),
    status: "running",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    request,
    result: null,
    error: null,
    logs: [],
    events: [],
    nextEventCursor: 0,
  };
  savePlaceCandidateRun(run);
  void executePlaceCandidateDevRun(run.runId);
  return run;
}

export async function executePlaceCandidateDevRun(runId: string): Promise<void> {
  const run = getPlaceCandidateRun(runId);
  if (!run) return;
  try {
    const result = await generateStatePlaceCandidates(run.request, {
      runId: run.runId,
      onEvent: (event) => {
        appendPlaceCandidateRunEvent(run, event);
      },
    });
    run.status = "complete";
    run.result = result;
    run.error = null;
    run.updatedAtMs = Date.now();
    savePlaceCandidateRun(run);
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : String(error);
    run.updatedAtMs = Date.now();
    savePlaceCandidateRun(run);
  }
}
