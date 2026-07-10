#!/usr/bin/env node
/**
 * Compute and store semantic-search embeddings for Firestore `posts` documents.
 *
 * Unlike the user-search-fields backfill, this write is ADDITIVE (adds an `embedding` Vector +
 * freshness metadata) rather than destructive, and is intended to run against a real DEV Firestore so
 * semantic search can be exercised end-to-end. Live writes therefore require an explicit `--confirm`
 * instead of the emulator-only guard. Requires embedding-provider config (SEARCH_EMBEDDING_*) and
 * Firestore credentials (see firestore-client.ts).
 *
 * Examples:
 *   npx tsx scripts/backfill-post-embeddings.mts --dry-run --limit=50
 *   npx tsx scripts/backfill-post-embeddings.mts --confirm --limit=5000 --progress-every=500
 *   npx tsx scripts/backfill-post-embeddings.mts --confirm --start-after=<postId>
 *   npx tsx scripts/backfill-post-embeddings.mts --confirm --force   # re-embed everything
 */
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { getEmbeddingConfig } from "../src/services/search/post-embedding.service.js";
import {
  mergePostEmbeddingsBackfillOptions,
  runPostEmbeddingsBackfill
} from "../src/services/ops/post-embeddings-backfill.runner.js";

type ParsedArgs = {
  dryRun: boolean;
  confirm: boolean;
  force: boolean;
  limit: number | null;
  startAfterDocId: string | null;
  progressEvery: number;
  pageSize: number;
};

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    dryRun: false,
    confirm: false,
    force: false,
    limit: null,
    startAfterDocId: null,
    progressEvery: 200,
    pageSize: 100
  };
  for (const raw of argv) {
    if (raw === "--dry-run") { args.dryRun = true; continue; }
    if (raw === "--confirm") { args.confirm = true; continue; }
    if (raw === "--force") { args.force = true; continue; }
    if (raw.startsWith("--limit=")) {
      const n = Number.parseInt(raw.slice("--limit=".length), 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid --limit: ${raw}`);
      args.limit = n; continue;
    }
    if (raw.startsWith("--start-after=")) {
      args.startAfterDocId = raw.slice("--start-after=".length).trim() || null; continue;
    }
    if (raw.startsWith("--progress-every=")) {
      const n = Number.parseInt(raw.slice("--progress-every=".length), 10);
      if (!Number.isFinite(n) || n < 0) throw new Error(`invalid --progress-every: ${raw}`);
      args.progressEvery = n; continue;
    }
    if (raw.startsWith("--page-size=")) {
      const n = Number.parseInt(raw.slice("--page-size=".length), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 500) throw new Error(`invalid --page-size (1-500): ${raw}`);
      args.pageSize = n; continue;
    }
    if (raw === "--help" || raw === "-h") { printHelp(); process.exit(0); }
    throw new Error(`unknown argument: ${raw}`);
  }
  return args;
}

function printHelp(): void {
  console.log(`Usage: npx tsx scripts/backfill-post-embeddings.mts [options]

Options:
  --dry-run              Count posts needing embedding without calling the provider or writing
  --confirm              Required to perform live writes (embeds + Firestore updates)
  --force                Re-embed posts even if already embedded at the current model+version
  --limit=N              Stop after scanning N posts
  --start-after=<postId> Resume after this post document id (exclusive)
  --progress-every=N     Log progress every ~N scanned posts (0 to disable)
  --page-size=N          Posts per page / embed batch (default 100, max 500)
`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const projectId =
    process.env.GCP_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.FIREBASE_PROJECT_ID ?? "unknown";

  const cfg = getEmbeddingConfig();
  if (!cfg) {
    console.error("Embedding provider unconfigured. Set SEARCH_EMBEDDING_PROVIDER/MODEL/DIM and GCP project.");
    process.exitCode = 1;
    return;
  }

  if (!parsed.dryRun && !parsed.confirm) {
    console.error(
      `Refusing live embedding backfill without --confirm. Target project=${projectId} model=${cfg.model} dim=${cfg.dim}.\n` +
        `Run with --dry-run first, then re-run with --confirm.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[backfill-post-embeddings] project=${projectId} model=${cfg.model} dim=${cfg.dim} dryRun=${parsed.dryRun} force=${parsed.force}`
  );

  const db = getFirestoreSourceClient();
  if (!db) {
    console.error("Firestore client unavailable (test mode, FIRESTORE_SOURCE_ENABLED=false, or init failure).");
    process.exitCode = 1;
    return;
  }

  const summary = await runPostEmbeddingsBackfill(
    db,
    mergePostEmbeddingsBackfillOptions({
      dryRun: parsed.dryRun,
      force: parsed.force,
      limit: parsed.limit,
      startAfterDocId: parsed.startAfterDocId,
      progressEvery: parsed.progressEvery,
      pageSize: parsed.pageSize
    })
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
