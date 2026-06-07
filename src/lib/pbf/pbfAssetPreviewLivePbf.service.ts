import { DEFAULT_VERMONT_PBF_PATH } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierPathHelpers.js";
import { validatePbfFile } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierRunner.js";
import { runPbfCopierV2Pipeline } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2Pipeline.js";
import { DEFAULT_PBF_QUALITY_FILTER_SETTINGS } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2QualityFilters.js";
import { scanPbfViewportPreview } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2ViewportPreview.js";
import { buildVermontTileGrid } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2VermontTiles.js";
import { computePbfV2SourceKey } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2WritePayload.js";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import type { AppEnv } from "../../config/env.js";
import type {
  PbfAssetPreviewFetchResponse,
  PbfAssetPreviewItem,
  PbfAssetPreviewProgress,
  PbfPhotoVisionMode,
} from "../../types/pbfAssetPreview.js";
import { selectPbfAssetPreviewCandidates } from "./pbfAssetPreviewFilters.js";
import { processPbfAssetPreviewSpot } from "./pbfAssetPreviewSpot.js";

const MAX_PREVIEW_SPOTS = 100;

export type PbfAssetPreviewLiveSources = {
  ok: true;
  pbfPath: string;
  resolvedPath: string;
  readable: boolean;
  fileSizeBytes: number | null;
  tileStepDegrees: number;
  totalTiles: number;
  message: string;
};

export type PbfAssetPreviewLiveStreamEvent =
  | {
      type: "meta";
      mode: "live_pbf";
      pbfPath: string;
      totalTiles: number;
      totalSpots: number;
      tileStepDegrees: number;
      startTileIndex: number;
    }
  | {
      type: "tile";
      tileIndex: number;
      totalTiles: number;
      tileId: string;
      visibleInTile: number;
      photoReadyInTile: number;
    }
  | { type: "spot"; index: number; total: number; tileIndex: number; item: PbfAssetPreviewItem }
  | { type: "done"; progress: PbfAssetPreviewProgress; items: PbfAssetPreviewItem[] }
  | { type: "error"; message: string };

function normalizeSelectionName(displayName: string): string {
  return displayName.trim().toLowerCase().replace(/\s+/g, " ");
}

function fullRunQualitySettings() {
  return {
    ...DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
    hideUnnamedPaths: false,
  };
}

export async function getPbfAssetPreviewLiveSources(input?: {
  pbfPath?: string | null;
  tileStepDegrees?: number;
}): Promise<PbfAssetPreviewLiveSources> {
  const tileStepDegrees = input?.tileStepDegrees ?? 0.4;
  const pbfPath = input?.pbfPath?.trim() || DEFAULT_VERMONT_PBF_PATH;
  const validation = await validatePbfFile(pbfPath);
  const tiles = buildVermontTileGrid(tileStepDegrees);
  const readable = Boolean(validation.exists && validation.readable);
  const message = readable
    ? `Vermont PBF ready — ${tiles.length} tiles at ${tileStepDegrees}° step. Scan + photo preview runs live (no saved run).`
    : `PBF not readable at ${validation.resolvedPath}. Place vermont-latest.osm.pbf in data/osm/.`;

  return {
    ok: true,
    pbfPath,
    resolvedPath: validation.resolvedPath,
    readable,
    fileSizeBytes: validation.fileSizeBytes ?? null,
    tileStepDegrees,
    totalTiles: tiles.length,
    message,
  };
}

