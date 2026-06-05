/**
 * Full Vermont PBF Copier V2 — chunked tile runner with checkpoint/resume.
 *
 * Resume strategy: geographic tile index checkpoint (not byte-offset).
 * Each tile re-scans the PBF with the same raw_osm + runPbfCopierV2Pipeline path as bbox preview.
 */
import { PBF_UNDISCOVERED_SHAPE_CONFIRMATION } from "./pbfCopierGuards.js";
import type { PbfDestinationQualityCounters } from "./pbfCopierV2DestinationQuality.js";
import {
  buildPbfV2FullRunId,
  getPbfV2FullRun,
  hashPbfFile,
  listPbfV2FullRunChunks,
  loadPbfV2FullRunChunkArtifact,
  savePbfV2FullRun,
  savePbfV2FullRunChunkArtifact,
} from "./pbfCopierV2FullRunStore.js";
import {
  buildFullRunValidationWarnings,
  sampleVisibleByCategory,
} from "./pbfCopierV2FullRunValidation.js";
import {
  emptyPbfV2FullRunStats,
  type PbfV2FullRunChunkArtifact,
  type PbfV2FullRunMode,
  type PbfV2FullRunRecord,
  type PbfV2FullRunStats,
} from "./pbfCopierV2FullRunTypes.js";
import { runPbfCopierV2Pipeline } from "./pbfCopierV2Pipeline.js";
import { computePbfV2SourceKey } from "./pbfCopierV2WritePayload.js";
import { executePbfV2Write } from "./pbfCopierV2Write.js";
import { validatePbfFile } from "./pbfCopierRunner.js";
import {
  DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
  type PbfQualityFilterSettings,
} from "./pbfCopierV2QualityFilters.js";
import { scanPbfViewportPreview } from "./pbfCopierV2ViewportPreview.js";
import { buildVermontTileGrid, type VermontTile } from "./pbfCopierV2VermontTiles.js";
import {
  computePbfV2FullRunWriteReadyCounts,
  countVisibleSpotsAndRoutes,
  estimateWriteReadyFromChunkRecords,
  loadDedupedVisibleItemsForWrite,
  sumVisibleSpotsFromChunkRecords,
  type PbfV2WriteReadyCounts,
} from "./pbfCopierV2FullRunWriteReady.js";
import type { PbfV2WriteProgress } from "./pbfCopierV2Write.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import type { OsmNationalWriteTarget } from "../osmNationalWriteGuard.js";

const activeLoops = new Set<string>();

function appendFullRunWriteLog(run: PbfV2FullRunRecord, message: string): void {
  const line = `${new Date().toISOString()} ${message}`;
  run.writeLog = [...(run.writeLog ?? []).slice(-120), line];
  console.log(`[pbfv2-full-run:${run.runId}] ${message}`);
}

async function saveWriteHeartbeat(
  run: PbfV2FullRunRecord,
  heartbeat: PbfV2FullRunRecord["writeHeartbeat"]
): Promise<void> {
  run.writeHeartbeat = heartbeat;
  run.updatedAt = new Date().toISOString();
  await savePbfV2FullRun(run);
}

function mergeDestinationCounters(
  base: PbfDestinationQualityCounters,
  add: PbfDestinationQualityCounters
): void {
  for (const key of Object.keys(add) as Array<keyof PbfDestinationQualityCounters>) {
    base[key] = (base[key] ?? 0) + (add[key] ?? 0);
  }
}

function mergeScanStats(run: PbfV2FullRunRecord, scanStats: PbfV2FullRunStats, filtered: {
  visible: number;
  hidden: number;
  destinationQuality?: PbfDestinationQualityCounters;
}): void {
  const s = run.stats;
  s.rawObjectsScanned += scanStats.rawObjectsScanned;
  s.nodesScanned += scanStats.nodesScanned;
  s.waysScanned += scanStats.waysScanned;
  s.relationsScanned += scanStats.relationsScanned;
  s.geometrySkipped += scanStats.geometrySkipped;
  s.outsideBboxSkipped += scanStats.outsideBboxSkipped;
  s.classifierAcceptedSpots += scanStats.classifierAcceptedSpots;
  s.classifierAcceptedRoutes += scanStats.classifierAcceptedRoutes;
  s.rejectedByClassifier += scanStats.rejectedByClassifier;
  s.residentialHomesFiltered += scanStats.residentialHomesFiltered;
  s.hikingTrailGroupsMerged += scanStats.hikingTrailGroupsMerged;
  s.hikingTrailSegmentsCollapsed += scanStats.hikingTrailSegmentsCollapsed;
  s.visibleItems += filtered.visible;
  s.hiddenItems += filtered.hidden;
  if (filtered.destinationQuality) mergeDestinationCounters(s.destinationQuality, filtered.destinationQuality);
}

