#!/usr/bin/env npx tsx
import { runRealUserNativeReplay } from "../../src/perf/real-user-native-replay.js";

const artifact = await runRealUserNativeReplay();
console.log(
  JSON.stringify(
    {
      runId: artifact.runId,
      verdict: artifact.verdict,
      baseUrl: artifact.baseUrl,
      failures: artifact.failures,
      firstVisibleAssetLatencyMs: artifact.firstVisibleAssetLatencyMs,
      openedPostPrimaryAssetLatencyMs: artifact.openedPostPrimaryAssetLatencyMs,
      diagnosticsFound: artifact.diagnosticsFound,
      duplicatePrefetchPayloadWasteBytes: artifact.duplicatePrefetchPayloadWasteBytes,
    },
    null,
    2,
  ),
);
if (artifact.verdict !== "pass") process.exitCode = 1;
