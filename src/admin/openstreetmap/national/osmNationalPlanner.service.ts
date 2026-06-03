import type {
  OsmChunkRun,
  OsmNationalRun,
  OsmNationalRunConfig,
  OsmStateRun,
} from "../../../contracts/entities/osm-national-entities.contract.js";
import {
  emptyOsmChunkCheckpoint,
  emptyOsmNationalCounts,
  OSM_NATIONAL_PIPELINE_VERSION,
} from "../../../contracts/entities/osm-national-entities.contract.js";
import {
  batchWriteOsmChunkRuns,
  writeOsmNationalRun,
  writeOsmStateRun,
  type OsmNationalWriteOptions,
} from "../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";
import { buildOsmNationalRunId } from "./osmNationalDeterministicIds.js";
import { getStateBounds, resolveSelectedStates, type OsmNationalRegionPreset } from "./usStateBounds.js";
import { planStateChunks } from "./usChunkPlanner.js";
import { logOsmNationalEvent } from "./osmNationalEventLogger.js";

export type PlanNationalRunInput = {
  states?: string[];
  regionPreset?: OsmNationalRegionPreset;
  includeDc?: boolean;
  chunkSizeKm?: number;
  maxConcurrentStates?: number;
  maxConcurrentChunks?: number;
  maxWritesPerSecond?: number;
  maxChunksPerMinute?: number;
  includeOsmSpots?: boolean;
  includeOsmRoutes?: boolean;
  includeOffroad?: boolean;
  includePublicOnly?: boolean;
  includeReviewItems?: boolean;
  skipCompletedChunks?: boolean;
  forceReprocess?: boolean;
  dryRunOnly?: boolean;
  tileBuildMode?: OsmNationalRunConfig["tileBuildMode"];
  writeMode?: boolean;
  writeTarget?: OsmNationalRun["writeTarget"];
  confirmProductionWrite?: string;
  maxTotalWrites?: number;
  maxWritesPerMinute?: number;
  maxStateWrites?: number;
  maxChunkWrites?: number;
  stopOnBudgetExceeded?: boolean;
  pauseOnErrorRateAbovePercent?: number;
  confirmLargePlan?: boolean;
};

export type NationalPlanEstimate = {
  states: string[];
  stateCount: number;
  estimatedTotalChunks: number;
  chunkSizeKm: number;
  requiresLargePlanConfirmation: boolean;
};

const LARGE_PLAN_CHUNK_THRESHOLD = 500;

export class OsmNationalLargePlanConfirmationError extends Error {
  readonly code = "large_plan_confirmation_required";
  readonly estimatedTotalChunks: number;
  readonly stateCount: number;

  constructor(estimatedTotalChunks: number, stateCount: number) {
    super(
      `large_plan_confirmation_required:${estimatedTotalChunks}_chunks_across_${stateCount}_states`
    );
    this.name = "OsmNationalLargePlanConfirmationError";
    this.estimatedTotalChunks = estimatedTotalChunks;
    this.stateCount = stateCount;
  }
}

export function estimateNationalPlan(input: PlanNationalRunInput = {}): NationalPlanEstimate {
  const states = resolveSelectedStates({
    states: input.states,
    regionPreset: input.regionPreset,
    includeDc: input.includeDc,
  });
  const chunkSizeKm = input.chunkSizeKm ?? 20;
  let estimatedTotalChunks = 0;
  for (const stateCode of states) {
    estimatedTotalChunks += planStateChunks({ stateCode, chunkSizeKm }).length;
  }
  return {
    states,
    stateCount: states.length,
    estimatedTotalChunks,
    chunkSizeKm,
    requiresLargePlanConfirmation: estimatedTotalChunks > LARGE_PLAN_CHUNK_THRESHOLD,
  };
}

function defaultConfig(input: PlanNationalRunInput, states: string[]): OsmNationalRunConfig {
  return {
    states,
    chunkSizeKm: input.chunkSizeKm ?? 20,
    maxConcurrentStates: input.maxConcurrentStates ?? 2,
    maxConcurrentChunks: input.maxConcurrentChunks ?? 2,
    maxWritesPerSecond: input.maxWritesPerSecond ?? 10,
    maxChunksPerMinute: input.maxChunksPerMinute ?? 6,
    includeOsmSpots: input.includeOsmSpots !== false,
    includeOsmRoutes: input.includeOsmRoutes !== false,
    includeOffroad: input.includeOffroad !== false,
    includePublicOnly: input.includePublicOnly !== false,
    includeReviewItems: input.includeReviewItems ?? false,
    skipCompletedChunks: input.skipCompletedChunks !== false,
    forceReprocess: input.forceReprocess ?? false,
    dryRunOnly: input.dryRunOnly ?? !input.writeMode,
    tileBuildMode: input.tileBuildMode ?? "per_chunk",
    maxTotalWrites: input.maxTotalWrites ?? 500_000,
    maxWritesPerMinute: input.maxWritesPerMinute ?? 3000,
    maxStateWrites: input.maxStateWrites,
    maxChunkWrites: input.maxChunkWrites ?? 5000,
    stopOnBudgetExceeded: input.stopOnBudgetExceeded !== false,
    pauseOnErrorRateAbovePercent: input.pauseOnErrorRateAbovePercent ?? 25,
  };
}