function updateRunRates(run: PbfV2FullRunRecord): void {
  const elapsedMs = run.startedAt ? Date.now() - Date.parse(run.startedAt) : 0;
  run.elapsedMs = elapsedMs;
  run.avgObjectsPerSec = elapsedMs > 0 ? (run.processedObjects / elapsedMs) * 1000 : 0;
  run.avgBytesPerSec =
    run.processedBytes != null && elapsedMs > 0 ? (run.processedBytes / elapsedMs) * 1000 : 0;
  if (run.percentComplete > 0 && run.percentComplete < 100 && elapsedMs > 0) {
    run.etaMs = Math.round((elapsedMs / run.percentComplete) * (100 - run.percentComplete));
  } else {
    run.etaMs = null;
  }
}

async function shouldStopRun(runId: string): Promise<"continue" | "pause" | "stop"> {
  const run = await getPbfV2FullRun(runId);
  if (!run) return "stop";
  if (run.status === "stopping" || run.status === "stopped") return "stop";
  if (run.status === "paused" || run.status === "pausing") return "pause";
  return "continue";
}

async function processTileChunk(input: {
  run: PbfV2FullRunRecord;
  tile: VermontTile;
  pbfPath: string;
}): Promise<void> {
  const { run, tile, pbfPath } = input;
  run.phase = "scanning_ways";
  run.currentTile = tile;
  run.scanHeartbeat = {
    tileIndex: tile.tileIndex,
    tileId: tile.tileId,
    objectsScannedThisTile: 0,
    updatedAt: new Date().toISOString(),
  };
  updateRunRates(run);
  await savePbfV2FullRun(run);

  const scanBaseline = {
    rawObjectsScanned: run.stats.rawObjectsScanned,
    nodesScanned: run.stats.nodesScanned,
    waysScanned: run.stats.waysScanned,
    relationsScanned: run.stats.relationsScanned,
  };
  /** Rough objects per full Vermont PBF pass — used for in-tile progress only. */
  const estimatedObjectsPerFullPass = Math.max(5_000_000, run.totalObjectsEstimate ?? 8_000_000);

  const scan = await scanPbfViewportPreview({
    pbfPath,
    bbox: tile,
    mode: "raw_osm",
    onScanProgress: async (progress) => {
      run.scanHeartbeat = {
        tileIndex: tile.tileIndex,
        tileId: tile.tileId,
        objectsScannedThisTile: progress.rawObjectsScanned,
        updatedAt: new Date().toISOString(),
      };
      run.stats.rawObjectsScanned = scanBaseline.rawObjectsScanned + progress.rawObjectsScanned;
      run.stats.nodesScanned = scanBaseline.nodesScanned + progress.nodesScanned;
      run.stats.waysScanned = scanBaseline.waysScanned + progress.waysScanned;
      run.stats.relationsScanned = scanBaseline.relationsScanned + progress.relationsScanned;
      run.processedObjects = scanBaseline.rawObjectsScanned + progress.rawObjectsScanned;
      const tileFraction = Math.min(0.98, progress.rawObjectsScanned / estimatedObjectsPerFullPass);
      run.percentComplete = Math.round(((tile.tileIndex + tileFraction) / run.totalChunks) * 100);
      run.percentEstimated = true;
      updateRunRates(run);
      run.updatedAt = new Date().toISOString();
      await savePbfV2FullRun(run);
    },
  });

  run.scanHeartbeat = null;

  run.phase = "filtering";
  await savePbfV2FullRun(run);

  const filtered = runPbfCopierV2Pipeline({
    rawItems: scan.items,
    qualitySettings: run.qualityFilterSettings,
  });

  run.phase = "grouping";
  const visible = filtered.items.filter((d) => !d.filteredOut);
  const hidden = filtered.items.length - visible.length;
  const visibleKindCounts = countVisibleSpotsAndRoutes(visible);
  const now = new Date().toISOString();

  const chunkId = `chunk_${tile.tileIndex}_${tile.tileId}`;
  const artifact: PbfV2FullRunChunkArtifact = {
    chunk: {
      chunkId,
      tileId: tile.tileId,
      tileIndex: tile.tileIndex,
      status: "processed",
      bbox: tile,
      scanStats: scan.stats,
      filterSummary: filtered.summary as unknown as Record<string, unknown>,
      destinationQualityCounters: filtered.destinationQualityCounters ?? emptyPbfV2FullRunStats().destinationQuality,
      rawItemCount: scan.items.length,
      visibleCount: visible.length,
      visibleSpotsCount: visibleKindCounts.spots,
      visibleRoutesCount: visibleKindCounts.routes,
      hiddenCount: hidden,
      writeReadyCount: visible.length,
      writtenCount: 0,
      skippedDuplicateCount: 0,
      errorCount: 0,
      sourceKeysSample: visible.slice(0, 12).map((d) => computePbfV2SourceKey(d)),
      createdAt: now,
      updatedAt: now,
    },
    visibleItems: visible,
  };

  await savePbfV2FullRunChunkArtifact(run.runId, artifact);

  mergeScanStats(
    run,
    {
      ...emptyPbfV2FullRunStats(),
      rawObjectsScanned: scan.stats.rawObjectsScanned,
      nodesScanned: scan.stats.nodesScanned,
      waysScanned: scan.stats.waysScanned,
      relationsScanned: scan.stats.relationsScanned,
      geometrySkipped: scan.stats.geometrySkipped,
      outsideBboxSkipped: 0,
      classifierAcceptedSpots: scan.stats.classifierAcceptedSpots,
      classifierAcceptedRoutes: scan.stats.classifierAcceptedRoutes,
      rejectedByClassifier: scan.stats.rejectedByClassifier,
      residentialHomesFiltered: scan.stats.residentialHomesFiltered ?? 0,
      hikingTrailGroupsMerged: scan.stats.hikingTrailGroupsMerged ?? 0,
      hikingTrailSegmentsCollapsed: scan.stats.hikingTrailSegmentsCollapsed ?? 0,
      visibleItems: 0,
      hiddenItems: 0,
      chunksProcessed: 0,
      chunksWritten: 0,
      chunksFailed: 0,
      writeBatchesCommitted: 0,
      duplicateStableIdsSkipped: 0,
      claimedOrUserOwnedSkipped: 0,
      dbWriteRetries: 0,
      dbWriteErrors: 0,
      destinationQuality: emptyPbfV2FullRunStats().destinationQuality,
    },
    {
      visible: visible.length,
      hidden,
      destinationQuality: filtered.destinationQualityCounters,
    }
  );

  run.stats.chunksProcessed += 1;
  run.processedObjects += scan.stats.rawObjectsScanned;
  run.currentChunkIndex = tile.tileIndex + 1;
  run.completedChunkIds.push(chunkId);
  run.lastCheckpoint = chunkId;
  run.percentComplete = Math.round((run.currentChunkIndex / run.totalChunks) * 100);
  run.percentEstimated = true;
  if (run.totalBytes != null) {
    run.processedBytes = Math.round((run.percentComplete / 100) * run.totalBytes);
  }
  updateRunRates(run);
  run.updatedAt = new Date().toISOString();
}

