import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  PbfV2FullRunChunkArtifact,
  PbfV2FullRunChunkRecord,
  PbfV2FullRunRecord,
} from "./pbfCopierV2FullRunTypes.js";

const RUNS_DIR_NAME = "pbf-copier-v2-runs";

function repoRunsRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../../../data", RUNS_DIR_NAME);
}

export function pbfV2FullRunDir(runId: string): string {
  return path.join(repoRunsRoot(), runId);
}

export function pbfV2FullRunChunkPath(runId: string, chunkId: string): string {
  return path.join(pbfV2FullRunDir(runId), "chunks", `${chunkId}.json`);
}

const memoryRuns = new Map<string, PbfV2FullRunRecord>();
const memoryChunks = new Map<string, Map<string, PbfV2FullRunChunkRecord>>();

function chunkMapKey(runId: string): string {
  return runId;
}

export function buildPbfV2FullRunId(): string {
  return `pbfv2_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function hashPbfFile(filePath: string): Promise<{ hash: string | null; bytes: number | null }> {
  try {
    const stat = await fs.stat(filePath);
    const head = Buffer.alloc(Math.min(1024 * 1024, stat.size));
    const fh = await fs.open(filePath, "r");
    try {
      await fh.read(head, 0, head.length, 0);
    } finally {
      await fh.close();
    }
    const hash = createHash("sha256")
      .update(head)
      .update(String(stat.size))
      .update(filePath)
      .digest("hex")
      .slice(0, 16);
    return { hash, bytes: stat.size };
  } catch {
    return { hash: null, bytes: null };
  }
}

async function ensureRunDirs(runId: string): Promise<void> {
  await fs.mkdir(path.join(pbfV2FullRunDir(runId), "chunks"), { recursive: true });
}

export async function savePbfV2FullRun(run: PbfV2FullRunRecord): Promise<void> {
  memoryRuns.set(run.runId, run);
  await ensureRunDirs(run.runId);
  await fs.writeFile(path.join(pbfV2FullRunDir(run.runId), "run.json"), JSON.stringify(run, null, 2), "utf8");
}

export async function getPbfV2FullRun(runId: string): Promise<PbfV2FullRunRecord | null> {
  const mem = memoryRuns.get(runId);
  if (mem) return mem;
  try {
    const raw = await fs.readFile(path.join(pbfV2FullRunDir(runId), "run.json"), "utf8");
    const parsed = JSON.parse(raw) as PbfV2FullRunRecord;
    memoryRuns.set(runId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function listPbfV2FullRuns(limit = 20): Promise<PbfV2FullRunRecord[]> {
  const merged = new Map<string, PbfV2FullRunRecord>();
  for (const run of memoryRuns.values()) merged.set(run.runId, run);
  try {
    const root = repoRunsRoot();
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const run = await getPbfV2FullRun(entry.name);
      if (run) merged.set(run.runId, run);
    }
  } catch {
    // no runs dir yet
  }
  return [...merged.values()]
    .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
    .slice(0, limit);
}

export async function savePbfV2FullRunChunkArtifact(
  runId: string,
  artifact: PbfV2FullRunChunkArtifact
): Promise<void> {
  const key = chunkMapKey(runId);
  let map = memoryChunks.get(key);
  if (!map) {
    map = new Map();
    memoryChunks.set(key, map);
  }
  map.set(artifact.chunk.chunkId, artifact.chunk);
  await ensureRunDirs(runId);
  await fs.writeFile(pbfV2FullRunChunkPath(runId, artifact.chunk.chunkId), JSON.stringify(artifact), "utf8");
}

export async function loadPbfV2FullRunChunkArtifact(
  runId: string,
  chunkId: string
): Promise<PbfV2FullRunChunkArtifact | null> {
  try {
    const raw = await fs.readFile(pbfV2FullRunChunkPath(runId, chunkId), "utf8");
    return JSON.parse(raw) as PbfV2FullRunChunkArtifact;
  } catch {
    return null;
  }
}

export async function listPbfV2FullRunChunks(runId: string): Promise<PbfV2FullRunChunkRecord[]> {
  const mem = memoryChunks.get(chunkMapKey(runId));
  if (mem && mem.size > 0) return [...mem.values()].sort((a, b) => a.tileIndex - b.tileIndex);
  const chunksDir = path.join(pbfV2FullRunDir(runId), "chunks");
  try {
    const files = await fs.readdir(chunksDir);
    const out: PbfV2FullRunChunkRecord[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const artifact = await loadPbfV2FullRunChunkArtifact(runId, file.replace(/\.json$/, ""));
      if (artifact) out.push(artifact.chunk);
    }
    return out.sort((a, b) => a.tileIndex - b.tileIndex);
  } catch {
    return [];
  }
}
