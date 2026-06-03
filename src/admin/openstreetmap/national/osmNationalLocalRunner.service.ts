import { listOsmChunkRuns, listOsmStateRuns } from "../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";
import { getNationalRunOrThrow } from "./osmNationalRun.service.js";
import { processChunk } from "./osmNationalChunkWorker.service.js";
import { runWithConcurrencyLimit } from "../../../lib/inventory/offroad/offroadChunking.js";

export type ProcessNextChunksResult = {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: Array<{ stateCode: string; chunkId: string; ok: boolean; reason?: string }>;
};

export async function findPendingChunks(runId: string, limit: number): Promise<Array<{ stateCode: string; chunkId: string }>> {
  const run = await getNationalRunOrThrow(runId);
  const states = await listOsmStateRuns(runId, run.config.states.length || 60);
  const pending: Array<{ stateCode: string; chunkId: string }> = [];

  for (const state of states) {
    const chunks = await listOsmChunkRuns(runId, state.stateCode, { status: "pending", limit: 500 });
    for (const chunk of chunks) {
      pending.push({ stateCode: state.stateCode, chunkId: chunk.chunkId });
      if (pending.length >= limit) return pending;
    }
  }

  return pending;
}

export async function processNextChunks(input: {
  runId: string;
  limit?: number;
}): Promise<ProcessNextChunksResult> {
  const run = await getNationalRunOrThrow(input.runId);
  if (run.status !== "running") {
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0, results: [] };
  }

  const limit = input.limit ?? 1;
  const pending = await findPendingChunks(input.runId, limit);
  const results: ProcessNextChunksResult["results"] = [];

  const outcomes = await runWithConcurrencyLimit(
    pending,
    run.config.maxConcurrentChunks,
    async (item) => {
      const result = await processChunk({
        runId: input.runId,
        stateCode: item.stateCode,
        chunkId: item.chunkId,
      });
      return { ...item, ...result };
    }
  );

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const outcome of outcomes) {
    results.push({
      stateCode: outcome.stateCode,
      chunkId: outcome.chunkId,
      ok: outcome.ok,
      reason: outcome.reason,
    });
    if (outcome.skipped) skipped += 1;
    else if (outcome.ok) succeeded += 1;
    else failed += 1;
  }

  return {
    processed: outcomes.length,
    succeeded,
    failed,
    skipped,
    results,
  };
}

export async function processChunksForState(input: {
  runId: string;
  stateCode: string;
  limit?: number;
}): Promise<ProcessNextChunksResult> {
  const chunks = await listOsmChunkRuns(input.runId, input.stateCode, { status: "pending", limit: input.limit ?? 100 });
  const results: ProcessNextChunksResult["results"] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const chunk of chunks) {
    const result = await processChunk({
      runId: input.runId,
      stateCode: input.stateCode,
      chunkId: chunk.chunkId,
    });
    results.push({
      stateCode: input.stateCode,
      chunkId: chunk.chunkId,
      ok: result.ok,
      reason: result.reason,
    });
    if (result.skipped) skipped += 1;
    else if (result.ok) succeeded += 1;
    else failed += 1;
  }

  return { processed: chunks.length, succeeded, failed, skipped, results };
}