async function stopRunAtSpotLimit(runId: string, spotSum: number, maxTotalSpots: number): Promise<boolean> {
  const run = await getPbfV2FullRun(runId);
  if (!run) return true;
  run.status = "complete";
  run.phase = "complete";
  run.percentComplete = 100;
  run.completedAt = new Date().toISOString();
  run.updatedAt = run.completedAt;
  const sample = await collectVisibleSample(runId, 200);
  run.validationWarnings = [
    ...buildFullRunValidationWarnings(run, sample),
    `Stopped at spot limit (${spotSum.toLocaleString()} visible spots collected, max ${maxTotalSpots.toLocaleString()}).`,
  ];
  await savePbfV2FullRun(run);
  return true;
}

async function shouldStopAtSpotLimit(runId: string): Promise<boolean> {
  const run = await getPbfV2FullRun(runId);
  if (!run?.maxTotalSpots) return false;
  const spotSum = await sumVisibleSpotsFromChunkRecords(runId);
  if (spotSum < run.maxTotalSpots) return false;
  return stopRunAtSpotLimit(runId, spotSum, run.maxTotalSpots);
}

export async function startPbfV2FullRun(input: {
  pbfPath: string;
  mode?: PbfV2FullRunMode;
  qualityFilterSettings?: PbfQualityFilterSettings;
  tileStepDegrees?: number;
  maxChunks?: number | null;
  maxTotalSpots?: number | null;
}): Promise<PbfV2FullRunRecord> {
  const validation = await validatePbfFile(input.pbfPath);
  if (!validation.exists || !validation.readable) {
    throw new Error(`pbf_not_readable: ${validation.resolvedPath}`);
  }
  const fileMeta = await hashPbfFile(validation.resolvedPath);
  const tiles = buildVermontTileGrid(input.tileStepDegrees ?? 0.4);
  const now = new Date().toISOString();
  const run: PbfV2FullRunRecord = {
    runId: buildPbfV2FullRunId(),
    region: "vermont",
    sourceFilePath: validation.resolvedPath,
    sourceFileHash: fileMeta.hash,
    sourceFileBytes: fileMeta.bytes ?? validation.fileSizeBytes ?? null,
    status: "pending",
    mode: input.mode ?? "dry_run",
    phase: "idle",
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    lastCheckpoint: null,
    processedBytes: 0,
    totalBytes: fileMeta.bytes ?? validation.fileSizeBytes ?? null,
    percentComplete: 0,
    percentEstimated: true,
    processedObjects: 0,
    totalObjectsEstimate: null,
    elapsedMs: 0,
    avgObjectsPerSec: 0,
    avgBytesPerSec: 0,
    etaMs: null,
    currentChunkIndex: 0,
    totalChunks: tiles.length,
    completedChunkIds: [],
    writtenChunkIds: [],
    stats: emptyPbfV2FullRunStats(),
    writeStats: {
      attempted: 0,
      written: 0,
      skippedDuplicates: 0,
      spotsWritten: 0,
      routesWritten: 0,
      tilesWritten: 0,
      errors: 0,
    },
    errorsSample: [],
    errorCount: 0,
    qualityFilterSettings: {
      ...DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
      ...(input.qualityFilterSettings ?? {}),
      hideUnnamedPaths: false,
    },
    maxChunks: input.maxChunks ?? null,
    maxTotalSpots: input.maxTotalSpots ?? null,
    tileStepDegrees: input.tileStepDegrees ?? 0.4,
    currentTile: null,
    validationWarnings: [],
  };

  await savePbfV2FullRun(run);
  void executePbfV2FullRunLoop(run.runId, tiles);
  return run;
}

