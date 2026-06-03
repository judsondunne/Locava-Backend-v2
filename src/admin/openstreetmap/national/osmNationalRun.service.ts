import type { OsmNationalRun } from "../../../contracts/entities/osm-national-entities.contract.js";
import {
  getOsmNationalRun,
  listOsmChunkRuns,
  listOsmStateRuns,
  writeOsmNationalRun,
  type OsmNationalWriteOptions,
} from "../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";
import { OSM_NATIONAL_PRODUCTION_CONFIRMATION } from "./osmNationalWriteGuard.js";
import { logOsmNationalEvent } from "./osmNationalEventLogger.js";
import { aggregateNationalProgress, addCounts } from "./osmNationalProgress.service.js";
import { emptyOsmNationalCounts } from "../../../contracts/entities/osm-national-entities.contract.js";

function writeOptionsForRun(run: OsmNationalRun): OsmNationalWriteOptions {
  return {
    writeTarget: run.writeTarget,
    operation: "osmNationalRunLifecycle",
    confirmProductionWrite: run.confirmProductionWrite,
    progressOnly: run.writeTarget === "none",
  };
}

export async function getNationalRunOrThrow(runId: string): Promise<OsmNationalRun> {
  const run = await getOsmNationalRun(runId);
  if (!run) throw new Error(`run_not_found:${runId}`);
  return run;
}

export async function startNationalRun(runId: string): Promise<OsmNationalRun> {
  const run = await getNationalRunOrThrow(runId);
  if (run.status === "running") return run;
  if (run.status === "cancelled" || run.status === "completed") {
    throw new Error(`run_not_startable:${run.status}`);
  }

  if (run.writeMode && run.writeTarget === "production") {
    if (run.confirmProductionWrite !== OSM_NATIONAL_PRODUCTION_CONFIRMATION) {
      throw new Error("production_write_confirmation_required");
    }
  }

  const now = new Date().toISOString();
  const updated: OsmNationalRun = {
    ...run,
    status: "running",
    progress: {
      ...run.progress,
      startedAt: run.progress.startedAt ?? now,
      updatedAt: now,
    },
    currentActivity: {
      stateCode: null,
      chunkId: null,
      step: "starting",
      message: "National run started",
      startedAt: now,
    },
    updatedAt: now,
  };

  await writeOsmNationalRun(updated, writeOptionsForRun(updated));
  await logOsmNationalEvent({
    runId,
    level: "info",
    type: "run_started",
    message: "National run started",
    writeOptions: writeOptionsForRun(updated),
    force: true,
  });
  return updated;
}

export async function pauseNationalRun(runId: string): Promise<OsmNationalRun> {
  const run = await getNationalRunOrThrow(runId);
  const now = new Date().toISOString();
  const updated: OsmNationalRun = {
    ...run,
    status: "paused",
    currentActivity: {
      ...run.currentActivity,
      step: "paused",
      message: "Run paused",
      startedAt: now,
    },
    updatedAt: now,
  };
  await writeOsmNationalRun(updated, writeOptionsForRun(updated));
  await logOsmNationalEvent({
    runId,
    level: "info",
    type: "paused",
    message: "Run paused",
    writeOptions: writeOptionsForRun(updated),
    force: true,
  });
  return updated;
}

export async function resumeNationalRun(runId: string): Promise<OsmNationalRun> {
  const run = await getNationalRunOrThrow(runId);
  const now = new Date().toISOString();
  const updated: OsmNationalRun = {
    ...run,
    status: "running",
    currentActivity: {
      ...run.currentActivity,
      step: "resumed",
      message: "Run resumed",
      startedAt: now,
    },
    updatedAt: now,
  };
  await writeOsmNationalRun(updated, writeOptionsForRun(updated));
  await logOsmNationalEvent({
    runId,
    level: "info",
    type: "resumed",
    message: "Run resumed",
    writeOptions: writeOptionsForRun(updated),
    force: true,
  });
  return updated;
}

export async function cancelNationalRun(runId: string): Promise<OsmNationalRun> {
  const run = await getNationalRunOrThrow(runId);
  const now = new Date().toISOString();
  const updated: OsmNationalRun = {
    ...run,
    status: "cancelled",
    progress: { ...run.progress, finishedAt: now, updatedAt: now },
    currentActivity: {
      stateCode: null,
      chunkId: null,
      step: "cancelled",
      message: "Run cancelled",
      startedAt: now,
    },
    updatedAt: now,
  };
  await writeOsmNationalRun(updated, writeOptionsForRun(updated));
  await logOsmNationalEvent({
    runId,
    level: "warn",
    type: "cancelled",
    message: "Run cancelled",
    writeOptions: writeOptionsForRun(updated),
    force: true,
  });
  return updated;
}

export async function retryFailedChunks(runId: string): Promise<{ resetCount: number }> {
  const run = await getNationalRunOrThrow(runId);
  const stateRuns = await listOsmStateRuns(runId);
  let resetCount = 0;
  const writeOpts = writeOptionsForRun(run);

  for (const state of stateRuns) {
    const failed = await listOsmChunkRuns(runId, state.stateCode, { status: "failed", limit: 500 });
    for (const chunk of failed) {
      resetCount += 1;
      const { writeOsmChunkRun } = await import("../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js");
      await writeOsmChunkRun(
        {
          ...chunk,
          status: "pending",
          lastError: null,
          lockedBy: null,
          lockExpiresAt: null,
          updatedAt: new Date().toISOString(),
        },
        writeOpts
      );
    }
  }

  return { resetCount };
}

export async function refreshNationalRunProgress(runId: string): Promise<OsmNationalRun> {
  const run = await getNationalRunOrThrow(runId);
  const stateRuns = await listOsmStateRuns(runId);
  const progress = aggregateNationalProgress({ run, stateRuns });
  const counts = stateRuns.reduce((acc, s) => addCounts(acc, s.counts), emptyOsmNationalCounts());

  let status = run.status;
  if (progress.percentComplete >= 100 && run.status === "running") {
    status = "completed";
    progress.finishedAt = new Date().toISOString();
  }

  const updated: OsmNationalRun = {
    ...run,
    status,
    progress,
    counts,
    updatedAt: new Date().toISOString(),
  };
  await writeOsmNationalRun(updated, writeOptionsForRun(updated));
  return updated;
}

export async function rerunChunk(runId: string, stateCode: string, chunkId: string): Promise<void> {
  const run = await getNationalRunOrThrow(runId);
  const { getOsmChunkRun, writeOsmChunkRun } = await import(
    "../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js"
  );
  const chunk = await getOsmChunkRun(runId, stateCode, chunkId);
  if (!chunk) throw new Error(`chunk_not_found:${chunkId}`);
  await writeOsmChunkRun(
    {
      ...chunk,
      status: "pending",
      lastError: null,
      lockedBy: null,
      lockExpiresAt: null,
      updatedAt: new Date().toISOString(),
    },
    writeOptionsForRun(run)
  );
}
