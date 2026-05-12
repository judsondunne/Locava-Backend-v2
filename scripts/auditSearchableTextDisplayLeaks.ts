#!/usr/bin/env node
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { standardizePostDocForRender } from "../src/services/posts/standardize-post-doc-for-render.js";
import { toAppPostV2FromAny } from "../src/lib/posts/app-post-v2/toAppPostV2.js";
import { buildPostEnvelope } from "../src/lib/posts/post-envelope.js";
import { getPostCaption, getPostDescription } from "../src/lib/posts/postFieldSelectors.js";
import { getRawSearchableText } from "../src/lib/posts/displayText.js";

type CliArgs = {
  limit: number;
  scanAll: boolean;
  postId: string | null;
  outJson: string | null;
  outCsv: string | null;
};

type LeakRow = {
  postId: string;
  hydrator: string;
  fieldName: string;
  value: string;
  searchableText: string;
};

const DISPLAY_PATHS = [
  "description",
  "caption",
  "content",
  "body",
  "subtitle",
  "text.description",
  "text.caption",
  "text.content",
  "compatibility.content",
  "compatibility.description",
  "compatibility.caption",
] as const;

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
  return {
    limit: Number.isFinite(limitParsed) && limitParsed > 0 ? limitParsed : 200,
    scanAll: hasFlag(argv, "--all"),
    postId: readFlag(argv, "--postId") ?? null,
    outJson: readFlag(argv, "--out") ?? null,
    outCsv: readFlag(argv, "--csv") ?? null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readNestedString(doc: Record<string, unknown>, dotPath: string): string | undefined {
  const segments = dotPath.split(".");
  let current: unknown = doc;
  for (const segment of segments) {
    const record = asRecord(current);
    if (!record || !(segment in record)) return undefined;
    current = record[segment];
  }
  return typeof current === "string" ? current : undefined;
}

function collectLeaks(postId: string, hydrator: string, payload: Record<string, unknown>, searchableText: string): LeakRow[] {
  const comparable = searchableText.trim().replace(/\s+/g, " ");
  if (!comparable) return [];
  const leaks: LeakRow[] = [];
  for (const fieldName of DISPLAY_PATHS) {
    const value = readNestedString(payload, fieldName);
    if (!value) continue;
    if (value.trim().replace(/\s+/g, " ") === comparable) {
      leaks.push({ postId, hydrator, fieldName, value, searchableText });
    }
  }
  return leaks;
}

function hydratePayloads(postId: string, raw: Record<string, unknown>): Array<{ hydrator: string; payload: Record<string, unknown> }> {
  const out: Array<{ hydrator: string; payload: Record<string, unknown> }> = [];
  const standardized = standardizePostDocForRender(raw, postId);
  if (standardized.ok) {
    out.push({ hydrator: "standardizePostDocForRender", payload: standardized.doc as unknown as Record<string, unknown> });
  }
  out.push({
    hydrator: "toAppPostV2FromAny",
    payload: toAppPostV2FromAny(raw, { postId }) as unknown as Record<string, unknown>,
  });
  out.push({
    hydrator: "buildPostEnvelope.detail",
    payload: buildPostEnvelope({
      postId,
      seed: { postId },
      sourcePost: raw,
      rawPost: raw,
      hydrationLevel: "detail",
      sourceRoute: "auditSearchableTextDisplayLeaks",
    }) as Record<string, unknown>,
  });
  out.push({
    hydrator: "searchDiscoveryProjection",
    payload: {
      postId,
      caption: getPostCaption(raw),
      description: getPostDescription(raw),
    },
  });
  return out;
}

function toCsv(rows: LeakRow[]): string {
  const header = "postId,hydrator,fieldName,searchableText,value";
  const lines = rows.map((row) =>
    [row.postId, row.hydrator, row.fieldName, JSON.stringify(row.searchableText), JSON.stringify(row.value)].join(","),
  );
  return [header, ...lines].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getFirestoreSourceClient();
  const leaks: LeakRow[] = [];
  let scanned = 0;

  const scanDoc = async (postId: string, raw: Record<string, unknown>) => {
    scanned += 1;
    const searchableText = getRawSearchableText(raw);
    for (const hydrated of hydratePayloads(postId, raw)) {
      leaks.push(...collectLeaks(postId, hydrated.hydrator, hydrated.payload, searchableText));
    }
  };

  if (args.postId) {
    const snap = await db.collection("posts").doc(args.postId).get();
    if (!snap.exists) {
      console.error(`Post not found: ${args.postId}`);
      process.exitCode = 1;
      return;
    }
    await scanDoc(snap.id, snap.data() as Record<string, unknown>);
  } else {
    let query = db.collection("posts").orderBy("createdAtMs", "desc").limit(args.scanAll ? 10_000 : args.limit);
    const snap = await query.get();
    for (const doc of snap.docs) {
      await scanDoc(doc.id, doc.data() as Record<string, unknown>);
      if (!args.scanAll && scanned >= args.limit) break;
    }
  }

  const fieldCounts = new Map<string, number>();
  const hydratorCounts = new Map<string, number>();
  for (const leak of leaks) {
    fieldCounts.set(leak.fieldName, (fieldCounts.get(leak.fieldName) ?? 0) + 1);
    hydratorCounts.set(leak.hydrator, (hydratorCounts.get(leak.hydrator) ?? 0) + 1);
  }

  const summary = {
    totalScanned: scanned,
    leakCount: leaks.length,
    fieldsLeaking: Object.fromEntries(fieldCounts.entries()),
    hydratorsLeaking: Object.fromEntries(hydratorCounts.entries()),
    examplePostIds: [...new Set(leaks.map((row) => row.postId))].slice(0, 25),
    leaks,
  };

  console.log(`total scanned: ${scanned}`);
  console.log(`leak count: ${leaks.length}`);
  console.log(`fields leaking: ${JSON.stringify(summary.fieldsLeaking)}`);
  console.log(`hydrators leaking: ${JSON.stringify(summary.hydratorsLeaking)}`);
  if (summary.examplePostIds.length > 0) {
    console.log(`example postIds: ${summary.examplePostIds.join(", ")}`);
  }

  const outJson = args.outJson ?? "./artifacts/searchable-text-display-leaks.json";
  const outCsv = args.outCsv ?? "./artifacts/searchable-text-display-leaks.csv";
  await mkdir(path.dirname(outJson), { recursive: true });
  await writeFile(outJson, JSON.stringify(summary, null, 2), "utf8");
  await writeFile(outCsv, toCsv(leaks), "utf8");
  console.log(`wrote ${outJson}`);
  console.log(`wrote ${outCsv}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