export async function resumePbfV2FullRun(runId: string): Promise<PbfV2FullRunRecord | null> {
  const run = await getPbfV2FullRun(runId);
  if (!run) return null;
  if (run.status === "complete") return run;
  run.status = "running";
  run.phase = "scanning_ways";
  run.updatedAt = new Date().toISOString();
  await savePbfV2FullRun(run);
  const tiles = buildVermontTileGrid(run.tileStepDegrees);
  void executePbfV2FullRunLoop(runId, tiles);
  return run;
}

async function executePbfV2FullRunLoop(runId: string, tiles: VermontTile[]): Promise<void> {
  if (activeLoops.has(runId)) return;
  activeLoops.add(runId);
  try {
    const run = await getPbfV2FullRun(runId);
    if (!run) return;
    run.status = "running";
    await savePbfV2FullRun(run);

    const startIndex = run.currentChunkIndex;
    for (let i = startIndex; i < tiles.length; i++) {
      const gate = await shouldStopRun(runId);
      if (gate === "stop") {
        const current = await getPbfV2FullRun(runId);
        if (current) {
          current.status = "stopped";
          current.phase = "paused";
          current.updatedAt = new Date().toISOString();
          await savePbfV2FullRun(current);
        }
        return;
      }
      if (gate === "pause") {
        const current = await getPbfV2FullRun(runId);
        if (current) {
          current.status = "paused";
          current.phase = "paused";
          current.updatedAt = new Date().toISOString();
          await savePbfV2FullRun(current);
        }
        return;
      }

      const current = await getPbfV2FullRun(runId);
      if (!current) return;
      if (current.maxChunks != null && current.stats.chunksProcessed >= current.maxChunks) {
        current.status = "complete";
        current.phase = "complete";
        current.percentComplete = 100;
        current.completedAt = new Date().toISOString();
        current.updatedAt = current.completedAt;
        await savePbfV2FullRun(current);
        return;
      }
      if (current.maxTotalSpots != null) {
        const spotSum = await sumVisibleSpotsFromChunkRecords(runId);
        if (spotSum >= current.maxTotalSpots) {
          await stopRunAtSpotLimit(runId, spotSum, current.maxTotalSpots);
          return;
        }
      }

      try {
        await processTileChunk({ run: current, tile: tiles[i]!, pbfPath: current.sourceFilePath });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        current.errorCount += 1;
        if (current.errorsSample.length < 20) current.errorsSample.push(message);
        current.stats.chunksFailed += 1;
        current.status = "error";
        current.phase = "error";
        current.updatedAt = new Date().toISOString();
        await savePbfV2FullRun(current);
        return;
      }

      const refreshed = await getPbfV2FullRun(runId);
      if (!refreshed) return;
      refreshed.validationWarnings = buildFullRunValidationWarnings(
        refreshed,
        await collectVisibleSample(runId, 200)
      );
      await savePbfV2FullRun(refreshed);

      if (await shouldStopAtSpotLimit(runId)) return;
    }

    const done = await getPbfV2FullRun(runId);
    if (!done) return;
    done.status = "complete";
    done.phase = "complete";
    done.percentComplete = 100;
    done.completedAt = new Date().toISOString();
    done.updatedAt = done.completedAt;
    done.validationWarnings = buildFullRunValidationWarnings(done, await collectVisibleSample(runId, 300));
    await savePbfV2FullRun(done);
  } finally {
    activeLoops.delete(runId);
  }
}

