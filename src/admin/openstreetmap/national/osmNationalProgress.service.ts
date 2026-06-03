import type {
  OsmChunkRun,
  OsmNationalCounts,
  OsmNationalRun,
  OsmStateRun,
} from "../../../contracts/entities/osm-national-entities.contract.js";
import { emptyOsmNationalCounts } from "../../../contracts/entities/osm-national-entities.contract.js";

export function computePercentComplete(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

export function computeEtaSeconds(input: {
  startedAt: string | null;
  completed: number;
  total: number;
}): number | null {
  if (!input.startedAt || input.completed <= 0 || input.total <= input.completed) {
    return null;
  }
  const elapsedMs = Date.now() - new Date(input.startedAt).getTime();
  if (elapsedMs <= 0) return null;
  const avgMsPerUnit = elapsedMs / input.completed;
  const remaining = input.total - input.completed;
  return Math.round((avgMsPerUnit * remaining) / 1000);
}

export function addCounts(base: OsmNationalCounts, delta: Partial<OsmNationalCounts>): OsmNationalCounts {
  const result = { ...base };
  for (const key of Object.keys(emptyOsmNationalCounts()) as Array<keyof OsmNationalCounts>) {
    if (delta[key] != null) {
      result[key] += delta[key]!;
    }
  }
  return result;
}

export function aggregateNationalProgress(input: {
  run: OsmNationalRun;
  stateRuns: OsmStateRun[];
}): OsmNationalRun["progress"] {
  const { stateRuns } = input;
  const totalChunks = stateRuns.reduce((sum, s) => sum + s.progress.totalChunks, 0);
  const completedChunks = stateRuns.reduce((sum, s) => sum + s.progress.completedChunks, 0);
  const failedChunks = stateRuns.reduce((sum, s) => sum + s.progress.failedChunks, 0);
  const skippedChunks = stateRuns.reduce((sum, s) => sum + s.progress.skippedChunks, 0);
  const completedStates = stateRuns.filter((s) => s.status === "completed").length;
  const failedStates = stateRuns.filter((s) => s.status === "failed").length;

  return {
    ...input.run.progress,
    totalStates: stateRuns.length,
    completedStates,
    failedStates,
    totalChunks,
    completedChunks,
    failedChunks,
    skippedChunks,
    estimatedTotalChunks: totalChunks,
    percentComplete: computePercentComplete(completedChunks, totalChunks),
    etaSeconds: computeEtaSeconds({
      startedAt: input.run.progress.startedAt,
      completed: completedChunks,
      total: totalChunks,
    }),
    updatedAt: new Date().toISOString(),
  };
}

export function aggregateStateProgress(chunks: OsmChunkRun[]): OsmStateRun["progress"] {
  const totalChunks = chunks.length;
  const completedChunks = chunks.filter((c) => c.status === "completed").length;
  const failedChunks = chunks.filter((c) => c.status === "failed").length;
  const skippedChunks = chunks.filter((c) => c.status === "skipped").length;
  const startedAt = chunks.find((c) => c.checkpoint.fetchStartedAt)?.checkpoint.fetchStartedAt ?? null;

  return {
    totalChunks,
    completedChunks,
    failedChunks,
    skippedChunks,
    percentComplete: computePercentComplete(completedChunks, totalChunks),
    etaSeconds: computeEtaSeconds({ startedAt, completed: completedChunks, total: totalChunks }),
  };
}

export function computeWriteRates(input: {
  run: OsmNationalRun;
}): {
  writesPerSecond: number;
  chunksPerMinute: number;
  errorRate: number;
} {
  const startedAt = input.run.progress.startedAt;
  if (!startedAt) {
    return { writesPerSecond: 0, chunksPerMinute: 0, errorRate: 0 };
  }
  const elapsedSec = Math.max(1, (Date.now() - new Date(startedAt).getTime()) / 1000);
  const totalWrites = input.run.counts.writtenSpots + input.run.counts.writtenRoutes;
  const completedChunks = input.run.progress.completedChunks;
  const totalAttempts = completedChunks + input.run.progress.failedChunks;
  const errorRate = totalAttempts > 0 ? input.run.progress.failedChunks / totalAttempts : 0;

  return {
    writesPerSecond: totalWrites / elapsedSec,
    chunksPerMinute: (completedChunks / elapsedSec) * 60,
    errorRate,
  };
}

export function deriveStateStatus(chunks: OsmChunkRun[]): OsmStateRun["status"] {
  if (chunks.length === 0) return "pending";
  if (chunks.every((c) => c.status === "completed" || c.status === "skipped")) return "completed";
  if (chunks.some((c) => c.status === "running" || c.status === "queued")) return "running";
  if (chunks.every((c) => c.status === "failed")) return "failed";
  if (chunks.some((c) => c.status === "failed") && chunks.every((c) => c.status !== "pending" && c.status !== "running")) {
    return "failed";
  }
  return "running";
}
