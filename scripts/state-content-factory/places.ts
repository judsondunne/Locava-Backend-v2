import { loadEnv } from "../../src/config/env.js";
import { startStateContentFactoryRun } from "../../src/lib/state-content-factory/stateContentFactoryDevRunner.js";
import { getStateContentFactoryRun } from "../../src/lib/state-content-factory/stateContentFactoryRunStore.js";

const env = loadEnv();
const run = startStateContentFactoryRun({
  env,
  config: {
    runKind: "place_only",
    stateName: "Vermont",
    stateCode: "VT",
    runMode: "dry_run",
    placeSource: "wikidata",
    placeDiscoveryMode: "fast_targeted",
    candidateLimit: 50,
    priorityQueues: ["P0", "P1", "P2", "P3"],
    maxPlacesToProcess: 10,
    includeMediaSignals: true,
    qualityThreshold: "normal",
    qualityPreviewMode: "preview_all",
    maxPostPreviewsPerPlace: 1,
    maxAssetsPerPostPreview: 8,
    groupTimeWindowMinutes: 180,
    totalTimeoutMs: 120_000,
    perPlaceTimeoutMs: 60_000,
    allowStagingWrites: false,
    allowPublicPublish: false,
  },
});

while (true) {
  const current = getStateContentFactoryRun(run.runId);
  if (!current || current.status === "completed" || current.status === "failed") {
    console.log(JSON.stringify({ runId: run.runId, result: current?.result }, null, 2));
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
