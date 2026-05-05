#!/usr/bin/env npx tsx
import { readFile } from "node:fs/promises";

const target = process.argv[2] ?? process.env.LOG_FILE;
if (!target) {
  console.error("usage: npm run perf:replay:analyze-logs -- <path-to-log>");
  process.exit(1);
}

const raw = await readFile(target, "utf8");
const lines = raw.split(/\r?\n/).filter(Boolean);
const matches = lines.filter((line) =>
  /(request_start|request_complete|feed_for_you_simple_summary|post\.detail\.media_resolution_summary|posts\.batch\.media_resolution_summary|pool refresh|bigquery|latency_p95_exceeded|db_reads_exceeded|payload_bytes_exceeded)/i.test(
    line,
  ),
);

console.log(
  JSON.stringify(
    {
      file: target,
      lineCount: lines.length,
      extractedCount: matches.length,
      extracted: matches,
    },
    null,
    2,
  ),
);
