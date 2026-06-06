#!/usr/bin/env npx tsx
/**
 * Vermont PBF Copier V2 evaluation harness — baseline / after / compare (no Firestore writes).
 *
 *   npm run pbf:evaluate-vermont -- --mode baseline
 *   npm run pbf:evaluate-vermont -- --mode after
 *   npm run pbf:evaluate-vermont -- --mode compare
 *   npm run pbf:evaluate-vermont -- --mode baseline --region woodstock-marsh-billings
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPbfCopierV2Audit, type PbfCopierV2AuditResult } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2Audit.js";
import {
  VERMONT_EVAL_REGIONS,
  type VermontEvalRegion,
  bboxForVermontEvalRegion,
} from "../src/admin/openstreetmap/national/pbfCopier/pbfVermontEvalRegions.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PBF_DEFAULT = path.join(ROOT, "data/osm/vermont-latest.osm.pbf");
const EVAL_ROOT = path.join(ROOT, "tmp/pbf-v2-evals");

type Mode = "baseline" | "after" | "compare";

type RegionSummary = {
  slug: string;
  name: string;
  acceptedSpots: number;
  rejectedSpots: number;
  acceptedRoutes: number;
  rejectedRoutes: number;
  falseNegatives: number;
  falsePositives: number;
  fragmentedRoutes: number;
  hikingTrailSegmentsCollapsed: number;
  topRejectReasons: Array<{ reason: string; count: number }>;
  qualityFilterVisible: number;
  qualityFilterHidden: number;
  elapsedMs: number;
};

function parseArgs(argv: string[]): {
  mode: Mode;
  pbfPath: string;
  region?: string;
  limit?: number;
  outDir?: string;
} {
  let mode: Mode = "baseline";
  let pbfPath = PBF_DEFAULT;
  let region: string | undefined;
  let limit: number | undefined;
  let outDir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    const next = argv[i + 1];
    switch (token) {
      case "--mode":
      case "-m":
        if (!next || !["baseline", "after", "compare"].includes(next)) {
          throw new Error("--mode must be baseline, after, or compare");
        }
        mode = next as Mode;
        i += 1;
        break;
      case "--pbf":
        if (!next) throw new Error("--pbf requires path");
        pbfPath = path.isAbsolute(next) ? next : path.join(ROOT, next);
        i += 1;
        break;
      case "--region":
      case "-r":
        if (!next) throw new Error("--region requires slug");
        region = next;
        i += 1;
        break;
      case "--limit":
        if (!next) throw new Error("--limit requires number");
        limit = Number.parseInt(next, 10);
        i += 1;
        break;
      case "--outDir":
        if (!next) throw new Error("--outDir requires path");
        outDir = path.isAbsolute(next) ? next : path.join(ROOT, next);
        i += 1;
        break;
      case "--help":
      case "-h":
        console.log(`Usage: npm run pbf:evaluate-vermont -- --mode baseline|after|compare [--region slug] [--limit N]`);
        process.exit(0);
        break;
      default:
        if (token.startsWith("-")) throw new Error(`Unknown flag: ${token}`);
    }
  }

  return { mode, pbfPath, region, limit, outDir };
}

function countRejectReasons(result: PbfCopierV2AuditResult): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of [...result.rejectedSpots, ...result.rejectedRoutes]) {
    for (const reason of item.rejectReasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

function summarizeRegion(result: PbfCopierV2AuditResult, region: VermontEvalRegion): RegionSummary {
  const fragmentedRoutes = result.acceptedRoutes.filter(
    (r) => r.fragmentationHints.mayBeFragmented || r.fragmentationHints.splitByIntersectionGrouping
  ).length;

  return {
    slug: region.slug,
    name: region.name,
    acceptedSpots: result.summary.acceptedSpots,
    rejectedSpots: result.summary.rejectedSpots,
    acceptedRoutes: result.summary.acceptedRoutes,
    rejectedRoutes: result.summary.rejectedRoutes,
    falseNegatives: result.potentialFalseNegatives.length,
    falsePositives: result.potentialFalsePositives.length,
    fragmentedRoutes,
    hikingTrailSegmentsCollapsed: result.summary.hikingTrailSegmentsCollapsed,
    topRejectReasons: countRejectReasons(result),
    qualityFilterVisible: result.summary.qualityFilterVisible,
    qualityFilterHidden: result.summary.qualityFilterHidden,
    elapsedMs: result.summary.elapsedMs,
  };
}

function markdownTable(rows: RegionSummary[], label: string): string {
  const lines = [
    `## ${label}`,
    "",
    "| Region | Acc Spots | Rej Spots | Acc Routes | Rej Routes | FN | FP | Frag Routes | Trail Seg Collapsed | Visible | Hidden |",
    "|--------|-----------|-----------|------------|------------|----|----|-------------|---------------------|---------|--------|",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.slug} | ${r.acceptedSpots} | ${r.rejectedSpots} | ${r.acceptedRoutes} | ${r.rejectedRoutes} | ${r.falseNegatives} | ${r.falsePositives} | ${r.fragmentedRoutes} | ${r.hikingTrailSegmentsCollapsed} | ${r.qualityFilterVisible} | ${r.qualityFilterHidden} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function runRegionAudit(input: {
  region: VermontEvalRegion;
  pbfPath: string;
  limit?: number;
  outFile: string;
}): Promise<{ result: PbfCopierV2AuditResult; summary: RegionSummary }> {
  console.error(`[eval] auditing ${input.region.slug} (${input.region.name})...`);
  const result = await runPbfCopierV2Audit({
    pbfPath: input.pbfPath,
    bbox: bboxForVermontEvalRegion(input.region),
    limit: input.limit ?? 100,
    includeRejected: true,
    includeRawTags: true,
    includeWritePreview: false,
    dryRun: true,
  });

  if (result.firestoreWrites !== false) {
    throw new Error("audit must never write Firestore");
  }

  await fs.mkdir(path.dirname(input.outFile), { recursive: true });
  await fs.writeFile(input.outFile, JSON.stringify(result, null, 2), "utf8");
  console.error(`[eval] wrote ${input.outFile} (${result.summary.elapsedMs}ms)`);

  return { result, summary: summarizeRegion(result, input.region) };
}

async function runAuditMode(input: {
  mode: "baseline" | "after";
  pbfPath: string;
  regionFilter?: string;
  limit?: number;
  outDir?: string;
}): Promise<void> {
  const dir = input.outDir ?? path.join(EVAL_ROOT, input.mode);
  await fs.mkdir(dir, { recursive: true });

  const regions = input.regionFilter
    ? VERMONT_EVAL_REGIONS.filter((r) => r.slug === input.regionFilter)
    : VERMONT_EVAL_REGIONS;

  if (regions.length === 0) {
    throw new Error(`Unknown region: ${input.regionFilter}`);
  }

  const summaries: RegionSummary[] = [];
  for (const region of regions) {
    const outFile = path.join(dir, `${region.slug}.json`);
    const { summary } = await runRegionAudit({
      region,
      pbfPath: input.pbfPath,
      limit: input.limit,
      outFile,
    });
    summaries.push(summary);
  }

  const md = [
    `# PBF V2 evaluation — ${input.mode}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Firestore writes: **none** (dryRun audit only)`,
    "",
    markdownTable(summaries, "Region summary"),
    "",
    "### Top reject reasons (aggregated)",
    "",
  ];

  const allReasons = new Map<string, number>();
  for (const s of summaries) {
    for (const r of s.topRejectReasons) {
      allReasons.set(r.reason, (allReasons.get(r.reason) ?? 0) + r.count);
    }
  }
  for (const [reason, count] of [...allReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    md.push(`- ${reason}: ${count}`);
  }

  const summaryPath = path.join(dir, "summary.md");
  await fs.writeFile(summaryPath, md.join("\n"), "utf8");
  console.error(`[eval] wrote ${summaryPath}`);
}

async function runCompareMode(): Promise<void> {
  const baselineDir = path.join(EVAL_ROOT, "baseline");
  const afterDir = path.join(EVAL_ROOT, "after");

  const rows: Array<{
    slug: string;
    before: RegionSummary | null;
    after: RegionSummary | null;
  }> = [];

  for (const region of VERMONT_EVAL_REGIONS) {
    let before: RegionSummary | null = null;
    let after: RegionSummary | null = null;

    try {
      const raw = await fs.readFile(path.join(baselineDir, `${region.slug}.json`), "utf8");
      const parsed = JSON.parse(raw) as PbfCopierV2AuditResult;
      before = summarizeRegion(parsed, region);
    } catch {
      before = null;
    }
    try {
      const raw = await fs.readFile(path.join(afterDir, `${region.slug}.json`), "utf8");
      const parsed = JSON.parse(raw) as PbfCopierV2AuditResult;
      after = summarizeRegion(parsed, region);
    } catch {
      after = null;
    }

    rows.push({ slug: region.slug, before, after });
  }

  const lines = [
    "# PBF V2 evaluation — baseline vs after",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Region | Spots before→after | Routes before→after | Rej spots before→after | Frag routes before→after | FN before→after | FP before→after |",
    "|--------|-------------------|---------------------|------------------------|--------------------------|-----------------|-----------------|",
  ];

  for (const row of rows) {
    const b = row.before;
    const a = row.after;
    const spotDelta =
      b && a ? `${b.acceptedSpots}→${a.acceptedSpots} (${a.acceptedSpots - b.acceptedSpots >= 0 ? "+" : ""}${a.acceptedSpots - b.acceptedSpots})` : "n/a";
    const routeDelta =
      b && a ? `${b.acceptedRoutes}→${a.acceptedRoutes} (${a.acceptedRoutes - b.acceptedRoutes >= 0 ? "+" : ""}${a.acceptedRoutes - b.acceptedRoutes})` : "n/a";
    const rejDelta = b && a ? `${b.rejectedSpots}→${a.rejectedSpots}` : "n/a";
    const fragDelta = b && a ? `${b.fragmentedRoutes}→${a.fragmentedRoutes}` : "n/a";
    const fnDelta = b && a ? `${b.falseNegatives}→${a.falseNegatives}` : "n/a";
    const fpDelta = b && a ? `${b.falsePositives}→${a.falsePositives}` : "n/a";
    lines.push(`| ${row.slug} | ${spotDelta} | ${routeDelta} | ${rejDelta} | ${fragDelta} | ${fnDelta} | ${fpDelta} |`);
  }

  lines.push("");
  const outPath = path.join(EVAL_ROOT, "comparison-report.md");
  await fs.writeFile(outPath, lines.join("\n"), "utf8");
  console.error(`[eval] wrote ${outPath}`);
}

async function main(): Promise<void> {
  await fs.mkdir(EVAL_ROOT, { recursive: true });
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === "compare") {
    await runCompareMode();
    return;
  }

  await runAuditMode({
    mode: args.mode,
    pbfPath: args.pbfPath,
    regionFilter: args.region,
    limit: args.limit,
    outDir: args.outDir,
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
