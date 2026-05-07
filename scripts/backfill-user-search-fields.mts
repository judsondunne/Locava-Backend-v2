#!/usr/bin/env node
/**
 * Scan all Firestore user documents and populate or fix searchHandle/searchName fields.
 *
 * Prerequisites: same credentials as Backendv2 Firestore source (see firestore-client.ts).
 *
 * Examples:
 *   cd "Locava Backendv2" && npx tsx scripts/backfill-user-search-fields.mts --dry-run --limit=100
 *   cd "Locava Backendv2" && npx tsx scripts/backfill-user-search-fields.mts --limit=50000 --progress-every=1000
 *   cd "Locava Backendv2" && npx tsx scripts/backfill-user-search-fields.mts --start-after=<uid>
 */
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { assertEmulatorOnlyDestructiveFirestoreOperation } from "../src/safety/firestoreDestructiveGuard.js";
import {
  mergeUserSearchFieldsBackfillOptions,
  runUserSearchFieldsBackfill
} from "../src/services/ops/user-search-fields-backfill.runner.js";

type ParsedArgs = {
  dryRun: boolean;
  limit: number | null;
  startAfterDocId: string | null;
  progressEvery: number;
  pageSize: number;
  batchSize: number;
};

function parseArgs(argv: string[]): ParsedArgs {
  const defaults: ParsedArgs = {
    dryRun: false,
    limit: null,
    startAfterDocId: null,
    progressEvery: 500,
    pageSize: 400,
    batchSize: 400
  };

  for (const raw of argv) {
    if (raw === "--dry-run") {
      defaults.dryRun = true;
      continue;
    }
    if (raw.startsWith("--limit=")) {
      const n = Number.parseInt(raw.slice("--limit=".length), 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid --limit: ${raw}`);
      defaults.limit = n;
      continue;
    }
    if (raw.startsWith("--start-after=")) {
      defaults.startAfterDocId = raw.slice("--start-after=".length).trim() || null;
      continue;
    }
    if (raw.startsWith("--progress-every=")) {
      const n = Number.parseInt(raw.slice("--progress-every=".length), 10);
      if (!Number.isFinite(n) || n < 0) throw new Error(`invalid --progress-every: ${raw}`);
      defaults.progressEvery = n;
      continue;
    }
    if (raw.startsWith("--page-size=")) {
      const n = Number.parseInt(raw.slice("--page-size=".length), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 500) throw new Error(`invalid --page-size (1-500): ${raw}`);
      defaults.pageSize = n;
      continue;
    }
    if (raw.startsWith("--batch-size=")) {
      const n = Number.parseInt(raw.slice("--batch-size=".length), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 500) throw new Error(`invalid --batch-size (1-500): ${raw}`);
      defaults.batchSize = n;
      continue;
    }
    if (raw === "--help" || raw === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${raw}`);
  }

  return defaults;
}

function printHelp(): void {
  console.log(`Usage: npx tsx scripts/backfill-user-search-fields.mts [options]

Options:
  --dry-run              Preview updates without writes
  --limit=N              Stop after scanning N users (recommended for trials)
  --start-after=<docId>  Resume after this user document id (exclusive)
  --progress-every=N     Log progress every N scanned users (0 to disable)
  --page-size=N          Firestore query page size (default 400, max 500)
  --batch-size=N         Writes per Firestore batch (default 400, max 500)
`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.dryRun) {
    assertEmulatorOnlyDestructiveFirestoreOperation("backfill-user-search-fields", "users");
    console.log(
      `EMULATOR_ONLY_SCRIPT_CONFIRMED operation=backfill-user-search-fields FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST ?? ""} projectId=${process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "unknown"}`
    );
  }
  const db = getFirestoreSourceClient();
  if (!db) {
    console.error("Firestore client unavailable (test mode, FIRESTORE_SOURCE_ENABLED=false, or init failure).");
    process.exitCode = 1;
    return;
  }

  const summary = await runUserSearchFieldsBackfill(
    db,
    mergeUserSearchFieldsBackfillOptions({
      dryRun: parsed.dryRun,
      limit: parsed.limit,
      startAfterDocId: parsed.startAfterDocId,
      progressEvery: parsed.progressEvery,
      pageSize: parsed.pageSize,
      batchSize: parsed.batchSize
    })
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
