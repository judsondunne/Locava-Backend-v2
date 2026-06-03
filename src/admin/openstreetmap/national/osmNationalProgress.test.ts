import { describe, expect, it } from "vitest";
import { aggregateNationalProgress, computeEtaSeconds, computePercentComplete } from "./osmNationalProgress.service.js";
import { emptyOsmNationalCounts } from "../../../contracts/entities/osm-national-entities.contract.js";
import type { OsmNationalRun, OsmStateRun } from "../../../contracts/entities/osm-national-entities.contract.js";

describe("osmNationalProgress", () => {
  it("computes percent complete", () => {
    expect(computePercentComplete(5, 10)).toBe(50);
    expect(computePercentComplete(0, 0)).toBe(0);
  });

  it("ETA returns null when unknown totals", () => {
    expect(computeEtaSeconds({ startedAt: null, completed: 0, total: 10 })).toBeNull();
  });

  it("aggregates national progress from state runs", () => {
    const run = {
      progress: {
        totalStates: 0,
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
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        updatedAt: new Date().toISOString(),
        finishedAt: null,
      },
    } as OsmNationalRun;

    const stateRuns = [
      {
        stateCode: "VT",
        progress: { totalChunks: 4, completedChunks: 2, failedChunks: 0, skippedChunks: 0, percentComplete: 50, etaSeconds: 60 },
        status: "running",
        counts: emptyOsmNationalCounts(),
      },
    ] as OsmStateRun[];

    const progress = aggregateNationalProgress({ run, stateRuns });
    expect(progress.totalChunks).toBe(4);
    expect(progress.completedChunks).toBe(2);
    expect(progress.percentComplete).toBe(50);
  });
});
