import type { AppEnv } from "../../config/env.js";
import { createStateContentFactoryRunId } from "./stateContentFactoryEvents.js";
import { runStateContentFactory } from "./runStateContentFactory.js";
import {
  appendStateContentFactoryRunEvent,
  getStateContentFactoryRun,
  saveStateContentFactoryRun,
} from "./stateContentFactoryRunStore.js";
import type { StateContentFactoryDevRunState, StateContentFactoryRunConfig } from "./types.js";

export function startStateContentFactoryRun(input: {
  env: AppEnv;
  config: StateContentFactoryRunConfig;
}): StateContentFactoryDevRunState {
  const run: StateContentFactoryDevRunState = {
    runId: createStateContentFactoryRunId(),
    status: "running",
    phase: "idle",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    request: input.config,
    result: null,
    error: null,
    logs: [],
    events: [],
    nextEventCursor: 0,
  };
  saveStateContentFactoryRun(run);
  void executeStateContentFactoryRun(run.runId, input.env);
  return run;
}

export async function executeStateContentFactoryRun(runId: string, env: AppEnv): Promise<void> {
  const run = getStateContentFactoryRun(runId);
  if (!run) return;
  try {
    const result = await runStateContentFactory({ env, run });
    run.status = "completed";
    run.phase = "complete";
    run.result = result;
    run.error = null;
    run.updatedAtMs = Date.now();
    saveStateContentFactoryRun(run);
  } catch (error) {
    run.status = "failed";
    run.phase = "failed";
    run.error = error instanceof Error ? error.message : String(error);
    run.updatedAtMs = Date.now();
    appendStateContentFactoryRunEvent(run, {
      type: "STATE_CONTENT_RUN_FAILED",
      phase: "failed",
      message: run.error,
    });
    saveStateContentFactoryRun(run);
  }
}
