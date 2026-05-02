#!/usr/bin/env node
/**
 * Scans a captured log file for production hygiene violations.
 * Usage: npx tsx scripts/audit-runtime-logs.mts /path/to/log.txt
 */
import fs from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: audit-runtime-logs.mts <logfile>");
  process.exit(2);
}
const text = fs.readFileSync(path, "utf8");
const failures: string[] = [];

if (text.includes("FAILED_PRECONDITION")) failures.push("FOUND: FAILED_PRECONDITION");
if (/db_reads_exceeded.*P1|P2.*db_reads_exceeded/i.test(text)) failures.push("FOUND: db_reads_exceeded on P1/P2 (heuristic)");
if (/feed\.for_you_simple\.get[\s\S]*writes["']?:\s*[1-9]/i.test(text)) failures.push("FOUND: blocking writes on for_you_simple (heuristic)");
if (/\b\+1\d{10}\b/.test(text) && text.includes("NODE_ENV") && text.includes("production")) failures.push("FOUND: possible raw phone in production log (heuristic)");
if (/\bAUTH_SESSION_VIEWER_SUMMARY_TIMEOUT\b/.test(text) && !/debugSlowDeferredMs/i.test(text)) failures.push("FOUND: AUTH_SESSION_VIEWER_SUMMARY_TIMEOUT on possible happy path");
if (/playbackUrlPresent=false/.test(text) && /fallbackVideoUrlPresent=true/.test(text)) {
  failures.push("FOUND: playbackUrlPresent=false with fallbackVideoUrlPresent=true");
}
if (/\/api\/v1\/product\/users\/multiple[^\n]*404|statusCode[^\n]*404[^\n]*users\/multiple/i.test(text)) {
  failures.push("FOUND: 404 on users/multiple compat");
}

if (failures.length) {
  console.error("audit-runtime-logs: FAILED");
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("audit-runtime-logs: OK");
process.exit(0);
