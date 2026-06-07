import type { AppEnv } from "../../config/env.js";
import {
  getPbfV2FullRun,
  listPbfV2FullRunChunks,
  listPbfV2FullRuns,
  loadPbfV2FullRunChunkArtifact,
} from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2FullRunStore.js";
import { loadDedupedVisibleItemsForWrite } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2FullRunWriteReady.js";
import { computePbfV2SourceKey } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2WritePayload.js";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import type {
  PbfAssetPreviewChunkOption,
  PbfAssetPreviewFetchResponse,
  PbfAssetPreviewItem,
  PbfAssetPreviewProgress,
  PbfAssetPreviewRunOption,
  PbfAssetPreviewSourcesResponse,
  PbfPhotoVisionMode,
} from "../../types/pbfAssetPreview.js";
import { selectPbfAssetPreviewCandidates } from "./pbfAssetPreviewFilters.js";
import {
  formatAssetPreviewRunLabel,
  isRealFullVermontRunMode,
  pickDefaultAssetPreviewRunId,
} from "./pickPbfAssetPreviewRun.js";
import { processPbfAssetPreviewSpot } from "./pbfAssetPreviewSpot.js";

const DEFAULT_CONCURRENCY = 6;
const MAX_PREVIEW_SPOTS = 100;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current]!, current);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

async function loadAcceptedPreviewDocs(
  runId: string,
  chunkId?: string | null,
): Promise<PbfCopierPreviewDoc[]> {
  if (chunkId) {
    const artifact = await loadPbfV2FullRunChunkArtifact(runId, chunkId);
    if (!artifact) return [];
    const byKey = new Map<string, PbfCopierPreviewDoc>();
    for (const doc of artifact.visibleItems) {
      if (doc.filteredOut) continue;
      const key = computePbfV2SourceKey(doc);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, doc);
    }
    return [...byKey.values()];
  }

  const chunks = await listPbfV2FullRunChunks(runId);
  const processedIds = chunks
    .filter((c) => c.status === "processed" || c.status === "written")
    .map((c) => c.chunkId);
  return loadDedupedVisibleItemsForWrite(runId, processedIds);
}

export type PbfAssetPreviewPreparedFetch = {
  runId: string;
  chunkId: string | null;
  selection: ReturnType<typeof selectPbfAssetPreviewCandidates>;
  selected: PbfCopierPreviewDoc[];
};

export async function preparePbfAssetPreviewFetch(params: {
  runId?: string | null;
  activeRunId?: string | null;
  chunkId?: string | null;
  maxSpots?: number;
}): Promise<PbfAssetPreviewPreparedFetch> {
  const sources = await listPbfAssetPreviewSources(params.runId, params.activeRunId);
  const runId = params.runId ?? sources.defaultRunId;
  if (!runId) {
    throw new Error(
      "No Full Vermont Run artifacts found. Start a Full Vermont Run (write-test or write-prod) above, then fetch photos.",
    );
  }

  const run = await getPbfV2FullRun(runId);
  const maxSpots = Math.max(1, Math.min(params.maxSpots ?? 10, MAX_PREVIEW_SPOTS));
  const allDocs = await loadAcceptedPreviewDocs(runId, params.chunkId);
  const selection = selectPbfAssetPreviewCandidates(allDocs, maxSpots, {
    preferWriteReady: isRealFullVermontRunMode(run?.mode),
  });
  if (selection.selected.length === 0) {
    throw new Error(
      `No photo-query-ready accepted spots found in run ${runId}. ` +
        `${selection.eligibleCount} eligible visible items, ` +
        `${selection.photoQueryReadyCount} passed OSM-specific query builder ` +
        `(${selection.junkExcludedCount} junk excluded, ${selection.querySkippedCount} query-skipped). ` +
        "Try a different chunk or a fuller Vermont run.",
    );
  }

  return {
    runId,
    chunkId: params.chunkId ?? null,
    selection,
    selected: selection.selected,
  };
}

