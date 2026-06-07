import { describe, expect, it } from "vitest";
import { pickDefaultAssetPreviewRunId } from "./pickPbfAssetPreviewRun.js";
import type { PbfV2FullRunRecord } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2FullRunTypes.js";

function run(partial: Partial<PbfV2FullRunRecord> & { runId: string; mode: PbfV2FullRunRecord["mode"] }): PbfV2FullRunRecord {
  return {
    region: "vermont",
    sourceFilePath: "/tmp/vt.osm.pbf",
    sourceFileHash: null,
    sourceFileBytes: null,
    status: "complete",
    phase: "complete",
    startedAt: null,
    updatedAt: "2026-06-06T12:00:00.000Z",
    completedAt: null,
    lastCheckpoint: null,
    processedBytes: null,
    totalBytes: null,
    percentComplete: 100,
    percentEstimated: false,
    processedObjects: 0,
    totalObjectsEstimate: null,
    elapsedMs: 0,
    avgObjectsPerSec: 0,
    avgBytesPerSec: 0,
    etaMs: null,
    currentChunkIndex: 0,
    totalChunks: 1,
    completedChunkIds: [],
    writtenChunkIds: [],
    stats: {} as PbfV2FullRunRecord["stats"],
    writeStats: {} as PbfV2FullRunRecord["writeStats"],
    errorsSample: [],
    errorCount: 0,
    qualityFilterSettings: {} as PbfV2FullRunRecord["qualityFilterSettings"],
    maxChunks: null,
    maxTotalSpots: null,
    tileStepDegrees: 0.4,
    currentTile: null,
    validationWarnings: [],
    ...partial,
  };
}

describe("pickDefaultAssetPreviewRunId", () => {
  it("prefers active write run over newer dry run", () => {
    const runs = [
      run({ runId: "dry_new", mode: "dry_run", updatedAt: "2026-06-06T20:00:00.000Z" }),
      run({ runId: "write_old", mode: "write_test", updatedAt: "2026-06-06T10:00:00.000Z" }),
    ];
    expect(pickDefaultAssetPreviewRunId(runs, null, "write_old")).toBe("write_old");
  });

  it("prefers write_test over dry_run when no active run", () => {
    const runs = [
      run({ runId: "dry_new", mode: "dry_run", updatedAt: "2026-06-06T20:00:00.000Z" }),
      run({ runId: "write_old", mode: "write_test", updatedAt: "2026-06-06T10:00:00.000Z" }),
    ];
    expect(pickDefaultAssetPreviewRunId(runs)).toBe("write_old");
  });
});
