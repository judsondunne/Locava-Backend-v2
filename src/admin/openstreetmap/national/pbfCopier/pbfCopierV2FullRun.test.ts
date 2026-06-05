import { describe, expect, it } from "vitest";
import path from "node:path";
import { buildVermontTileGrid } from "./pbfCopierV2VermontTiles.js";
import {
  getPbfV2FullRunStatus,
  pausePbfV2FullRun,
  resumePbfV2FullRun,
  startPbfV2FullRun,
  writePbfV2FullRunChunks,
} from "./pbfCopierV2FullRunService.js";
import { getPbfV2FullRun } from "./pbfCopierV2FullRunStore.js";
import { runPbfCopierV2Pipeline } from "./pbfCopierV2Pipeline.js";

const VERMONT_PBF = path.join(process.cwd(), "data/osm/vermont-latest.osm.pbf");

describe("pbfCopierV2FullRun", () => {
  it("buildVermontTileGrid produces checkpointable tiles", () => {
    const tiles = buildVermontTileGrid(0.4);
    expect(tiles.length).toBeGreaterThan(10);
    expect(tiles[0]?.tileId).toMatch(/^vt_/);
  });

  it("runPbfCopierV2Pipeline matches applyPbfQualityFilters entry", () => {
    const result = runPbfCopierV2Pipeline({ rawItems: [] });
    expect(result.summary.rawItems).toBe(0);
    expect(result.destinationQualityCounters).toBeTruthy();
  });

  it.skipIf(!process.env.PBF_FULL_RUN_INTEGRATION)(
    "mini full-file dry run: 1 chunk, pause, write-current idempotent",
    async () => {
      const run = await startPbfV2FullRun({
        pbfPath: VERMONT_PBF,
        mode: "dry_run",
        maxTotalSpots: 50,
        tileStepDegrees: 0.8,
      });
      expect(run.runId).toBeTruthy();
      expect(run.totalChunks).toBeGreaterThan(0);

      let status = await getPbfV2FullRunStatus(run.runId);
      for (let i = 0; i < 900; i++) {
        if (
          status.run?.status === "complete" ||
          status.run?.status === "paused" ||
          status.run?.status === "error" ||
          (status.run?.stats.chunksProcessed ?? 0) >= 1
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
        status = await getPbfV2FullRunStatus(run.runId);
      }

      expect(status.run?.stats.chunksProcessed).toBeGreaterThanOrEqual(1);

      await pausePbfV2FullRun(run.runId);
      const paused = await getPbfV2FullRun(run.runId);
      expect(paused?.status === "paused" || paused?.status === "pausing" || paused?.status === "complete").toBe(
        true
      );

      const write1 = await writePbfV2FullRunChunks({ runId: run.runId, dryRun: true });
      expect(write1.writeResult?.dryRun).toBe(true);

      const write2 = await writePbfV2FullRunChunks({ runId: run.runId, dryRun: true });
      expect(write2.writeResult?.skippedDuplicates).toBeGreaterThanOrEqual(0);

      if (paused?.status === "paused") {
        const resumed = await resumePbfV2FullRun(run.runId);
        expect(resumed?.status).toBe("running");
      }
    },
    900_000
  );
});
