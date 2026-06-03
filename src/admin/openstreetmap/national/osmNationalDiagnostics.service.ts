import type { OsmNationalRun } from "../../../contracts/entities/osm-national-entities.contract.js";
import { OSM_NATIONAL_PIPELINE_VERSION } from "../../../contracts/entities/osm-national-entities.contract.js";
import {
  listOsmChunkRuns,
  listOsmNationalEvents,
  listOsmStateRuns,
} from "../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";
import { computeWriteRates } from "./osmNationalProgress.service.js";
import { getOsmNationalCloudTasksDiagnostics } from "./osmNationalCloudTasks.service.js";

export async function buildNationalRunDiagnostics(run: OsmNationalRun): Promise<Record<string, unknown>> {
  const stateRuns = await listOsmStateRuns(run.runId);
  const events = await listOsmNationalEvents(run.runId, 100);
  const rates = computeWriteRates({ run });

  const failedChunks: Array<{ stateCode: string; chunkId: string; lastError: string | null }> = [];
  const topRejectionReasons: Record<string, number> = {};
  const topAcceptedActivities: Record<string, number> = {};
  const topAcceptedCategories: Record<string, number> = {};
  const sourceBreakdown: Record<string, number> = {};

  for (const state of stateRuns) {
    const failed = await listOsmChunkRuns(run.runId, state.stateCode, { status: "failed", limit: 50 });
    for (const chunk of failed) {
      failedChunks.push({ stateCode: chunk.stateCode, chunkId: chunk.chunkId, lastError: chunk.lastError });
      for (const reason of chunk.samples.rejectedReasons) {
        const key = reason.split(" (")[0] ?? reason;
        topRejectionReasons[key] = (topRejectionReasons[key] ?? 0) + 1;
      }
    }
  }

  return {
    algorithmVersion: OSM_NATIONAL_PIPELINE_VERSION,
    runId: run.runId,
    status: run.status,
    writeMode: run.writeMode,
    writeTarget: run.writeTarget,
    selectedStates: run.config.states,
    progress: run.progress,
    counts: run.counts,
    rates: {
      ...rates,
      averageChunkSeconds: null,
    },
    eta: run.progress.etaSeconds,
    currentActivity: run.currentActivity,
    stateSummaries: stateRuns.map((s) => ({
      stateCode: s.stateCode,
      stateName: s.stateName,
      status: s.status,
      progress: s.progress,
      counts: s.counts,
    })),
    failedChunks,
    recentErrors: events.filter((e) => e.level === "error").slice(0, 20).map((e) => e.message),
    topRejectionReasons,
    topAcceptedActivities,
    topAcceptedCategories,
    sourceBreakdown,
    writeBudget: {
      maxTotalWrites: run.config.maxTotalWrites,
      maxWritesPerMinute: run.config.maxWritesPerMinute,
      maxWritesPerSecond: run.config.maxWritesPerSecond,
      written: run.counts.writtenSpots + run.counts.writtenRoutes,
    },
    safety: run.safety,
    cloudTasks: getOsmNationalCloudTasksDiagnostics(),
    sampleDocs: { spots: [], routes: [] },
    recommendations: buildRecommendations(run),
  };
}

function buildRecommendations(run: OsmNationalRun): string[] {
  const recs: string[] = [];
  if (!run.writeMode) recs.push("Dry run active — enable write mode for emulator/production writes.");
  if (run.writeTarget === "production" && !run.safety.productionWriteConfirmed) {
    recs.push("Production write phrase not confirmed.");
  }
  if (run.progress.failedChunks > 0) recs.push("Retry failed chunks from the dashboard.");
  if (run.config.tileBuildMode === "per_chunk" && run.config.states.length > 3) {
    recs.push("Consider per_state or after_run tile mode for large runs.");
  }
  return recs;
}