async function collectVisibleSample(runId: string, maxItems: number): Promise<PbfCopierPreviewDoc[]> {
  const chunks = await listPbfV2FullRunChunks(runId);
  const out: PbfCopierPreviewDoc[] = [];
  for (const chunk of chunks) {
    const artifact = await loadPbfV2FullRunChunkArtifact(runId, chunk.chunkId);
    if (!artifact) continue;
    for (const item of artifact.visibleItems) {
      out.push(item);
      if (out.length >= maxItems) return out;
    }
  }
  return out;
}

export async function pausePbfV2FullRun(runId: string): Promise<PbfV2FullRunRecord | null> {
  const run = await getPbfV2FullRun(runId);
  if (!run) return null;
  run.status = run.status === "running" ? "pausing" : "paused";
  run.updatedAt = new Date().toISOString();
  await savePbfV2FullRun(run);
  return run;
}

export async function stopPbfV2FullRun(runId: string): Promise<PbfV2FullRunRecord | null> {
  const run = await getPbfV2FullRun(runId);
  if (!run) return null;
  run.status = "stopping";
  run.updatedAt = new Date().toISOString();
  await savePbfV2FullRun(run);
  return run;
}

function resolveWriteTarget(mode: PbfV2FullRunMode, explicit?: OsmNationalWriteTarget): OsmNationalWriteTarget {
  if (explicit) return explicit;
  if (mode === "write_prod") return "production";
  if (mode === "write_test") return "emulator";
  return "none";
}

