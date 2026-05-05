#!/usr/bin/env npx tsx
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runRealUserNativeReplay } from "../../src/perf/real-user-native-replay.js";

const MAX_ITERATIONS = Math.max(1, Number(process.env.MAX_ITERATIONS ?? "25"));
const MIN_PASS_STREAK = Math.max(1, Number(process.env.MIN_PASS_STREAK ?? "3"));
const WARMUP_ITERATIONS = Math.max(0, Number(process.env.WARMUP_ITERATIONS ?? "1"));
const outDir = path.join(process.cwd(), "docs", "performance", "artifacts");

let passStreak = 0;
const summaries: Array<Record<string, unknown>> = [];

for (let warmup = 1; warmup <= WARMUP_ITERATIONS; warmup += 1) {
  const artifact = await runRealUserNativeReplay({
    outputPath: path.join(outDir, `real-user-replay-warmup-${String(warmup).padStart(2, "0")}.json`),
  });
  console.log(
    JSON.stringify(
      {
        warmup,
        verdict: artifact.verdict,
        failures: artifact.failures,
      },
      null,
      2,
    ),
  );
}

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
  const artifact = await runRealUserNativeReplay({
    outputPath: path.join(outDir, `real-user-replay-iteration-${String(iteration).padStart(2, "0")}.json`),
  });
  const worst = artifact.events
    .filter((event) => event.hardFailures.length > 0 || event.warnings.length > 0)
    .slice(0, 6)
    .map((event) => ({
      id: event.id,
      route: event.route,
      latencyMs: event.latencyMs,
      payloadBytes: event.payloadBytes,
      reads: event.db.reads,
      queries: event.db.queries,
      hardFailures: event.hardFailures,
      warnings: event.warnings,
    }));
  summaries.push({
    iteration,
    verdict: artifact.verdict,
    failures: artifact.failures,
    worst,
  });
  console.log(
    JSON.stringify(
      {
        iteration,
        verdict: artifact.verdict,
        passStreak,
        failures: artifact.failures,
        worst,
      },
      null,
      2,
    ),
  );
  if (artifact.verdict === "pass") {
    passStreak += 1;
    if (passStreak >= MIN_PASS_STREAK) break;
  } else {
    passStreak = 0;
  }
}

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "real-user-replay-loop-summary.json"), JSON.stringify(summaries, null, 2));
if (passStreak < MIN_PASS_STREAK) process.exitCode = 1;