function progressWriteOptions(run: OsmNationalRun): OsmNationalWriteOptions {
  return {
    writeTarget: run.writeTarget,
    operation: "planNationalRun",
    confirmProductionWrite: run.confirmProductionWrite,
    progressOnly: run.writeTarget === "none",
  };
}

export async function planNationalRun(input: PlanNationalRunInput = {}): Promise<OsmNationalRun> {
  const estimate = estimateNationalPlan(input);
  if (estimate.requiresLargePlanConfirmation && !input.confirmLargePlan) {
    throw new OsmNationalLargePlanConfirmationError(estimate.estimatedTotalChunks, estimate.stateCount);
  }

  const states = estimate.states;

  const now = new Date().toISOString();
  const runId = buildOsmNationalRunId();
  const writeMode = input.writeMode ?? false;
  const writeTarget = input.writeTarget ?? (writeMode ? "emulator" : "none");

  const config = defaultConfig(input, states);
  let totalChunks = 0;

  const run: OsmNationalRun = {
    runId,
    runType: "national_osm_unexplored_import",
    status: "created",
    writeMode,
    writeTarget,
    confirmProductionWrite: input.confirmProductionWrite,
    config,
    progress: {
      totalStates: states.length,
      completedStates: 0,
      failedStates: 0,
      totalChunks: 0,
      completedChunks: 0,
      runningChunks: 0,
      failedChunks: 0,
      skippedChunks: 0,
      estimatedTotalChunks: 0,
      percentComplete: 0,
      etaSeconds: null,
      startedAt: null,
      updatedAt: now,
      finishedAt: null,
    },
    counts: emptyOsmNationalCounts(),
    currentActivity: {
      stateCode: null,
      chunkId: null,
      step: "planned",
      message: "Run planned — click Start to begin",
      startedAt: null,
    },
    safety: {
      productionWritesBlockedByDefault: true,
      productionWriteConfirmed:
        input.confirmProductionWrite === "I_UNDERSTAND_THIS_WILL_WRITE_NATIONAL_UNEXPLORED_SPOTS",
      maxWriteBudget: config.maxTotalWrites ?? 500_000,
      stoppedBecauseBudgetExceeded: false,
    },
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };

  const chunkDocs: OsmChunkRun[] = [];
  const stateDocs: OsmStateRun[] = [];

  for (const stateCode of states) {
    const state = getStateBounds(stateCode);
    if (!state) continue;

    const planned = planStateChunks({ stateCode, chunkSizeKm: config.chunkSizeKm });
    totalChunks += planned.length;

    const stateRun: OsmStateRun = {
      runId,
      stateCode: state.stateCode,
      stateName: state.stateName,
      status: "pending",
      bbox: state.bbox,
      progress: {
        totalChunks: planned.length,
        completedChunks: 0,
        failedChunks: 0,
        skippedChunks: 0,
        percentComplete: 0,
        etaSeconds: null,
      },
      counts: emptyOsmNationalCounts(),
      enabledSources: {
        osm: config.includeOsmSpots || config.includeOsmRoutes,
        offroadFederal: config.includeOffroad,
        offroadState: config.includeOffroad,
      },
      currentChunkId: null,
      lastEventAt: null,
      createdAt: now,
      updatedAt: now,
    };
    stateDocs.push(stateRun);

    for (const chunk of planned) {
      chunkDocs.push({
        runId,
        stateCode: state.stateCode,
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
        bbox: chunk.bbox,
        status: "pending",
        attemptCount: 0,
        lockedBy: null,
        lockExpiresAt: null,
        checkpoint: emptyOsmChunkCheckpoint(),
        counts: emptyOsmNationalCounts(),
        samples: {
          acceptedSpotNames: [],
          acceptedRouteNames: [],
          offroadNames: [],
          rejectedReasons: [],
        },
        artifactRefs: {},
        lastError: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      });
    }
  }

  run.progress.totalChunks = totalChunks;
  run.progress.estimatedTotalChunks = totalChunks;

  const writeOpts = progressWriteOptions(run);
  await writeOsmNationalRun(run, writeOpts);

  await Promise.all(stateDocs.map((stateRun) => writeOsmStateRun(stateRun, writeOpts)));

  for (let i = 0; i < chunkDocs.length; i += 400) {
    await batchWriteOsmChunkRuns(chunkDocs.slice(i, i + 400), writeOpts);
  }

  await logOsmNationalEvent({
    runId,
    level: "info",
    type: "run_started",
    message: `Planned ${states.length} states, ${totalChunks} chunks (${OSM_NATIONAL_PIPELINE_VERSION})`,
    writeOptions: writeOpts,
    force: true,
  });

  return run;
}