export async function writePbfV2FullRunChunks(input: {
  runId: string;
  dryRun?: boolean;
  writeTarget?: OsmNationalWriteTarget;
  confirmProductionWrite?: string;
  confirmUndiscoveredShape?: string;
  skipExisting?: boolean;
  chunkIds?: string[];
}): Promise<{
  run: PbfV2FullRunRecord | null;
  writeResult: Awaited<ReturnType<typeof executePbfV2Write>> | null;
  categorySamples: Record<string, PbfCopierPreviewDoc[]>;
}> {
  const run = await getPbfV2FullRun(input.runId);
  if (!run) return { run: null, writeResult: null, categorySamples: {} };

  const chunks = await listPbfV2FullRunChunks(input.runId);
  const pending = chunks.filter(
    (c) =>
      c.status === "processed" &&
      !run.writtenChunkIds.includes(c.chunkId) &&
      (!input.chunkIds?.length || input.chunkIds.includes(c.chunkId))
  );

  if (pending.length === 0) {
    appendFullRunWriteLog(run, "No pending processed chunks to write.");
    await savePbfV2FullRun(run);
    return { run, writeResult: null, categorySamples: {} };
  }

  const explicitRealWrite =
    input.dryRun === false &&
    (input.writeTarget === "production" || input.writeTarget === "emulator");
  const dryRun = input.dryRun === true || (!explicitRealWrite && run.mode === "dry_run");
  const writeTarget = dryRun ? "none" : resolveWriteTarget(run.mode, input.writeTarget);

  appendFullRunWriteLog(
    run,
    dryRun
      ? `Dry run write started (${pending.length} chunk(s))`
      : `Production write started → ${writeTarget} (${pending.length} chunk(s))`
  );

  run.phase = "writing";
  await saveWriteHeartbeat(run, {
    status: "writing",
    dryRun,
    writeTarget: writeTarget === "none" ? "dry_run" : writeTarget,
    stage: "loading",
    batchIndex: 0,
    batchCount: 0,
    spotsPlanned: 0,
    routesPlanned: 0,
    spotsWritten: 0,
    routesWritten: 0,
    tilesWritten: 0,
    skippedDuplicates: 0,
    errors: [],
    message: "Loading deduped chunk artifacts…",
    updatedAt: new Date().toISOString(),
  });

  const visibleItems = await loadDedupedVisibleItemsForWrite(
    input.runId,
    pending.map((c) => c.chunkId)
  );
  appendFullRunWriteLog(run, `Loaded ${visibleItems.length.toLocaleString()} deduped visible item(s) from disk`);
  await savePbfV2FullRun(run);

  const bbox = run.currentTile ?? {
    westLng: -73.44,
    southLat: 42.73,
    eastLng: -71.46,
    northLat: 45.02,
    tileId: "vermont",
    tileIndex: 0,
  };

  const writeResult = await executePbfV2Write({
    visibleItems,
    rawItems: visibleItems,
    bbox: {
      westLng: bbox.westLng,
      southLat: bbox.southLat,
      eastLng: bbox.eastLng,
      northLat: bbox.northLat,
    },
    scanCacheId: null,
    qualityFilterSettings: run.qualityFilterSettings,
    selectedWriteScope: "all_visible",
    writeTarget,
    confirmProductionWrite: input.confirmProductionWrite,
    confirmUndiscoveredShape: input.confirmUndiscoveredShape ?? PBF_UNDISCOVERED_SHAPE_CONFIRMATION,
    dryRun,
    skipExisting: input.skipExisting !== false,
    writeRunId: run.runId,
    confirmLargeWrite: true,
    onWriteProgress: async (progress: PbfV2WriteProgress) => {
      if (progress.message) appendFullRunWriteLog(run, progress.message);
      await saveWriteHeartbeat(run, {
        status: "writing",
        dryRun,
        writeTarget: writeTarget === "none" ? "dry_run" : writeTarget,
        stage: progress.stage,
        batchIndex: progress.batchIndex,
        batchCount: progress.batchCount,
        spotsPlanned: progress.spotsPlanned,
        routesPlanned: progress.routesPlanned,
        spotsWritten: progress.spotsWritten,
        routesWritten: progress.routesWritten,
        tilesWritten: progress.tilesWritten,
        skippedDuplicates: 0,
        errors: [],
        message: progress.message,
        updatedAt: new Date().toISOString(),
      });
    },
  });

  if (writeResult.errors.length) {
    appendFullRunWriteLog(run, `Write finished with errors: ${writeResult.errors.join(" · ")}`);
  } else if (dryRun) {
    appendFullRunWriteLog(
      run,
      `Dry run complete — would write ${writeResult.spotsPlanned} spots, ${writeResult.routesPlanned} routes (zero Firestore writes)`
    );
  } else {
    appendFullRunWriteLog(
      run,
      `Write complete — ${writeResult.spotsWritten} spots, ${writeResult.routesWritten} routes, ${writeResult.tilesWritten} tile docs`
    );
  }

  run.writeHeartbeat = {
    status: writeResult.errors.length ? "error" : "complete",
    dryRun,
    writeTarget: writeTarget === "none" ? "dry_run" : writeTarget,
    stage: "done",
    batchIndex: 0,
    batchCount: 0,
    spotsPlanned: writeResult.spotsPlanned,
    routesPlanned: writeResult.routesPlanned,
    spotsWritten: writeResult.spotsWritten,
    routesWritten: writeResult.routesWritten,
    tilesWritten: writeResult.tilesWritten,
    skippedDuplicates: writeResult.skippedDuplicates,
    errors: writeResult.errors.slice(0, 8),
    message: writeResult.errors[0] ?? (dryRun ? "Dry run complete" : "Write complete"),
    updatedAt: new Date().toISOString(),
  };

  if (!dryRun && writeResult.written > 0) {
    for (const chunk of pending) {
      if (!run.writtenChunkIds.includes(chunk.chunkId)) {
        run.writtenChunkIds.push(chunk.chunkId);
        chunk.status = "written";
        chunk.writtenCount = chunk.writeReadyCount;
        chunk.skippedDuplicateCount = writeResult.skippedDuplicates;
        const artifact = await loadPbfV2FullRunChunkArtifact(input.runId, chunk.chunkId);
        if (artifact) {
          artifact.chunk = { ...chunk, status: "written", updatedAt: new Date().toISOString() };
          await savePbfV2FullRunChunkArtifact(input.runId, artifact);
        }
      }
    }
    run.stats.chunksWritten += pending.length;
    run.writeStats.attempted += writeResult.attempted;
    run.writeStats.written += writeResult.written;
    run.writeStats.skippedDuplicates += writeResult.skippedDuplicates;
    run.writeStats.spotsWritten += writeResult.spotsWritten;
    run.writeStats.routesWritten += writeResult.routesWritten;
    run.writeStats.tilesWritten += writeResult.tilesWritten;
    run.writeStats.errors += writeResult.errors.length;
    run.stats.duplicateStableIdsSkipped += writeResult.skippedDuplicates;
    run.stats.writeBatchesCommitted += 1;
  }

  run.phase = run.status === "running" ? "scanning_ways" : run.phase;
  run.updatedAt = new Date().toISOString();
  run.validationWarnings = buildFullRunValidationWarnings(run, visibleItems.slice(0, 300));
  await savePbfV2FullRun(run);

  return {
    run,
    writeResult,
    categorySamples: sampleVisibleByCategory(visibleItems),
  };
}

export async function getPbfV2FullRunStatus(runId: string): Promise<{
  run: PbfV2FullRunRecord | null;
  chunks: Awaited<ReturnType<typeof listPbfV2FullRunChunks>>;
  categorySamples: Record<string, PbfCopierPreviewDoc[]>;
  writeReadyCounts: PbfV2WriteReadyCounts | null;
}> {
  const run = await getPbfV2FullRun(runId);
  if (!run) return { run: null, chunks: [], categorySamples: {}, writeReadyCounts: null };
  updateRunRates(run);
  const chunks = await listPbfV2FullRunChunks(runId);
  const writeReadyCounts =
    run.status === "complete" || run.status === "paused" || run.status === "stopped"
      ? chunks.length > 0
        ? await computePbfV2FullRunWriteReadyCounts(runId, run)
        : null
      : await estimateWriteReadyFromChunkRecords(runId, run.totalChunks);
  const sample = await collectVisibleSample(runId, 120);
  return { run, chunks, categorySamples: sampleVisibleByCategory(sample), writeReadyCounts };
}
