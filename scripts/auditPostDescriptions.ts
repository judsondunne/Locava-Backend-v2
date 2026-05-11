#!/usr/bin/env node
/**
 * Dry-run-first post description cleanup scanner / applier.
 * See package.json: posts:descriptions:audit | posts:descriptions:apply
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import {
  applyDescriptionCleanupRows,
  scanPostsDescriptionCleanupBatch,
  summarizeDescriptionCleanupRun,
  writeDescriptionCleanupCsv,
  writeDescriptionCleanupJson,
  type DescriptionCleanupAuditRow,
} from "../src/lib/posts/description-cleanup/postDescriptionCleanup.service.js";

const REQUIRED_CONFIRM = "REMOVE_GENERATED_DESCRIPTIONS_ONLY";

type OnlyAction = "keep" | "review" | "remove";

type CliArgs = {
  limit: number | null;
  scanAll: boolean;
  startAfter: string | null;
  dryRun: boolean;
  apply: boolean;
  outJson: string | null;
  outCsv: string | null;
  onlyAction: OnlyAction | null;
  confidenceThreshold: number;
  confirm: string | null;
  batchDocSize: number;
};

function readFlag(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= argv.length) return undefined;
  return String(argv[idx + 1] ?? "").trim();
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function parseArgs(argv: string[]): CliArgs {
  const limitRaw = readFlag(argv, "--limit");
  const limitParsed = limitRaw ? Number.parseInt(limitRaw, 10) : NaN;
  const thresholdRaw = readFlag(argv, "--confidenceThreshold");
  const thresholdParsed = thresholdRaw ? Number.parseFloat(thresholdRaw) : NaN;
  const batchRaw = readFlag(argv, "--batchDocSize");
  const batchParsed = batchRaw ? Number.parseInt(batchRaw, 10) : NaN;
  const apply = hasFlag(argv, "--apply");
  const explicitDry = hasFlag(argv, "--dryRun");
  const dryRun = apply ? false : explicitDry ? true : true;
  const onlyRaw = readFlag(argv, "--onlyAction");
  const onlyAction =
    onlyRaw === "keep" || onlyRaw === "review" || onlyRaw === "remove" ? (onlyRaw as OnlyAction) : null;
  return {
    limit: Number.isFinite(limitParsed) && limitParsed > 0 ? limitParsed : null,
    scanAll: hasFlag(argv, "--all"),
    startAfter: readFlag(argv, "--startAfter") ?? null,
    dryRun,
    apply,
    outJson: readFlag(argv, "--out") ?? null,
    outCsv: readFlag(argv, "--csv") ?? null,
    onlyAction,
    confidenceThreshold: Number.isFinite(thresholdParsed) ? Math.min(0.99, Math.max(0, thresholdParsed)) : 0.85,
    confirm: readFlag(argv, "--confirm") ?? null,
    batchDocSize: Number.isFinite(batchParsed) && batchParsed > 0 ? Math.min(100, batchParsed) : 25,
  };
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function printPreviewTable(rows: DescriptionCleanupAuditRow[]): void {
  const cols = rows.map((r) => ({
    postId: truncate(r.postId, 18),
    title: truncate(r.title, 28),
    currentDescription: truncate(r.chosenDescription, 52),
    proposedAction: r.action,
    confidence: r.confidence,
    reason: truncate(r.reasons[0] ?? "", 44),
    fieldsToChange: r.fieldsToUpdate.join(","),
  }));
  console.table(cols);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.apply && args.confirm !== REQUIRED_CONFIRM) {
    console.error(
      `Refusing --apply: pass --confirm ${REQUIRED_CONFIRM} after reviewing a dry-run audit file.`,
    );
    process.exit(1);
  }

  const db = getFirestoreSourceClient();
  if (!db) {
    console.error("Firestore unavailable. Set FIRESTORE_SOURCE_ENABLED and credentials.");
    process.exit(1);
  }

  const auditRunId = `dc-${randomUUID()}`;
  const allRows: DescriptionCleanupAuditRow[] = [];
  let cursor: string | null = args.startAfter;
  let rawDocsScanned = 0;
  let scanned = 0;
  const maxTotal = args.scanAll ? (args.limit ?? Number.POSITIVE_INFINITY) : (args.limit ?? 100);
  const pageSizeCap = 200;

  while (scanned < maxTotal) {
    const page = Math.min(pageSizeCap, maxTotal === Number.POSITIVE_INFINITY ? pageSizeCap : maxTotal - scanned);
    if (page <= 0) break;
    const batch = await scanPostsDescriptionCleanupBatch(db, {
      limit: page,
      startAfterPostId: cursor,
      confidenceThreshold: args.confidenceThreshold,
      auditRunId,
    });
    const { rows } = batch;
    allRows.push(...rows);
    rawDocsScanned += batch.rows.length;
    scanned += batch.rows.length;
    cursor = batch.nextStartAfter;
    console.info({
      event: "description_cleanup_scan_page",
      pageRows: batch.rows.length,
      scanned,
      reachedEnd: batch.reachedEnd,
      nextCursor: cursor,
    });
    if (!args.scanAll) break;
    if (batch.reachedEnd || !cursor) break;
  }

  const tableRows = args.onlyAction ? allRows.filter((r) => r.action === args.onlyAction) : allRows;

  const payload = {
    auditRunId,
    generatedAt: new Date().toISOString(),
    mode: args.apply ? "apply" : "dry-run",
    confidenceThreshold: args.confidenceThreshold,
    rawDocsScanned,
    onlyAction: args.onlyAction,
    rows: allRows,
  };

  if (args.outJson) {
    writeDescriptionCleanupJson(args.outJson, payload);
  }
  if (args.outCsv) {
    writeDescriptionCleanupCsv(args.outCsv, allRows);
  }

  console.info(`\nPreview (${tableRows.length} rows shown${args.onlyAction ? `, onlyAction=${args.onlyAction}` : ""}; ${rawDocsScanned} posts scanned):\n`);
  printPreviewTable(tableRows.slice(0, 40));
  if (tableRows.length > 40) {
    console.info(`…and ${tableRows.length - 40} more rows (see JSON/CSV).\n`);
  }

  let appliedCount = 0;
  const applyErrors: string[] = [];

  if (args.apply) {
    if (!args.outJson || !args.outCsv) {
      console.error("--apply requires --out and --csv audit paths (written before any Firestore write).");
      process.exit(1);
    }
    const applyResult = await applyDescriptionCleanupRows({
      db,
      rows: allRows,
      confidenceThreshold: args.confidenceThreshold,
      auditRunId,
      batchDocSize: args.batchDocSize,
      dryRun: false,
    });
    appliedCount = applyResult.appliedCount;
    applyErrors.push(...applyResult.errors);
  }

  const noEligible = allRows.filter((r) => r.fieldsToUpdate.length === 0).length;
  const summary = summarizeDescriptionCleanupRun({
    auditRunId,
    rows: allRows,
    appliedCount,
    skippedCount: args.apply ? Math.max(0, allRows.length - appliedCount) : noEligible,
  });

  console.info("\n=== Description cleanup summary ===");
  console.info(JSON.stringify({ ...summary, rawDocsScanned, applyErrors }, null, 2));
  console.info(
    "\nSafety: only description/caption string fields (plus audit.descriptionCleanup backup) were eligible for writes in apply mode.",
  );
  if (applyErrors.length > 0) {
    console.error("\nApply errors:", applyErrors);
    process.exit(1);
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
