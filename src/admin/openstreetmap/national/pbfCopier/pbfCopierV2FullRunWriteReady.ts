/**
 * Aggregate write-ready spot/route counts across full-run chunk artifacts.
 * Dedupes by stable source key (same as write pipeline) then applies write validation.
 */
import {
  listPbfV2FullRunChunks,
  loadPbfV2FullRunChunkArtifact,
} from "./pbfCopierV2FullRunStore.js";
import type { PbfV2FullRunRecord } from "./pbfCopierV2FullRunTypes.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { buildPbfV2WritePayload, computePbfV2SourceKey } from "./pbfCopierV2WritePayload.js";

export type PbfV2WriteReadyCounts = {
  /** Valid unexploredSpots after dedupe + write validation */
  spots: number;
  /** Valid unexploredRoutes after dedupe + write validation */
  routes: number;
  /** spots + routes */
  total: number;
  /** Sum of visible items across chunks (before tile-overlap dedupe) */
  rawVisibleItems: number;
  /** Items dropped because the same source key appeared in multiple tiles */
  tileOverlapDuplicatesExcluded: number;
  /** Chunks included in this count */
  chunksIncluded: number;
  /** Chunks not yet processed */
  chunksPending: number;
  skippedSupportOnly: number;
  skippedInvalid: number;
  /** True when counted from chunk metadata only (in-progress run). */
  approximate?: boolean;
};

/** Sum of per-tile visible spot counts (may overlap at tile edges). */
export async function sumVisibleSpotsFromChunkRecords(runId: string): Promise<number> {
  const chunks = await listPbfV2FullRunChunks(runId);
  return chunks
    .filter((c) => c.status === "processed" || c.status === "written")
    .reduce((sum, c) => sum + (c.visibleSpotsCount ?? 0), 0);
}

/** Deduped visible items from pending chunk artifacts (same keys as write pipeline). */
export async function loadDedupedVisibleItemsForWrite(
  runId: string,
  chunkIds: string[]
): Promise<PbfCopierPreviewDoc[]> {
  const idSet = new Set(chunkIds);
  const chunks = (await listPbfV2FullRunChunks(runId)).filter((c) => idSet.has(c.chunkId));
  const byKey = new Map<string, PbfCopierPreviewDoc>();
  for (const chunk of chunks) {
    const artifact = await loadPbfV2FullRunChunkArtifact(runId, chunk.chunkId);
    if (!artifact) continue;
    for (const doc of artifact.visibleItems) {
      if (doc.filteredOut) continue;
      const key = computePbfV2SourceKey(doc);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, doc);
    }
  }
  return [...byKey.values()];
}

function countKind(doc: PbfCopierPreviewDoc): "spot" | "route" | "other" {
  if (doc.kind === "unexplored_spot") return "spot";
  if (doc.kind === "unexplored_route") return "route";
  return "other";
}

/** Fast in-progress estimate from chunk records (no artifact load, no cross-tile dedupe). */
export async function estimateWriteReadyFromChunkRecords(
  runId: string,
  totalChunks: number
): Promise<PbfV2WriteReadyCounts | null> {
  const chunks = await listPbfV2FullRunChunks(runId);
  const processed = chunks.filter((c) => c.status === "processed" || c.status === "written");
  if (processed.length === 0) return null;
  let spots = 0;
  let routes = 0;
  let rawVisible = 0;
  for (const chunk of processed) {
    spots += chunk.visibleSpotsCount ?? 0;
    routes += chunk.visibleRoutesCount ?? 0;
    rawVisible += chunk.visibleCount ?? 0;
  }
  return {
    spots,
    routes,
    total: spots + routes,
    rawVisibleItems: rawVisible,
    tileOverlapDuplicatesExcluded: 0,
    chunksIncluded: processed.length,
    chunksPending: Math.max(0, totalChunks - processed.length),
    skippedSupportOnly: 0,
    skippedInvalid: 0,
    approximate: true,
  };
}

export async function computePbfV2FullRunWriteReadyCounts(
  runId: string,
  run?: PbfV2FullRunRecord | null
): Promise<PbfV2WriteReadyCounts> {
  const chunks = await listPbfV2FullRunChunks(runId);
  const included = chunks.filter((c) => c.status === "processed" || c.status === "written");
  const pending = chunks.length - included.length;

  const byKey = new Map<string, PbfCopierPreviewDoc>();
  let rawVisible = 0;

  for (const chunk of included) {
    const artifact = await loadPbfV2FullRunChunkArtifact(runId, chunk.chunkId);
    if (!artifact) continue;
    for (const doc of artifact.visibleItems) {
      if (doc.filteredOut) continue;
      rawVisible += 1;
      const key = computePbfV2SourceKey(doc);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, doc);
    }
  }

  const deduped = [...byKey.values()];
  const tile = run?.currentTile;
  const bbox = tile
    ? {
        westLng: tile.westLng,
        southLat: tile.southLat,
        eastLng: tile.eastLng,
        northLat: tile.northLat,
      }
    : {
        westLng: -73.44,
        southLat: 42.73,
        eastLng: -71.46,
        northLat: 45.02,
      };

  const plan = buildPbfV2WritePayload({
    visibleItems: deduped,
    rawItems: deduped,
    bbox,
    scanCacheId: null,
    qualityFilterSettings: run?.qualityFilterSettings,
    selectedWriteScope: "all_visible",
    writeTarget: "none",
    writeRunId: runId,
  });

  return {
    spots: plan.spotsPlanned,
    routes: plan.routesPlanned,
    total: plan.spotsPlanned + plan.routesPlanned,
    rawVisibleItems: rawVisible,
    tileOverlapDuplicatesExcluded: Math.max(0, rawVisible - deduped.length),
    chunksIncluded: included.length,
    chunksPending: pending,
    skippedSupportOnly: plan.skippedSupportOnly,
    skippedInvalid: plan.skippedInvalid,
  };
}

/** Quick per-chunk spot/route split (no cross-tile dedupe). */
export function countVisibleSpotsAndRoutes(docs: PbfCopierPreviewDoc[]): { spots: number; routes: number } {
  let spots = 0;
  let routes = 0;
  for (const doc of docs) {
    if (doc.filteredOut) continue;
    const k = countKind(doc);
    if (k === "spot") spots += 1;
    else if (k === "route") routes += 1;
  }
  return { spots, routes };
}