function buildProgress(input: {
  prepared: PbfAssetPreviewPreparedFetch;
  items: PbfAssetPreviewItem[];
  started: number;
  lookupDurations: number[];
  spotsSkipped: number;
  photoLookupsCompleted: number;
  photoLookupsFailed: number;
  lowConfidenceCount: number;
  geminiJudged: number;
  geminiRejected: number;
  geminiEnabled: boolean;
}): PbfAssetPreviewProgress {
  return {
    spotsLoaded: input.prepared.selected.length,
    spotsEligible: input.prepared.selection.eligibleCount,
    photoQueryReady: input.prepared.selection.photoQueryReadyCount,
    spotsSkipped: input.spotsSkipped,
    photoLookupsCompleted: input.photoLookupsCompleted,
    photoLookupsFailed: input.photoLookupsFailed,
    lowConfidenceCount: input.lowConfidenceCount,
    geminiJudged: input.geminiJudged,
    geminiRejected: input.geminiRejected,
    geminiEnabled: input.geminiEnabled,
    elapsedMs: Date.now() - input.started,
    avgLookupSpeedMs:
      input.lookupDurations.length > 0
        ? Math.round(input.lookupDurations.reduce((sum, ms) => sum + ms, 0) / input.lookupDurations.length)
        : null,
  };
}

export async function fetchPbfAssetPreview(params: {
  env: AppEnv;
  runId?: string | null;
  activeRunId?: string | null;
  chunkId?: string | null;
  maxSpots?: number;
  concurrency?: number;
  geminiApiKey?: string | null;
  visionMode?: PbfPhotoVisionMode;
  strictTitleSourceMatch?: boolean;
}): Promise<PbfAssetPreviewFetchResponse> {
  const started = Date.now();
  const prepared = await preparePbfAssetPreviewFetch({
    runId: params.runId,
    activeRunId: params.activeRunId,
    chunkId: params.chunkId,
    maxSpots: params.maxSpots,
  });
  const concurrency = Math.max(2, Math.min(params.concurrency ?? DEFAULT_CONCURRENCY, 8));

  const lookupDurations: number[] = [];
  let photoLookupsCompleted = 0;
  let photoLookupsFailed = 0;
  let lowConfidenceCount = 0;
  let spotsSkipped = 0;
  let geminiJudged = 0;
  let geminiRejected = 0;
  let geminiEnabled = false;

  const processed = await mapWithConcurrency(prepared.selected, concurrency, async (doc) => {
    const { item, stats } = await processPbfAssetPreviewSpot(doc, {
      env: params.env,
      geminiApiKey: params.geminiApiKey,
      visionMode: params.visionMode,
      strictTitleSourceMatch: params.strictTitleSourceMatch,
    });
    if (stats.lookupMs > 0) lookupDurations.push(stats.lookupMs);
    if (stats.skipped) spotsSkipped += 1;
    if (stats.lookupFailed) photoLookupsFailed += 1;
    else if (!stats.skipped) photoLookupsCompleted += 1;
    if (stats.lowConfidence) lowConfidenceCount += 1;
    geminiEnabled = geminiEnabled || stats.geminiEnabled;
    geminiJudged += stats.geminiJudged;
    geminiRejected += stats.geminiRejected;
    return item;
  });

  return {
    ok: true,
    runId: prepared.runId,
    chunkId: prepared.chunkId,
    mode: "dry_preview",
    progress: buildProgress({
      prepared,
      items: processed,
      started,
      lookupDurations,
      spotsSkipped,
      photoLookupsCompleted,
      photoLookupsFailed,
      lowConfidenceCount,
      geminiJudged,
      geminiRejected,
      geminiEnabled,
    }),
    items: processed,
  };
}

export type PbfAssetPreviewStreamEvent =
  | {
      type: "meta";
      runId: string;
      chunkId: string | null;
      totalSpots: number;
      photoQueryReady: number;
    }
  | { type: "spot"; index: number; total: number; item: PbfAssetPreviewItem }
  | { type: "done"; progress: PbfAssetPreviewProgress; items: PbfAssetPreviewItem[] };

