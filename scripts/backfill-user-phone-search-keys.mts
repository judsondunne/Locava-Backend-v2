#!/usr/bin/env node
import { FieldPath } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { derivePhoneSearchFieldsFromDoc } from "../src/lib/phone-search-fields.js";

type ParsedArgs = {
  write: boolean;
  dryRun: boolean;
  limit: number | null;
  pageSize: number;
  progressEvery: number;
};

type Summary = {
  scanned: number;
  updated: number;
  skippedNoPhone: number;
  invalidPhone: number;
  sampleBeforeAfter: Array<{
    userId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }>;
};

const PHONE_FIELDS = [
  "phoneNumber",
  "phone",
  "phone_number",
  "number",
  "phoneE164",
  "phoneDigits",
  "contactPhone",
];

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    write: false,
    dryRun: true,
    limit: null,
    pageSize: 300,
    progressEvery: 250,
  };
  for (const raw of argv) {
    if (raw === "--write") {
      parsed.write = true;
      parsed.dryRun = false;
      continue;
    }
    if (raw === "--dry-run") {
      parsed.dryRun = true;
      parsed.write = false;
      continue;
    }
    if (raw.startsWith("--limit=")) {
      const n = Number.parseInt(raw.slice("--limit=".length), 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid --limit: ${raw}`);
      parsed.limit = n;
      continue;
    }
    if (raw.startsWith("--page-size=")) {
      const n = Number.parseInt(raw.slice("--page-size=".length), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 500) throw new Error(`invalid --page-size: ${raw}`);
      parsed.pageSize = n;
      continue;
    }
    if (raw.startsWith("--progress-every=")) {
      const n = Number.parseInt(raw.slice("--progress-every=".length), 10);
      if (!Number.isFinite(n) || n < 0) throw new Error(`invalid --progress-every: ${raw}`);
      parsed.progressEvery = n;
      continue;
    }
    if (raw === "--help" || raw === "-h") {
      console.log("Usage: npx tsx scripts/backfill-user-phone-search-keys.mts [--dry-run] [--write] [--limit=N] [--page-size=N] [--progress-every=N]");
      process.exit(0);
    }
    throw new Error(`unknown argument: ${raw}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("Firestore source client unavailable.");
  }
  const summary: Summary = {
    scanned: 0,
    updated: 0,
    skippedNoPhone: 0,
    invalidPhone: 0,
    sampleBeforeAfter: [],
  };

  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    if (args.limit !== null && summary.scanned >= args.limit) break;
    const remaining = args.limit === null ? args.pageSize : Math.max(0, args.limit - summary.scanned);
    if (remaining === 0) break;
    let query = db.collection("users").orderBy(FieldPath.documentId()).limit(Math.min(args.pageSize, remaining));
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    if (snap.empty) break;

    const batch = db.batch();
    let pendingWrites = 0;

    for (const doc of snap.docs) {
      summary.scanned += 1;
      const data = doc.data() as Record<string, unknown>;
      const beforeSubset: Record<string, unknown> = {};
      for (const key of [...PHONE_FIELDS, "phoneLast10", "phoneSearchKeys"]) {
        if (key in data) beforeSubset[key] = data[key];
      }

      const hasAnyPhoneSource = PHONE_FIELDS.some((field) => typeof data[field] === "string" && String(data[field]).trim().length > 0);
      if (!hasAnyPhoneSource) {
        summary.skippedNoPhone += 1;
        cursor = doc;
        continue;
      }

      const derived = derivePhoneSearchFieldsFromDoc(data);
      const patch: Record<string, unknown> = {};
      if (derived.phoneDigits) patch.phoneDigits = derived.phoneDigits;
      if (derived.phoneLast10) patch.phoneLast10 = derived.phoneLast10;
      if (derived.phoneE164) patch.phoneE164 = derived.phoneE164;
      if (derived.phoneSearchKeys && derived.phoneSearchKeys.length > 0) patch.phoneSearchKeys = derived.phoneSearchKeys;

      if (Object.keys(patch).length === 0) {
        summary.invalidPhone += 1;
        cursor = doc;
        continue;
      }

      const changed = Object.entries(patch).some(([key, value]) => JSON.stringify(data[key]) !== JSON.stringify(value));
      if (!changed) {
        cursor = doc;
        continue;
      }

      if (summary.sampleBeforeAfter.length < 10) {
        summary.sampleBeforeAfter.push({
          userId: doc.id,
          before: beforeSubset,
          after: patch,
        });
      }

      if (args.write && !args.dryRun) {
        batch.set(doc.ref, patch, { merge: true });
        pendingWrites += 1;
      }
      summary.updated += 1;
      cursor = doc;
    }

    if (args.write && !args.dryRun && pendingWrites > 0) {
      await batch.commit();
    }
    if (args.progressEvery > 0 && summary.scanned % args.progressEvery === 0) {
      console.error(
        `[backfill-user-phone-search-keys] scanned=${summary.scanned} updated=${summary.updated} skippedNoPhone=${summary.skippedNoPhone} invalidPhone=${summary.invalidPhone}`
      );
    }
    if (snap.size < Math.min(args.pageSize, remaining)) break;
  }

  console.log(JSON.stringify({ dryRun: args.dryRun, ...summary }, null, 2));
  console.log(
    [
      "Suggested run order:",
      "npm run backfill:user-phone-search-keys -- --dry-run --limit=25",
      "npm run backfill:user-phone-search-keys -- --write --limit=500",
      "npm run backfill:user-phone-search-keys -- --write",
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
