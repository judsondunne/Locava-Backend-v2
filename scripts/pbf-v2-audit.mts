#!/usr/bin/env npx tsx
/**
 * DEV-ONLY — PBF Copier V2 audit runner (no Firestore writes).
 *
 * Example:
 *   npm run pbf:audit -- --pbf ./data/osm/vermont-latest.osm.pbf --bbox -72.42,43.63,-72.38,43.65 --limit 50
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPbfCopierV2Audit } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2Audit.js";
import { MARSH_BILLINGS_ROCKEFELLER_VT_BBOX } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2ViewportPreview.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type CliArgs = {
  pbf: string;
  bbox: { westLng: number; southLat: number; eastLng: number; northLat: number };
  limit?: number;
  includeRejected: boolean;
  includeRawTags: boolean;
  includeGeometry: boolean;
  includeWritePreview: boolean;
  dryRun: boolean;
  sampleMode?: "raw_osm" | "locava_filtered";
  categoryFilter?: string;
  osmIdFilter?: string;
  maxRawObjectsScanned?: number;
  out?: string;
};

function parseBbox(value: string): CliArgs["bbox"] {
  const parts = value.split(",").map((p) => Number.parseFloat(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid --bbox "${value}" — expected west,south,east,north`);
  }
  const [westLng, southLat, eastLng, northLat] = parts as [number, number, number, number];
  return { westLng, southLat, eastLng, northLat };
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    pbf: path.join(ROOT, "data/osm/vermont-latest.osm.pbf"),
    bbox: MARSH_BILLINGS_ROCKEFELLER_VT_BBOX,
    includeRejected: true,
    includeRawTags: true,
    includeGeometry: false,
    includeWritePreview: true,
    dryRun: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    const next = argv[i + 1];
    switch (token) {
      case "--pbf":
      case "-p":
        if (!next) throw new Error(`${token} requires a path`);
        args.pbf = path.isAbsolute(next) ? next : path.join(ROOT, next);
        i += 1;
        break;
      case "--bbox":
      case "-b":
        if (!next) throw new Error(`${token} requires west,south,east,north`);
        args.bbox = parseBbox(next);
        i += 1;
        break;
      case "--limit":
      case "-l":
        if (!next) throw new Error(`${token} requires a number`);
        args.limit = Number.parseInt(next, 10);
        i += 1;
        break;
      case "--includeRejected":
        args.includeRejected = next !== "false";
        if (next === "true" || next === "false") i += 1;
        break;
      case "--includeRawTags":
        args.includeRawTags = next !== "false";
        if (next === "true" || next === "false") i += 1;
        break;
      case "--includeGeometry":
        args.includeGeometry = next !== "false";
        if (next === "true" || next === "false") i += 1;
        break;
      case "--includeWritePreview":
        args.includeWritePreview = next !== "false";
        if (next === "true" || next === "false") i += 1;
        break;
      case "--dryRun":
        args.dryRun = next !== "false";
        if (next === "true" || next === "false") i += 1;
        break;
      case "--sampleMode":
        if (!next || (next !== "raw_osm" && next !== "locava_filtered")) {
          throw new Error("--sampleMode must be raw_osm or locava_filtered");
        }
        args.sampleMode = next;
        i += 1;
        break;
      case "--categoryFilter":
        if (!next) throw new Error("--categoryFilter requires a value");
        args.categoryFilter = next;
        i += 1;
        break;
      case "--osmIdFilter":
        if (!next) throw new Error("--osmIdFilter requires node/123 or numeric id");
        args.osmIdFilter = next;
        i += 1;
        break;
      case "--maxRawObjectsScanned":
        if (!next) throw new Error("--maxRawObjectsScanned requires a number");
        args.maxRawObjectsScanned = Number.parseInt(next, 10);
        i += 1;
        break;
      case "--out":
      case "-o":
        if (!next) throw new Error(`${token} requires a path`);
        args.out = path.isAbsolute(next) ? next : path.join(ROOT, next);
        i += 1;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        if (token.startsWith("-")) throw new Error(`Unknown flag: ${token}`);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`PBF Copier V2 audit (dev-only, no Firestore writes)

Usage:
  npm run pbf:audit -- [options]

Options:
  --pbf <path>                 Local .osm.pbf file (default: data/osm/vermont-latest.osm.pbf)
  --bbox <w,s,e,n>             Viewport bbox (default: Marsh-Billings-Rockefeller VT)
  --limit <n>                  Cap each accepted/rejected array length
  --includeRejected [true]     Include rejected items (default true)
  --includeRawTags [true]      Include full OSM tag objects (default true)
  --includeGeometry [false]    Include sampled geometry coordinates
  --includeWritePreview [true] Include Firestore write preview (writeTarget=none)
  --dryRun [true]              Audit mode only — never writes (default true)
  --sampleMode raw_osm|locava_filtered
  --categoryFilter <text>      Filter detailed records by category/tag family
  --osmIdFilter <id>           Filter by osm id or node/way/relation/id
  --maxRawObjectsScanned <n>   Stop PBF scan after N raw entities
  --out <path>                 Write JSON report to file
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await runPbfCopierV2Audit({
    pbfPath: args.pbf,
    bbox: args.bbox,
    limit: args.limit,
    includeRejected: args.includeRejected,
    includeRawTags: args.includeRawTags,
    includeGeometry: args.includeGeometry,
    includeWritePreview: args.includeWritePreview,
    dryRun: args.dryRun,
    sampleMode: args.sampleMode,
    categoryFilter: args.categoryFilter,
    osmIdFilter: args.osmIdFilter,
    maxRawObjectsScanned: args.maxRawObjectsScanned,
  });

  const json = JSON.stringify(result, null, 2);
  if (args.out) {
    await fs.writeFile(args.out, json, "utf8");
    console.error(`Wrote audit report to ${args.out}`);
  }
  console.log(json);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