export async function streamPbfAssetPreview(
  params: {
    env: AppEnv;
    runId?: string | null;
    activeRunId?: string | null;
    chunkId?: string | null;
    maxSpots?: number;
    concurrency?: number;
    geminiApiKey?: string | null;
    visionMode?: PbfPhotoVisionMode;
    strictTitleSourceMatch?: boolean;
  },
  onEvent: (event: PbfAssetPreviewStreamEvent) => void,
): Promise<PbfAssetPreviewFetchResponse> {
  const started = Date.now();
  const prepared = await preparePbfAssetPreviewFetch({
    runId: params.runId,
    activeRunId: params.activeRunId,
    chunkId: params.chunkId,
    maxSpots: params.maxSpots,
  });
  const concurrency = Math.max(2, Math.min(params.concurrency ?? DEFAULT_CONCURRENCY, 8));

  onEvent({
    type: "meta",
    runId: prepared.runId,
    chunkId: prepared.chunkId,
    totalSpots: prepared.selected.length,
    photoQueryReady: prepared.selection.photoQueryReadyCount,
  });

  const lookupDurations: number[] = [];
  let photoLookupsCompleted = 0;
  let photoLookupsFailed = 0;
  let lowConfidenceCount = 0;
  let spotsSkipped = 0;
  let geminiJudged = 0;
  let geminiRejected = 0;
  let geminiEnabled = false;
  const items: PbfAssetPreviewItem[] = new Array(prepared.selected.length);
  let nextIndex = 0;
  let completed = 0;

  await new Promise<void>((resolve, reject) => {
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, prepared.selected.length)) }, () =>
      (async () => {
        while (nextIndex < prepared.selected.length) {
          const index = nextIndex;
          nextIndex += 1;
          const doc = prepared.selected[index]!;
          try {
            const { item, stats } = await processPbfAssetPreviewSpot(doc, {
              env: params.env,
              geminiApiKey: params.geminiApiKey,
              visionMode: params.visionMode,
              strictTitleSourceMatch: params.strictTitleSourceMatch,
            });
            items[index] = item;
            if (stats.lookupMs > 0) lookupDurations.push(stats.lookupMs);
            if (stats.skipped) spotsSkipped += 1;
            if (stats.lookupFailed) photoLookupsFailed += 1;
            else if (!stats.skipped) photoLookupsCompleted += 1;
            if (stats.lowConfidence) lowConfidenceCount += 1;
            geminiEnabled = geminiEnabled || stats.geminiEnabled;
            geminiJudged += stats.geminiJudged;
            geminiRejected += stats.geminiRejected;
            completed += 1;
            onEvent({
              type: "spot",
              index: completed,
              total: prepared.selected.length,
              item,
            });
          } catch (error) {
            reject(error);
            return;
          }
        }
      })(),
    );
    void Promise.all(workers).then(() => resolve(), reject);
  });

  const progress = buildProgress({
    prepared,
    items,
    started,
    lookupDurations,
    spotsSkipped,
    photoLookupsCompleted,
    photoLookupsFailed,
    lowConfidenceCount,
    geminiJudged,
    geminiRejected,
    geminiEnabled,
  });

  onEvent({ type: "done", progress, items });

  return {
    ok: true,
    runId: prepared.runId,
    chunkId: prepared.chunkId,
    mode: "dry_preview",
    progress,
    items,
  };
}

export async function listPbfAssetPreviewSources(
  runId?: string | null,
  activeRunId?: string | null,
): Promise<PbfAssetPreviewSourcesResponse> {
  const runs = await listPbfV2FullRuns(30);
  const defaultRunId = pickDefaultAssetPreviewRunId(runs, runId, activeRunId);
  const runOptions: PbfAssetPreviewRunOption[] = [...runs]
    .sort((a, b) => {
      if (a.runId === defaultRunId) return -1;
      if (b.runId === defaultRunId) return 1;
      const modeA = a.mode === "write_prod" ? 0 : a.mode === "write_test" ? 1 : 2;
      const modeB = b.mode === "write_prod" ? 0 : b.mode === "write_test" ? 1 : 2;
      if (modeA !== modeB) return modeA - modeB;
      return b.updatedAt > a.updatedAt ? 1 : -1;
    })
    .map((run) => {
      const processedChunks = run.completedChunkIds?.length ?? 0;
      return {
        runId: run.runId,
        region: run.region,
        mode: run.mode,
        status: run.status,
        updatedAt: run.updatedAt,
        totalChunks: run.totalChunks,
        processedChunks,
        maxTotalSpots: run.maxTotalSpots ?? null,
        isActive: Boolean(activeRunId && run.runId === activeRunId),
        isRealWriteRun: isRealFullVermontRunMode(run.mode),
        label: formatAssetPreviewRunLabel(run, activeRunId),
      };
    });

  const prefersWriteRuns = runOptions.some((run) => run.isRealWriteRun);
  let chunks: PbfAssetPreviewChunkOption[] = [];
  if (defaultRunId) {
    const chunkRecords = await listPbfV2FullRunChunks(defaultRunId);
    chunks = chunkRecords
      .filter((c) => c.status === "processed" || c.status === "written")
      .map((c) => ({
        chunkId: c.chunkId,
        tileId: c.tileId,
        tileIndex: c.tileIndex,
        status: c.status,
        visibleCount: c.visibleCount,
        label: `tile ${c.tileIndex + 1} · ${c.tileId} · ${c.visibleCount} visible`,
      }));
  }

  return {
    ok: true,
    defaultRunId,
    activeRunId: activeRunId ?? null,
    prefersWriteRuns,
    runs: runOptions,
    chunks,
  };
}