function buildLiveProgress(input: {
  maxSpots: number;
  items: PbfAssetPreviewItem[];
  started: number;
  tilesScanned: number;
  spotsEligible: number;
  photoQueryReady: number;
  spotsSkipped: number;
  photoLookupsCompleted: number;
  photoLookupsFailed: number;
  lowConfidenceCount: number;
  geminiJudged: number;
  geminiRejected: number;
  geminiEnabled: boolean;
  lookupDurations: number[];
}): PbfAssetPreviewProgress {
  return {
    spotsLoaded: input.items.length,
    spotsEligible: input.spotsEligible,
    photoQueryReady: input.photoQueryReady,
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

export async function streamPbfAssetPreviewFromLivePbf(
  params: {
    env: AppEnv;
    pbfPath?: string | null;
    maxSpots?: number;
    tileStepDegrees?: number;
    startTileIndex?: number;
    geminiApiKey?: string | null;
    visionMode?: PbfPhotoVisionMode;
    strictTitleSourceMatch?: boolean;
    shouldAbort?: () => boolean;
  },
  onEvent: (event: PbfAssetPreviewLiveStreamEvent) => void,
): Promise<PbfAssetPreviewFetchResponse> {
  const started = Date.now();
  const sources = await getPbfAssetPreviewLiveSources({
    pbfPath: params.pbfPath,
    tileStepDegrees: params.tileStepDegrees,
  });
  if (!sources.readable) {
    throw new Error(sources.message);
  }

  const maxSpots = Math.max(1, Math.min(params.maxSpots ?? 10, MAX_PREVIEW_SPOTS));
  const tileStepDegrees = params.tileStepDegrees ?? 0.4;
  const startTileIndex = Math.max(0, params.startTileIndex ?? 0);
  const tiles = buildVermontTileGrid(tileStepDegrees);

  onEvent({
    type: "meta",
    mode: "live_pbf",
    pbfPath: sources.resolvedPath,
    totalTiles: tiles.length,
    totalSpots: maxSpots,
    tileStepDegrees,
    startTileIndex,
  });

  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();
  const items: PbfAssetPreviewItem[] = [];
  const lookupDurations: number[] = [];
  let spotsEligible = 0;
  let photoQueryReady = 0;
  let spotsSkipped = 0;
  let photoLookupsCompleted = 0;
  let photoLookupsFailed = 0;
  let lowConfidenceCount = 0;
  let geminiJudged = 0;
  let geminiRejected = 0;
  let geminiEnabled = false;
  let tilesScanned = 0;

  for (let tileIdx = startTileIndex; tileIdx < tiles.length && items.length < maxSpots; tileIdx += 1) {
    if (params.shouldAbort?.()) break;

    const tile = tiles[tileIdx]!;
    const scan = await scanPbfViewportPreview({
      pbfPath: sources.resolvedPath,
      bbox: tile,
      mode: "raw_osm",
    });
    if (params.shouldAbort?.()) break;

    const filtered = runPbfCopierV2Pipeline({
      rawItems: scan.items,
      qualitySettings: fullRunQualitySettings(),
    });
    const visible = filtered.items.filter((doc) => !doc.filteredOut);
    tilesScanned += 1;

    const selection = selectPbfAssetPreviewCandidates(visible, Math.max(maxSpots - items.length, 1));
    spotsEligible += selection.eligibleCount;
    photoQueryReady += selection.photoQueryReadyCount;

    onEvent({
      type: "tile",
      tileIndex: tileIdx,
      totalTiles: tiles.length,
      tileId: tile.tileId,
      visibleInTile: visible.length,
      photoReadyInTile: selection.photoQueryReadyCount,
    });

    const tileCandidates: PbfCopierPreviewDoc[] = [];
    for (const doc of selection.selected) {
      const key = computePbfV2SourceKey(doc);
      const nameKey = normalizeSelectionName(doc.displayName);
      if (!key || seenKeys.has(key) || seenNames.has(nameKey)) continue;
      seenKeys.add(key);
      seenNames.add(nameKey);
      tileCandidates.push(doc);
      if (tileCandidates.length + items.length >= maxSpots) break;
    }

    for (const doc of tileCandidates) {
      if (params.shouldAbort?.()) break;

      const { item, stats } = await processPbfAssetPreviewSpot(doc, {
        env: params.env,
        geminiApiKey: params.geminiApiKey,
        visionMode: params.visionMode ?? "off",
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

      items.push(item);
      onEvent({
        type: "spot",
        index: items.length,
        total: maxSpots,
        tileIndex: tileIdx,
        item,
      });

      if (items.length >= maxSpots) break;
    }
  }

  if (items.length === 0) {
    throw new Error(
      `Scanned ${tilesScanned} tile(s) from Vermont PBF but found no photo-query-ready spots. ` +
        "Try a lower start tile index or confirm the PBF file has Vermont data.",
    );
  }

  const progress = buildLiveProgress({
    maxSpots,
    items,
    started,
    tilesScanned,
    spotsEligible,
    photoQueryReady,
    spotsSkipped,
    photoLookupsCompleted,
    photoLookupsFailed,
    lowConfidenceCount,
    geminiJudged,
    geminiRejected,
    geminiEnabled,
    lookupDurations,
  });

  onEvent({ type: "done", progress, items });

  return {
    ok: true,
    runId: "live_pbf",
    chunkId: null,
    mode: "live_pbf",
    progress,
    items,
  };
}
