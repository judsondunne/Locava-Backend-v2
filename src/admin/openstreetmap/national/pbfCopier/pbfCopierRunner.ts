import fs from "node:fs/promises";
import path from "node:path";
import { classifyOpenStreetMapFeaturesForInventory } from "../../openstreetmap.service.js";
import type { ChunkClassificationResult } from "../../openstreetmap.service.js";
import {
  evaluateHillPeakSpatialGate,
  createHillPeakTrailSpatialIndex,
  hillOrPeakHasOnTagTrailContext,
  isOsmBareHillOrPeakTags,
  isOsmHikingTrailTags,
  isOsmViewpointTags,
  registerHikingTrailOnSpatialIndex,
  registerViewpointOnSpatialIndex,
  type HillPeakTrailSpatialIndex,
} from "../../../../lib/inventory/inventoryHillPeakGate.js";
import {
  evaluateNameInference,
  getSupportingDestinationTags,
  inferSafeBeachCategoryFromName,
  isGeographicBeachName,
} from "../../../../lib/inventory/inventoryNameInference.js";
import type {
  LocavaInventoryRoute,
  LocavaInventorySpot,
  LocavaRejectedItem,
  LocavaRouteKind,
} from "../../../../lib/inventory/inventoryLocavaTypes.js";
import { dedupeLocavaInventory } from "../../../../lib/inventory/inventoryLocavaDedupe.js";
import {
  parseOverpassElement,
  type OsmFeatureListItem,
  type OverpassElement,
} from "../../../../lib/openstreetmap/osmFeatureParse.js";
import {
  adaptPbfEntityToOverpassElement,
  isPbfEntitySupportedForCopier,
  type PbfAdapterMetadata,
  type PbfRawEntity,
} from "../../../../lib/openstreetmap/pbf/pbfElementAdapter.js";
import {
  buildPbfAdapterMetadata,
  defaultPbfFeatureReaderFactory,
  type PbfFeatureReader,
  type PbfFeatureReaderFactory,
} from "../../../../lib/openstreetmap/pbf/pbfFeatureReader.js";
import {
  createPbfTagFilter,
  resolvePbfTagFilterPolicy,
  type PbfTagFilter,
} from "../../../../lib/openstreetmap/pbf/pbfTagFilter.js";
import { buildUnexploredDocsFromClassification } from "../osmNationalDocBuilder.js";
import {
  bulkWriteUnexploredSpots,
} from "../../../../repositories/source-of-truth/unexplored-spots-firestore.adapter.js";
import {
  bulkWriteUnexploredRoutes,
} from "../../../../repositories/source-of-truth/unexplored-routes-firestore.adapter.js";
import type { OsmNationalWriteOptions } from "../../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";
import { findExistingUnexploredIds } from "../copier/osmNationalCopierExistsBatch.js";
import {
  validateUnexploredRouteForCopier,
  validateUnexploredSpotForCopier,
} from "../copier/osmNationalCopierRunner.js";
import type {
  UnexploredRoute,
  UnexploredSpot,
} from "../../../../contracts/entities/osm-national-entities.contract.js";
import {
  appendPbfEvent,
  getPbfRun,
  pbfBuildEventId,
  putPbfRun,
  rememberPbfDryRunProof,
} from "./pbfCopierProgressStore.js";
import {
  assertPbfCopierCollectionTarget,
  buildPbfDryRunProofToken,
} from "./pbfCopierGuards.js";
import { computeScanQualityAssessment } from "./pbfCopierScanQuality.js";
import {
  canCollectRoutePreview,
  canCollectSpotPreview,
  emptyBalancedPreviewState,
  shouldStopDryRunScan,
  type BalancedPreviewState,
} from "./pbfCopierBalancedPreview.js";
import {
  emptyQuotaProgress,
  isQuotaMode,
  quotaProgressSummary,
  recordRouteForQuotas,
  recordSpotForQuotas,
} from "./pbfCopierDryRunQuotas.js";
import { enrichPreviewQualityDiagnostics, finalizePreviewDocsQuality } from "./pbfCopierPreviewQuality.js";
import {
  isGeoFilterExhaustiveMode,
  osmFeatureWithinGeoFilter,
  previewDocWithinGeoFilter,
} from "./pbfCopierGeoFilter.js";
import {
  extractRouteLineCoordinates,
  resolveRoutePostAnchor,
  routeHasDisplayableGeometry,
} from "./pbfCopierRouteGeometry.js";
import type {
  PbfCopierEvent,
  PbfCopierPhase,
  PbfCopierPreviewDoc,
  PbfCopierRejectedSample,
  PbfCopierRun,
} from "./pbfCopierTypes.js";

// ---------------------------------------------------------------------------
// Hooks (tests override these to avoid touching Firestore or the real parser).
// ---------------------------------------------------------------------------

export type PbfCopierRunnerHooks = {
  readerFactory?: PbfFeatureReaderFactory;
  classify?: typeof classifyOpenStreetMapFeaturesForInventory;
  writeSpots?: typeof bulkWriteUnexploredSpots;
  writeRoutes?: typeof bulkWriteUnexploredRoutes;
  findExisting?: typeof findExistingUnexploredIds;
  now?: () => number;
};

let activeHooks: PbfCopierRunnerHooks = {};

export function setPbfCopierRunnerHooks(hooks: PbfCopierRunnerHooks): void {
  activeHooks = { ...hooks };
}

export function clearPbfCopierRunnerHooks(): void {
  activeHooks = {};
}

function readerFactory(): PbfFeatureReaderFactory {
  return activeHooks.readerFactory ?? defaultPbfFeatureReaderFactory;
}

function classifyFn(): typeof classifyOpenStreetMapFeaturesForInventory {
  return activeHooks.classify ?? classifyOpenStreetMapFeaturesForInventory;
}

function writeSpotsFn(): typeof bulkWriteUnexploredSpots {
  return activeHooks.writeSpots ?? bulkWriteUnexploredSpots;
}

function writeRoutesFn(): typeof bulkWriteUnexploredRoutes {
  return activeHooks.writeRoutes ?? bulkWriteUnexploredRoutes;
}

function findExistingFn(): typeof findExistingUnexploredIds {
  return activeHooks.findExisting ?? findExistingUnexploredIds;
}

function nowMs(): number {
  return activeHooks.now ? activeHooks.now() : Date.now();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REJECTED_REASON_SAMPLE_CAP = 30;
const REJECTED_PREVIEW_SAMPLE_CAP = 5000;
const ACTIVITY_SAMPLE_CAP = 30;
const MISSING_METADATA_SAMPLE_CAP = 25;
const PREVIEW_TAG_SAMPLE_FIELDS = 8;

const balancedPreviewStateByRun = new Map<string, BalancedPreviewState>();
const hillPeakSpatialIndexByRun = new Map<string, HillPeakTrailSpatialIndex>();
const pendingBareHillPeaksByRun = new Map<string, CandidateFeature[]>();

function getHillPeakSpatialIndex(runId: string): HillPeakTrailSpatialIndex {
  let index = hillPeakSpatialIndexByRun.get(runId);
  if (!index) {
    index = createHillPeakTrailSpatialIndex();
    hillPeakSpatialIndexByRun.set(runId, index);
  }
  return index;
}

function getPendingBareHillPeaks(runId: string): CandidateFeature[] {
  let pending = pendingBareHillPeaksByRun.get(runId);
  if (!pending) {
    pending = [];
    pendingBareHillPeaksByRun.set(runId, pending);
  }
  return pending;
}

function clearHillPeakRunState(runId: string): void {
  hillPeakSpatialIndexByRun.delete(runId);
  pendingBareHillPeaksByRun.delete(runId);
}

function recordSpatialHillPeakRejection(input: {
  run: PbfCopierRun;
  candidate: CandidateFeature;
  reason: string;
}): void {
  const { run, candidate, reason } = input;
  run.metrics.rejectedByClassifier += 1;
  run.rejectionReasonCounts[reason] = (run.rejectionReasonCounts[reason] ?? 0) + 1;
  if (
    run.rejectedReasonSamples.length < REJECTED_REASON_SAMPLE_CAP &&
    !run.rejectedReasonSamples.includes(reason)
  ) {
    run.rejectedReasonSamples.push(reason);
  }
  if (run.rejectedSamples.length < REJECTED_PREVIEW_SAMPLE_CAP) {
    run.rejectedSamples.push({
      sourceKey: candidate.feature.id,
      sourceId: String(candidate.osmId),
      osmType: candidate.osmType,
      osmId: candidate.osmId,
      name: candidate.feature.name || null,
      displayLabel: candidate.feature.name || shortLabelFromTags(candidate.feature.tags),
      rawTypeLabel: candidate.feature.featureType,
      rejectionReason: reason,
      locavaScore: 0,
      lat: candidate.feature.lat,
      lng: candidate.feature.lng,
      topTags: candidate.feature.tags,
      tagSignals: [],
      negativeSignals: [],
      warnings: [],
    });
  } else {
    run.rejectedSamplesTruncated = true;
  }
}

function ensureRouteTrailDiagnostics(run: PbfCopierRun): void {
  if (!run.routeTrailDiagnostics) {
    run.routeTrailDiagnostics = {
      wayCandidatesFound: 0,
      relationCandidatesFound: 0,
      trailCandidates: 0,
      offroadCandidates: 0,
      acceptedRoutes: 0,
      rejectedRouteReasons: {},
      geometryMissingCount: 0,
      relationGeometryUnsupportedCount: 0,
      rawRouteCandidatesSeen: 0,
      trailAssemblyRoutesBuilt: 0,
      builtPublicRouteDocsCount: 0,
      routeMapReadinessCounts: {},
      routesSkippedMissingGeometry: 0,
      acceptedRoutePreviewCount: 0,
      sampleAcceptedRoutes: [],
      sampleRejectedRoutes: [],
    };
  }
}

function isRawRouteCandidateTags(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  const highway = tags.highway?.toLowerCase();
  const route = tags.route?.toLowerCase();
  if (route && ["hiking", "foot", "walking", "bicycle", "mtb", "running"].includes(route)) return true;
  if (highway && ["path", "footway", "cycleway", "bridleway", "track", "steps"].includes(highway)) return true;
  if (tags.sac_scale || tags.trail_visibility) return true;
  return false;
}

function getBalancedPreviewState(runId: string): BalancedPreviewState {
  let state = balancedPreviewStateByRun.get(runId);
  if (!state) {
    state = emptyBalancedPreviewState();
    balancedPreviewStateByRun.set(runId, state);
  }
  return state;
}

function ensureDryRunQuotaProgress(run: PbfCopierRun): Record<string, number> {
  if (!run.dryRunQuotaProgress) {
    run.dryRunQuotaProgress = emptyQuotaProgress(run.config.dryRunQuotas ?? {});
  }
  return run.dryRunQuotaProgress;
}

function shouldStopDryRunScanNow(run: PbfCopierRun, previewState: BalancedPreviewState, fileEnded = false): boolean {
  return shouldStopDryRunScan(run, previewState, fileEnded, ensureDryRunQuotaProgress(run));
}

function clearBalancedPreviewState(runId: string): void {
  balancedPreviewStateByRun.delete(runId);
  clearHillPeakRunState(runId);
}

function attachNameInferenceFields(input: {
  doc: PbfCopierPreviewDoc;
  tags: Record<string, unknown> | undefined;
  displayName: string;
}): PbfCopierPreviewDoc {
  const tagRecord: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.tags ?? {})) {
    if (v != null) tagRecord[k] = String(v);
  }
  const nameEval = evaluateNameInference(tagRecord, input.displayName);
  const explicitTagCategory = getSupportingDestinationTags(tagRecord)[0] ?? null;
  return {
    ...input.doc,
    explicitTagCategory,
    nameInferenceUsed: nameEval.nameInferenceUsed,
    nameInferenceReason: nameEval.nameInferenceReason,
    nameInferenceBlockedReason: nameEval.nameInferenceBlockedReason,
    supportingTags: nameEval.supportingTags,
    disqualifyingTags: nameEval.disqualifyingTags,
  };
}

function trimTags(tags: Record<string, unknown> | undefined): Record<string, string> {
  if (!tags) return {};
  const out: Record<string, string> = {};
  let i = 0;
  for (const [k, v] of Object.entries(tags)) {
    if (i >= PREVIEW_TAG_SAMPLE_FIELDS) break;
    out[k] = typeof v === "string" ? v : JSON.stringify(v).slice(0, 80);
    i += 1;
  }
  return out;
}

function logEvent(input: {
  runId: string;
  phase: PbfCopierPhase;
  level?: PbfCopierEvent["level"];
  message: string;
  counts?: Record<string, number>;
}): void {
  const event: PbfCopierEvent = {
    eventId: pbfBuildEventId(),
    runId: input.runId,
    createdAt: new Date().toISOString(),
    level: input.level ?? "info",
    message: input.message,
    phase: input.phase,
    counts: input.counts,
  };
  appendPbfEvent(event);
}

function shortLabelFromTags(tags: Record<string, string> | undefined): string {
  if (!tags) return "";
  const name = tags.name ?? tags["name:en"];
  if (name) return name.slice(0, 60);
  const orderedKeys = ["amenity", "natural", "leisure", "tourism", "historic", "highway", "route", "sport", "waterway"];
  for (const key of orderedKeys) {
    if (tags[key]) return `${key}=${tags[key]}`.slice(0, 60);
  }
  const first = Object.entries(tags).find(([key]) => !key.startsWith("source"));
  return first ? `${first[0]}=${first[1]}`.slice(0, 60) : "";
}

function parseOsmTypeFromSourceKey(sourceKey: string): "node" | "way" | "relation" {
  const prefix = sourceKey.split("/")[0];
  if (prefix === "way" || prefix === "relation" || prefix === "node") return prefix;
  return "node";
}

function buildRejectedSample(
  rejected: LocavaRejectedItem,
  sourceIndex: Map<string, { osmType: "node" | "way" | "relation"; osmId: number }>
): PbfCopierRejectedSample {
  const indexed = sourceIndex.get(rejected.sourceKey);
  const osmType = indexed?.osmType ?? parseOsmTypeFromSourceKey(rejected.sourceKey);
  const osmId = indexed?.osmId ?? (Number.parseInt(rejected.sourceId, 10) || 0);
  const displayLabel =
    rejected.name?.trim()
    || shortLabelFromTags(rejected.topTags)
    || rejected.rawTypeLabel
    || rejected.sourceKey;
  return {
    sourceKey: rejected.sourceKey,
    sourceId: rejected.sourceId,
    osmType,
    osmId,
    name: rejected.name,
    displayLabel,
    rawTypeLabel: rejected.rawTypeLabel,
    rejectionReason: rejected.rejectionReason || "below_threshold",
    locavaScore: rejected.locavaScore,
    lat: rejected.lat ?? null,
    lng: rejected.lng ?? null,
    topTags: rejected.topTags ?? {},
    tagSignals: rejected.tagSignals ?? [],
    negativeSignals: rejected.negativeSignals ?? [],
    warnings: rejected.warnings ?? [],
  };
}

function recordClassifierRejections(input: {
  run: PbfCopierRun;
  rejected: LocavaRejectedItem[];
  sourceIndex: Map<string, { osmType: "node" | "way" | "relation"; osmId: number }>;
}): void {
  const { run, rejected, sourceIndex } = input;
  for (const item of rejected) {
    const reason = item.rejectionReason || "below_threshold";
    run.rejectionReasonCounts[reason] = (run.rejectionReasonCounts[reason] ?? 0) + 1;
    if (
      run.rejectedReasonSamples.length < REJECTED_REASON_SAMPLE_CAP &&
      !run.rejectedReasonSamples.includes(reason)
    ) {
      run.rejectedReasonSamples.push(reason);
    }
    if (run.rejectedSamples.length < REJECTED_PREVIEW_SAMPLE_CAP) {
      run.rejectedSamples.push(buildRejectedSample(item, sourceIndex));
    } else {
      run.rejectedSamplesTruncated = true;
    }
  }
}

export function buildSpotPreviewDoc(input: {
  spot: UnexploredSpot;
  source: { osmType: "node" | "way" | "relation"; osmId: number };
  pbfFilePath: string;
  sourceProvider: string;
}): PbfCopierPreviewDoc {
  const warnings: string[] = [];
  if (!input.spot.activities?.length) warnings.push("missing_activity");
  if (!input.spot.displayName?.trim()) warnings.push("missing_display_name");
  if (!input.spot.category?.trim()) warnings.push("missing_category");
  const base: PbfCopierPreviewDoc = {
    id: input.spot.id,
    kind: "unexplored_spot",
    collection: "unexploredSpots",
    displayName: input.spot.displayName,
    primaryActivity: input.spot.primaryActivity ?? null,
    activities: input.spot.activities ?? [],
    primaryCategory: input.spot.category,
    lat: input.spot.lat,
    lng: input.spot.lng,
    sourceFamily: input.spot.sourceFamily,
    sourceKeys: input.spot.sourceKeys,
    sourceIds: input.spot.sourceIds,
    osmType: input.source.osmType,
    osmId: input.source.osmId,
    origin: "generated_osm",
    mapReadiness: input.spot.mapReadiness,
    publicMapEligible: input.spot.publicMapEligible,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: input.spot.import.runId,
    importPipelineVersion: input.spot.import.pipelineVersion,
    pbfFilePath: input.pbfFilePath,
    sourceProvider: input.sourceProvider,
    sourceTagSample: trimTags(input.spot.sourceTags as Record<string, unknown>),
    writePayload: input.spot as unknown as Record<string, unknown>,
    warnings,
  };
  return attachNameInferenceFields({
    doc: base,
    tags: input.spot.sourceTags as Record<string, unknown>,
    displayName: input.spot.displayName,
  });
}

export function buildRoutePreviewDoc(input: {
  route: UnexploredRoute;
  source: { osmType: "node" | "way" | "relation"; osmId: number };
  pbfFilePath: string;
  sourceProvider: string;
  allowMissingLineGeometry?: boolean;
}): PbfCopierPreviewDoc | null {
  const warnings: string[] = [];
  if (!input.route.activities?.length) warnings.push("missing_activity");
  if (!input.route.displayName?.trim()) warnings.push("missing_display_name");
  if (!input.route.center) warnings.push("missing_center");
  const routeLineCoordinates = extractRouteLineCoordinates(input.route);
  const hasRouteGeometry = routeLineCoordinates.length >= 2;
  if (!hasRouteGeometry) warnings.push("route_missing_geometry");
  if (!hasRouteGeometry && !input.allowMissingLineGeometry) return null;
  const postAnchor = resolveRoutePostAnchor(input.route, routeLineCoordinates);

  const base: PbfCopierPreviewDoc = {
    id: input.route.id,
    kind: "unexplored_route",
    collection: "unexploredRoutes",
    displayName: input.route.displayName,
    primaryActivity: input.route.primaryActivity ?? null,
    activities: input.route.activities ?? [],
    primaryCategory:
      input.route.primaryActivity ?? input.route.categories?.[0] ?? "route",
    lat: postAnchor.lat,
    lng: postAnchor.lng,
    center: postAnchor,
    sourceFamily: input.route.sourceFamily,
    sourceKeys: input.route.sourceKeys,
    sourceIds: input.route.sourceIds,
    osmType: input.source.osmType,
    osmId: input.source.osmId,
    origin: "generated_osm",
    mapReadiness: input.route.mapReadiness,
    publicMapEligible: input.route.publicMapEligible,
    undiscovered: true,
    needsCapture: true,
    hasUserMedia: false,
    importRunId: input.route.import.runId,
    importPipelineVersion: input.route.import.pipelineVersion,
    pbfFilePath: input.pbfFilePath,
    sourceProvider: input.sourceProvider,
    sourceTagSample: trimTags(input.route.sourceTags as Record<string, unknown>),
    writePayload: input.route as unknown as Record<string, unknown>,
    warnings,
    encodedPolyline: input.route.encodedPolyline ?? input.route.geometry?.encodedPolyline,
    routeLineCoordinates,
    geometryType: input.route.geometryType,
    distanceMiles: input.route.distanceMiles,
    distanceMeters: input.route.distanceMeters,
    geometryPointCount: input.route.geometry?.pointCount ?? routeLineCoordinates.length,
    hasRouteGeometry,
    bbox: input.route.bbox,
  };
  return attachNameInferenceFields({
    doc: base,
    tags: input.route.sourceTags as Record<string, unknown>,
    displayName: input.route.displayName,
  });
}

// ---------------------------------------------------------------------------
// File validation
// ---------------------------------------------------------------------------

export type PbfFileValidationResult = {
  exists: boolean;
  readable: boolean;
  isPbfExtension: boolean;
  fileSizeBytes: number;
  resolvedPath: string;
  warnings: string[];
};

export async function validatePbfFile(filePath: string): Promise<PbfFileValidationResult> {
  const warnings: string[] = [];
  const resolvedPath = path.resolve(filePath);
  let exists = false;
  let readable = false;
  let fileSizeBytes = 0;
  let isPbfExtension = resolvedPath.toLowerCase().endsWith(".osm.pbf") || resolvedPath.toLowerCase().endsWith(".pbf");
  if (!isPbfExtension) warnings.push("file_extension_is_not_pbf");
  try {
    const stat = await fs.stat(resolvedPath);
    exists = true;
    fileSizeBytes = stat.size;
    if (!stat.isFile()) warnings.push("path_is_not_a_file");
  } catch (error) {
    warnings.push(`stat_failed:${error instanceof Error ? error.message : String(error)}`);
  }
  if (exists) {
    try {
      await fs.access(resolvedPath, fs.constants.R_OK);
      readable = true;
    } catch (error) {
      warnings.push(`not_readable:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { exists, readable, isPbfExtension, fileSizeBytes, resolvedPath, warnings };
}

// ---------------------------------------------------------------------------
// Streaming pipeline
// ---------------------------------------------------------------------------

type CandidateFeature = {
  feature: OsmFeatureListItem;
  osmType: "node" | "way" | "relation";
  osmId: number;
  element?: OverpassElement;
};

async function processCandidateBatch(input: {
  candidates: CandidateFeature[];
  run: PbfCopierRun;
  startMs: number;
  metadata: PbfAdapterMetadata;
}): Promise<{
  spots: UnexploredSpot[];
  routes: UnexploredRoute[];
  inventoryRoutes: LocavaInventoryRoute[];
  classification: ChunkClassificationResult;
  invalidCount: number;
  warnings: string[];
  spotSourceMap: Map<string, { osmType: "node" | "way" | "relation"; osmId: number }>;
  routeSourceMap: Map<string, { osmType: "node" | "way" | "relation"; osmId: number }>;
}> {
  const { candidates, run, metadata } = input;

  // Synthetic bbox is the convex hull of the candidate features. It does
  // not influence the classifier; it's only used to satisfy the
  // ChunkClassificationResult shape.
  let minLat = 90;
  let minLng = 180;
  let maxLat = -90;
  let maxLng = -180;
  for (const candidate of candidates) {
    minLat = Math.min(minLat, candidate.feature.lat);
    maxLat = Math.max(maxLat, candidate.feature.lat);
    minLng = Math.min(minLng, candidate.feature.lng);
    maxLng = Math.max(maxLng, candidate.feature.lng);
  }
  if (candidates.length === 0) {
    minLat = 0;
    maxLat = 0;
    minLng = 0;
    maxLng = 0;
  }
  const bbox = { minLat, minLng, maxLat, maxLng };

  run.phase = "running_locava_classifier";
  putPbfRun(run);

  const tClassifyStart = nowMs();
  const elementsById = new Map<string, OverpassElement>();
  for (const candidate of candidates) {
    if (candidate.element) {
      elementsById.set(`${candidate.osmType}/${candidate.osmId}`, candidate.element);
    }
  }
  const classification = await classifyFn()({
    bbox,
    stateCode: run.config.stateCode,
    runId: run.runId,
    source: "fixture",
    rawFeatures: candidates.map((c) => c.feature),
    elementsById,
    includeOsmSpots: run.config.includeSpots,
    includeOsmRoutes: run.config.includeRoutes,
    includeOsmOffroad: run.config.includeRoutes,
    offroadSource: "osm",
    useLiveVtrans: false,
    useLiveNhdot: false,
    includeClass4: false,
    includeLegalTrails: false,
    includeClass6: false,
  });
  const classifyMs = nowMs() - tClassifyStart;

  const classifierSpotCount = run.config.includeSpots
    ? (classification.acceptedSpots as LocavaInventorySpot[]).length
    : 0;
  const classifierRouteCount = run.config.includeRoutes
    ? (classification.acceptedRoutes as LocavaInventoryRoute[]).length
    : 0;
  run.metrics.classifierAcceptedSpots += classifierSpotCount;
  run.metrics.classifierAcceptedRoutes += classifierRouteCount;

  ensureRouteTrailDiagnostics(run);
  const trailDiag = classification.diagnostics?.trailDiagnostics as Record<string, unknown> | undefined;
  if (trailDiag) {
    const built =
      Number(trailDiag.fullTrailsAssembled ?? 0) +
      Number(trailDiag.relationTrails ?? 0) +
      Number(trailDiag.namedWayGroupTrails ?? 0) +
      Number(trailDiag.singleWaySegments ?? 0);
    run.routeTrailDiagnostics.trailAssemblyRoutesBuilt += built;
  }
  for (const item of classification.rejected) {
    if ((item.sourceType === "way" || item.sourceType === "relation") && isRawRouteCandidateTags(item.topTags)) {
      if (run.routeTrailDiagnostics.sampleRejectedRoutes.length < 25) {
        run.routeTrailDiagnostics.sampleRejectedRoutes.push({
          name: item.name ?? "(unnamed)",
          reason: item.rejectionReason ?? "below_threshold",
          tags: item.topTags ?? {},
        });
      }
    }
  }

  // Index candidates so each accepted spot/route can find its original PBF
  // type+id for preview-doc source metadata.
  const sourceKeyIndex = new Map<string, { osmType: "node" | "way" | "relation"; osmId: number }>();
  for (const candidate of candidates) {
    sourceKeyIndex.set(candidate.feature.id, {
      osmType: candidate.osmType,
      osmId: candidate.osmId,
    });
  }

  // Dedupe routes the same way the bbox/copier path does.
  const dedupedRoutes = dedupeLocavaInventory({
    spots: [],
    routes: classification.acceptedRoutes as LocavaInventoryRoute[],
  });

  ensureRouteTrailDiagnostics(run);
  for (const route of dedupedRoutes.routes) {
    const readiness = route.mapReadiness ?? "unknown";
    run.routeTrailDiagnostics.routeMapReadinessCounts[readiness] =
      (run.routeTrailDiagnostics.routeMapReadinessCounts[readiness] ?? 0) + 1;
  }

  run.phase = "building_unexplored_docs";
  putPbfRun(run);
  const tBuildStart = nowMs();
  const { spots, routes } = buildUnexploredDocsFromClassification({
    spots: run.config.includeSpots ? (classification.acceptedSpots as LocavaInventorySpot[]) : [],
    routes: dedupedRoutes.routes,
    stateCode: run.config.stateCode,
    runId: run.runId,
    chunkId: `pbf_${path.basename(metadata.pbfFilePath)}`,
    writeMode: run.writeMode,
    writeTarget: run.writeTarget,
    includePublicOnly: run.config.includePublicOnly,
    includeReviewItems: run.config.includeReviewDocs,
    includeOsmSpots: run.config.includeSpots,
    includeOsmRoutes: run.config.includeRoutes,
    includeOffroad: run.config.includeRoutes,
  });
  const buildMs = nowMs() - tBuildStart;

  run.metrics.docBuilderFilteredPublicOnly += Math.max(
    0,
    classifierSpotCount - spots.length + (classifierRouteCount - routes.length)
  );
  run.routeTrailDiagnostics.builtPublicRouteDocsCount += routes.length;

  // Validation — refuse to forward invalid docs (matches existing copier).
  run.phase = "validating_docs";
  putPbfRun(run);
  const validSpots: UnexploredSpot[] = [];
  const validRoutes: UnexploredRoute[] = [];
  const warnings: string[] = [];
  let invalidCount = 0;

  for (const spot of spots) {
    const reasons = validateUnexploredSpotForCopier(spot);
    if (reasons.length === 0) {
      validSpots.push(spot);
    } else {
      invalidCount += 1;
      warnings.push(`invalid_spot:${spot.id}:${reasons.join(",")}`);
      if (reasons.includes("missing_coordinates")) {
        run.metrics.skippedMissingCoordinates += 1;
      }
      if (reasons.includes("missing_activity")) {
        run.metrics.skippedMissingActivities += 1;
      }
    }
  }
  for (const route of routes) {
    const reasons = validateUnexploredRouteForCopier(route);
    if (reasons.length === 0) {
      validRoutes.push(route);
    } else {
      invalidCount += 1;
      warnings.push(`invalid_route:${route.id}:${reasons.join(",")}`);
      if (reasons.includes("missing_center")) {
        run.metrics.skippedMissingCoordinates += 1;
      }
      if (reasons.includes("missing_activity")) {
        run.metrics.skippedMissingActivities += 1;
      }
    }
  }

  run.metrics.docBuilderInvalid += invalidCount;

  // Map each accepted doc back to its OSM source (node/way/relation + id).
  const spotSourceMap = new Map<string, { osmType: "node" | "way" | "relation"; osmId: number }>();
  for (const spot of validSpots) {
    for (const sourceKey of spot.sourceKeys ?? []) {
      const found = sourceKeyIndex.get(sourceKey);
      if (found) {
        spotSourceMap.set(spot.id, found);
        break;
      }
    }
  }
  const routeSourceMap = new Map<string, { osmType: "node" | "way" | "relation"; osmId: number }>();
  for (const route of validRoutes) {
    for (const sourceKey of route.sourceKeys ?? []) {
      const found = sourceKeyIndex.get(sourceKey);
      if (found) {
        routeSourceMap.set(route.id, found);
        break;
      }
    }
  }

  // Record timing on the run metrics for visibility.
  run.metrics.estimatedRemainingMs = run.metrics.estimatedRemainingMs ?? null;
  void classifyMs;
  void buildMs;

  return {
    spots: validSpots,
    routes: validRoutes,
    inventoryRoutes: dedupedRoutes.routes,
    classification,
    invalidCount,
    warnings,
    spotSourceMap,
    routeSourceMap,
  };
}

async function maybeFlushWrites(input: {
  run: PbfCopierRun;
  spots: UnexploredSpot[];
  routes: UnexploredRoute[];
}): Promise<{ writtenSpots: number; writtenRoutes: number }> {
  const { run } = input;
  if (!run.writeMode || run.writeTarget === "none") {
    return { writtenSpots: 0, writtenRoutes: 0 };
  }

  assertPbfCopierCollectionTarget("unexploredSpots");
  assertPbfCopierCollectionTarget("unexploredRoutes");

  let spotsToWrite = input.spots;
  let routesToWrite = input.routes;

  if (run.config.skipExisting) {
    run.phase = "checking_existing_ids";
    putPbfRun(run);
    const spotIds = spotsToWrite.map((s) => s.id);
    const routeIds = routesToWrite.map((r) => r.id);
    const existingSpots = await findExistingFn()("unexploredSpots", spotIds);
    const existingRoutes = await findExistingFn()("unexploredRoutes", routeIds);
    run.metrics.estimatedReads += spotIds.length + routeIds.length;
    if (existingSpots.size > 0) {
      run.metrics.skippedExisting += existingSpots.size;
      spotsToWrite = spotsToWrite.filter((s) => !existingSpots.has(s.id));
    }
    if (existingRoutes.size > 0) {
      run.metrics.skippedExisting += existingRoutes.size;
      routesToWrite = routesToWrite.filter((r) => !existingRoutes.has(r.id));
    }
  }

  if (
    run.config.maxDocsToWrite != null &&
    run.metrics.docsWritten + spotsToWrite.length + routesToWrite.length >
      run.config.maxDocsToWrite
  ) {
    const remaining = Math.max(0, run.config.maxDocsToWrite - run.metrics.docsWritten);
    if (remaining <= 0) return { writtenSpots: 0, writtenRoutes: 0 };
    if (spotsToWrite.length > remaining) {
      spotsToWrite = spotsToWrite.slice(0, remaining);
      routesToWrite = [];
    } else {
      const remainingRoutes = remaining - spotsToWrite.length;
      routesToWrite = routesToWrite.slice(0, Math.max(0, remainingRoutes));
    }
  }

  run.phase = "writing_batch";
  putPbfRun(run);
  run.metrics.estimatedWrites += spotsToWrite.length + routesToWrite.length;
  run.metrics.writerCalls += (spotsToWrite.length > 0 ? 1 : 0) + (routesToWrite.length > 0 ? 1 : 0);

  const writeOptions: OsmNationalWriteOptions = {
    writeTarget: run.writeTarget,
    operation: "osm_pbf_copier.write",
    confirmProductionWrite: run.confirmProductionWrite,
  };

  let writtenSpots = 0;
  let writtenRoutes = 0;
  if (spotsToWrite.length > 0) {
    writtenSpots = await writeSpotsFn()(spotsToWrite, writeOptions);
  }
  if (routesToWrite.length > 0) {
    writtenRoutes = await writeRoutesFn()(routesToWrite, writeOptions);
  }
  run.metrics.docsWritten += writtenSpots + writtenRoutes;
  run.metrics.batchesWritten += 1;

  logEvent({
    runId: run.runId,
    phase: "writing_batch",
    message: `Wrote ${writtenSpots} spots, ${writtenRoutes} routes (target=${run.writeTarget}).`,
    counts: { writtenSpots, writtenRoutes },
  });

  return { writtenSpots, writtenRoutes };
}

function updateRateMetrics(run: PbfCopierRun, startMs: number): void {
  const elapsedMs = Math.max(0, nowMs() - startMs);
  run.metrics.elapsedMs = elapsedMs;
  const elapsedSec = elapsedMs / 1000;
  if (elapsedSec > 0) {
    run.metrics.rawObjectsPerSecond = Math.round(run.metrics.rawObjectsScanned / elapsedSec);
    run.metrics.candidatesPerSecond = Math.round(run.metrics.candidatesSentToClassifier / elapsedSec);
    run.metrics.acceptedDocsPerSecond = Math.round(run.metrics.docsPreviewed / elapsedSec);
  }
  if (
    run.metrics.fileBytesTotal > 0 &&
    run.metrics.fileBytesRead > 0 &&
    run.metrics.fileBytesRead < run.metrics.fileBytesTotal
  ) {
    const rate = run.metrics.fileBytesRead / Math.max(1, elapsedMs);
    const remainingBytes = run.metrics.fileBytesTotal - run.metrics.fileBytesRead;
    run.metrics.estimatedRemainingMs = Math.round(remainingBytes / Math.max(rate, 1));
  } else if (
    run.config.maxRawObjectsToScan != null &&
    run.metrics.nodesScanned > 0 &&
    run.metrics.nodesScanned <= run.config.maxRawObjectsToScan &&
    run.metrics.waysScanned === 0
  ) {
    const rate = run.metrics.nodesScanned / Math.max(1, elapsedMs);
    const remaining = run.config.maxRawObjectsToScan - run.metrics.nodesScanned;
    run.metrics.estimatedRemainingMs = Math.round(remaining / Math.max(rate, 1));
  }
}

// ---------------------------------------------------------------------------
// Public runner entrypoint
// ---------------------------------------------------------------------------

export async function runPbfCopierLoop(runId: string): Promise<PbfCopierRun> {
  let run = getPbfRun(runId);
  if (!run) throw new Error(`pbf_copier_run_not_found:${runId}`);
  if (run.status === "cancelled") return run;
  if (run.status === "paused") {
    run.phase = "paused";
    putPbfRun(run);
    return run;
  }

  const startMs = nowMs();
  run.status = "running";
  run.phase = "validating_file";
  run.startedAt = run.startedAt ?? new Date().toISOString();
  ensureRouteTrailDiagnostics(run);
  putPbfRun(run);
  logEvent({ runId, phase: "validating_file", message: `Validating ${run.config.filePath}.` });

  const validation = await validatePbfFile(run.config.filePath);
  if (!validation.exists || !validation.readable) {
    run.status = "failed";
    run.phase = "failed";
    run.lastError = `pbf_file_not_readable:${validation.warnings.join(";")}`;
    run.finishedAt = new Date().toISOString();
    run.metrics.errors += 1;
    putPbfRun(run);
    logEvent({
      runId,
      phase: "failed",
      level: "error",
      message: `PBF file not readable: ${validation.warnings.join("; ")}`,
    });
    return run;
  }

  run.metrics.fileBytesTotal = validation.fileSizeBytes;

  let reader: PbfFeatureReader | null = null;
  try {
    run.phase = "opening_pbf";
    putPbfRun(run);
    logEvent({ runId, phase: "opening_pbf", message: "Opening PBF parser." });

    reader = await readerFactory()({ filePath: validation.resolvedPath });
    const opened = await reader.open({ filePath: validation.resolvedPath });
    run.parserId = opened.parserId;
    run.parserVersion = opened.parserVersion ?? null;
    run.sourceTimestamp = opened.sourceTimestamp ?? null;
    run.metrics.fileBytesTotal = opened.fileSizeBytes;
    putPbfRun(run);

    const metadata = buildPbfAdapterMetadata({
      filePath: validation.resolvedPath,
      parserVersion: opened.parserVersion,
      sourceTimestamp: opened.sourceTimestamp,
    });
    run.sourceProvider = metadata.sourceProvider;
    putPbfRun(run);

    const tagFilter: PbfTagFilter = createPbfTagFilter(resolvePbfTagFilterPolicy(run.config));

    run.phase = "scanning_raw_osm";
    putPbfRun(run);
    logEvent({
      runId,
      phase: "scanning_raw_osm",
      message: `Scan started (parser=${opened.parserId}, size=${opened.fileSizeBytes} bytes).`,
    });

    const batch: CandidateFeature[] = [];
    let progressLogCounter = 0;
    let lastProgressLogAtMs = nowMs();
    let scanStoppedEarly = false;

    chunkLoop: for await (const chunk of reader.read()) {
      const latest = getPbfRun(runId);
      if (!latest) break;
      run = latest;
      ensureRouteTrailDiagnostics(run);
      if (run.status === "cancelled") break;
      if (run.status === "paused") break;

      if (chunk.bytesRead != null) {
        run.metrics.fileBytesRead = Math.max(run.metrics.fileBytesRead, chunk.bytesRead);
      }

      for (const entity of chunk.entities) {
        run.metrics.rawObjectsScanned += 1;
        if (entity.type === "node") run.metrics.nodesScanned += 1;
        else if (entity.type === "way") run.metrics.waysScanned += 1;
        else if (entity.type === "relation") run.metrics.relationsScanned += 1;

        // Node scan cap: skip candidate processing for excess nodes but keep
        // reading the PBF so ways/relations (trails, parks, routes) are reached.
        const nodeCapExceeded =
          entity.type === "node" &&
          run.config.maxRawObjectsToScan != null &&
          run.metrics.nodesScanned > run.config.maxRawObjectsToScan;
        if (nodeCapExceeded) {
          run.rawScanLimitReached = true;
          continue;
        }

        run.currentActivity = {
          currentObjectType: entity.type,
          currentOsmId: Number(entity.id) || null,
          currentLabel: shortLabelFromTags(entity.tags),
          currentPhaseDetail: `${run.metrics.rawObjectsScanned} raw / ${run.metrics.candidateObjectsFound} candidates`,
        };

        if (!isPbfEntitySupportedForCopier(entity)) continue;
        if (!tagFilter.isCandidate(entity.tags)) {
          run.metrics.tagFilterSkipped += 1;
          continue;
        }

        run.metrics.candidateObjectsFound += 1;
        const previewState = getBalancedPreviewState(runId);
        if (entity.type === "way") {
          run.metrics.wayCandidatesFound += 1;
          previewState.wayCandidatesFound += 1;
          run.routeTrailDiagnostics.wayCandidatesFound = run.metrics.wayCandidatesFound;
          const hw = entity.tags?.highway?.toLowerCase();
          if (hw === "path" || hw === "footway" || hw === "track" || entity.tags?.route === "hiking") {
            run.routeTrailDiagnostics.trailCandidates += 1;
          }
          if (/class\s*(4|6|iv|vi)/i.test(entity.tags?.name ?? "") || entity.tags?.["4wd_only"] === "yes") {
            run.routeTrailDiagnostics.offroadCandidates += 1;
          }
        } else if (entity.type === "relation") {
          run.metrics.relationCandidatesFound += 1;
          previewState.relationCandidatesFound += 1;
          run.routeTrailDiagnostics.relationCandidatesFound = run.metrics.relationCandidatesFound;
        }

        if (entity.type === "way" || entity.type === "relation") {
          if (isRawRouteCandidateTags(entity.tags)) {
            run.routeTrailDiagnostics.rawRouteCandidatesSeen += 1;
          }
        }

        const adapted = adaptPbfEntityToOverpassElement(entity as PbfRawEntity, metadata);
        if (!adapted) {
          run.metrics.adapterSkipped += 1;
          run.metrics.warnings += 1;
          continue;
        }

        const feature = parseOverpassElement(adapted.element);
        if (!feature) {
          // For ways with no geometry we still count, but skip — relations
          // without resolved geometry land here too.
          if (entity.type === "relation") {
            run.metrics.relationsSkippedGeometry += 1;
            run.routeTrailDiagnostics.relationGeometryUnsupportedCount += 1;
          } else {
            run.metrics.skippedInvalid += 1;
            if (entity.type === "way") {
              run.routeTrailDiagnostics.geometryMissingCount += 1;
            }
          }
          continue;
        }

        if (!osmFeatureWithinGeoFilter(feature, run.config)) {
          run.metrics.geoFilterSkippedCandidates += 1;
          continue;
        }

        const spatialIndex = getHillPeakSpatialIndex(runId);
        if (isOsmViewpointTags(feature.tags)) {
          registerViewpointOnSpatialIndex(spatialIndex, feature.lat, feature.lng);
        }
        if (isOsmHikingTrailTags(feature.tags)) {
          registerHikingTrailOnSpatialIndex(spatialIndex, feature);
        }

        const deferBareHillPeak =
          isOsmBareHillOrPeakTags(feature.tags) && !hillOrPeakHasOnTagTrailContext(feature.tags);
        if (deferBareHillPeak) {
          getPendingBareHillPeaks(runId).push({
            feature,
            osmType: adapted.sourceMetadata.osmType,
            osmId: adapted.sourceMetadata.osmId,
          });
          continue;
        }

        batch.push({
          feature,
          osmType: adapted.sourceMetadata.osmType,
          osmId: adapted.sourceMetadata.osmId,
          element: adapted.element,
        });

        if (batch.length >= run.config.classifyBatchSize) {
          await flushBatchIntoRun({ batch, run, startMs, metadata });
          batch.length = 0;
        }

        if (shouldStopDryRunScanNow(run, getBalancedPreviewState(runId))) {
          run.dryRunLimitReached = true;
          if (isQuotaMode(run.config)) {
            logEvent({
              runId,
              phase: run.phase,
              message: `Quota targets reached: ${quotaProgressSummary(run.config.dryRunQuotas, ensureDryRunQuotaProgress(run))}.`,
            });
          }
          scanStoppedEarly = true;
          break chunkLoop;
        }
      }

      progressLogCounter += 1;
      if (progressLogCounter % 5 === 0 || nowMs() - lastProgressLogAtMs > 500) {
        updateRateMetrics(run, startMs);
        putPbfRun(run);
        logEvent({
          runId,
          phase: "scanning_raw_osm",
          message: `Scanned ${run.metrics.rawObjectsScanned} raw / ${run.metrics.candidateObjectsFound} candidate.`,
          counts: {
            rawObjectsScanned: run.metrics.rawObjectsScanned,
            candidateObjectsFound: run.metrics.candidateObjectsFound,
            docsPreviewed: run.metrics.docsPreviewed,
          },
        });
        lastProgressLogAtMs = nowMs();
      }
    }

    if (batch.length > 0) {
      await flushBatchIntoRun({ batch, run, startMs, metadata });
      batch.length = 0;
    }

    const pendingBareHillPeaks = pendingBareHillPeaksByRun.get(runId) ?? [];
    if (pendingBareHillPeaks.length > 0) {
      const spatialIndex = getHillPeakSpatialIndex(runId);
      const hillPeakBatch: CandidateFeature[] = [];
      for (const candidate of pendingBareHillPeaks) {
        const gate = evaluateHillPeakSpatialGate(
          spatialIndex,
          candidate.feature.lat,
          candidate.feature.lng
        );
        if (gate.accept) {
          hillPeakBatch.push({
            ...candidate,
            feature: { ...candidate.feature, nearbyHikingTrail: true },
          });
        }
        else {
          recordSpatialHillPeakRejection({
            run,
            candidate,
            reason: gate.reason,
          });
        }
      }
      pendingBareHillPeaksByRun.delete(runId);
      if (hillPeakBatch.length > 0) {
        await flushBatchIntoRun({ batch: hillPeakBatch, run, startMs, metadata });
      }
      putPbfRun(run);
    }

    const fileEnded = !scanStoppedEarly;
    run.fileEnded = fileEnded;

    // Final state — merge persisted metrics with end-of-scan flags set above.
    const latest = getPbfRun(runId);
    if (!latest) throw new Error(`pbf_copier_run_disappeared:${runId}`);
    run = latest;
    run.fileEnded = fileEnded;

    if (run.status === "cancelled") {
      run.phase = "cancelled";
      run.finishedAt = new Date().toISOString();
      putPbfRun(run);
      return run;
    }
    if (run.status === "paused") {
      run.phase = "paused";
      putPbfRun(run);
      return run;
    }

    run.status = "completed";
    if (run.mode === "dry_run_preview" || run.mode === "fast_dry_run") {
      const finalized = finalizePreviewDocsQuality(run.previewDocs, {
        skipDisplayNameDedupe: isGeoFilterExhaustiveMode(run.config),
      });
      run.previewDocs = finalized.previewDocs;
      run.routeTrailDiagnostics.acceptedRoutePreviewCount = finalized.previewDocs.filter(
        (d) => d.kind === "unexplored_route"
      ).length;
      run.routeTrailDiagnostics.sampleAcceptedRoutes = finalized.previewDocs
        .filter((d) => d.kind === "unexplored_route")
        .slice(0, 10);
      run.previewQuality = enrichPreviewQualityDiagnostics(finalized.diagnostics, {
        maxAcceptedRequested: run.config.dryRunLimit,
        maxAcceptedApplied: run.config.dryRunLimit,
        routeTrailDiagnostics: run.routeTrailDiagnostics,
        rejectedSamples: run.rejectedSamples,
        previewDocs: finalized.previewDocs,
      });
      run.metrics.docsPreviewed = finalized.previewDocs.length;
      run.metrics.acceptedSpots = finalized.previewDocs.filter((d) => d.kind === "unexplored_spot").length;
      run.metrics.acceptedRoutes = finalized.previewDocs.filter((d) => d.kind === "unexplored_route").length;
      run.phase = "dry_run_preview_ready";
      // Stamp a proof token that allows a future write run for the same
      // file/config.
      const token = buildPbfDryRunProofToken({
        filePath: run.config.filePath,
        config: run.config,
      });
      run.dryRunProofToken = token;
      rememberPbfDryRunProof(token, run.runId);
    } else {
      run.phase = "complete";
    }
    run.finishedAt = new Date().toISOString();
    updateRateMetrics(run, startMs);
    run.routeTrailDiagnostics.acceptedRoutes = run.routeTrailDiagnostics.builtPublicRouteDocsCount;
    clearBalancedPreviewState(runId);

    const scanQuality = computeScanQualityAssessment({
      metrics: run.metrics,
      dryRunLimitReached: run.dryRunLimitReached,
      rawScanLimitReached: run.rawScanLimitReached,
      fileEnded: run.fileEnded,
      maxRawObjectsToScan: run.config.maxRawObjectsToScan,
      mode: run.mode,
      maxAcceptedMode: run.config.maxAcceptedMode,
      dryRunLimit: run.config.dryRunLimit,
      dryRunStopMode: run.config.dryRunStopMode,
    });
    run.scanQualityBadgeId = scanQuality.badgeId;
    run.scanQualityBadge = scanQuality.badgeLabel;
    run.scanStopReason = scanQuality.stopReason;
    run.scanWarnings = scanQuality.warnings;
    run.byteProgressUnavailable = scanQuality.byteProgressUnavailable;

    for (const warning of scanQuality.warnings) {
      logEvent({ runId, phase: run.phase, level: "warn", message: warning });
    }

    putPbfRun(run);
    logEvent({
      runId,
      phase: run.phase,
      message: `Run ${run.status} (preview=${run.metrics.docsPreviewed}, accepted=${run.metrics.acceptedSpots + run.metrics.acceptedRoutes}, rejected=${run.metrics.rejectedByClassifier}, errors=${run.metrics.errors}).`,
      counts: {
        rawObjectsScanned: run.metrics.rawObjectsScanned,
        candidateObjectsFound: run.metrics.candidateObjectsFound,
        acceptedSpots: run.metrics.acceptedSpots,
        acceptedRoutes: run.metrics.acceptedRoutes,
        rejectedByClassifier: run.metrics.rejectedByClassifier,
        docsPreviewed: run.metrics.docsPreviewed,
        docsWritten: run.metrics.docsWritten,
      },
    });
    return run;
  } catch (error) {
    run.status = "failed";
    run.phase = "failed";
    const message = error instanceof Error ? error.message : String(error);
    run.lastError = message;
    run.metrics.errors += 1;
    run.finishedAt = new Date().toISOString();
    putPbfRun(run);
    logEvent({ runId, phase: "failed", level: "error", message: `Run failed: ${message}` });
    return run;
  } finally {
    try {
      await reader?.close();
    } catch {
      /* ignore close errors */
    }
  }
}

async function flushBatchIntoRun(input: {
  batch: CandidateFeature[];
  run: PbfCopierRun;
  startMs: number;
  metadata: PbfAdapterMetadata;
}): Promise<void> {
  const { batch, run, startMs, metadata } = input;
  if (batch.length === 0) return;

  run.phase = "filtering_candidates";
  run.metrics.candidatesSentToClassifier += batch.length;
  putPbfRun(run);

  const result = await processCandidateBatch({
    candidates: batch,
    run,
    startMs,
    metadata,
  });

  // Rejected counts come from classifier output; never inflate them.
  run.metrics.rejectedByClassifier += result.classification.rejected.length;
  run.metrics.skippedDuplicate += result.classification.duplicatesSuppressed;
  run.metrics.skippedInvalid += result.invalidCount;
  run.metrics.acceptedSpots += result.spots.length;
  run.metrics.acceptedRoutes += result.routes.length;

  const sourceKeyIndex = new Map<string, { osmType: "node" | "way" | "relation"; osmId: number }>();
  for (const candidate of batch) {
    sourceKeyIndex.set(candidate.feature.id, {
      osmType: candidate.osmType,
      osmId: candidate.osmId,
    });
  }
  recordClassifierRejections({
    run,
    rejected: result.classification.rejected as LocavaRejectedItem[],
    sourceIndex: sourceKeyIndex,
  });
  for (const item of result.classification.rejected as LocavaRejectedItem[]) {
    if (item.sourceType === "way" || item.sourceType === "relation") {
      const reason = item.rejectionReason || "below_threshold";
      run.routeTrailDiagnostics.rejectedRouteReasons[reason] =
        (run.routeTrailDiagnostics.rejectedRouteReasons[reason] ?? 0) + 1;
    }
  }
  for (const warning of result.warnings) {
    if (run.missingMetadataWarnings.length >= MISSING_METADATA_SAMPLE_CAP) break;
    run.missingMetadataWarnings.push(warning);
  }

  // Push preview docs using balanced quotas when enabled.
  const previewState = getBalancedPreviewState(run.runId);
  for (const spot of result.spots) {
    if (isQuotaMode(run.config)) {
      recordSpotForQuotas(spot, run.config.dryRunQuotas, ensureDryRunQuotaProgress(run));
    }
    for (const activity of spot.activities ?? []) {
      if (run.acceptedActivitySamples.length >= ACTIVITY_SAMPLE_CAP) break;
      if (!run.acceptedActivitySamples.includes(activity)) run.acceptedActivitySamples.push(activity);
    }
    const source = result.spotSourceMap.get(spot.id);
    if (
      source &&
      canCollectSpotPreview({
        config: run.config,
        mode: run.mode,
        metrics: run.metrics,
        previewState,
        osmType: source.osmType,
        totalPreviewDocs: run.previewDocs.length,
        quotaProgress: ensureDryRunQuotaProgress(run),
      })
    ) {
      const doc = buildSpotPreviewDoc({
        spot,
        source,
        pbfFilePath: metadata.pbfFilePath,
        sourceProvider: metadata.sourceProvider,
      });
      if (!previewDocWithinGeoFilter(doc, run.config)) {
        run.metrics.geoFilterExcludedPreviewCount += 1;
        continue;
      }
      run.previewDocs.push(doc);
      if (source.osmType === "node") previewState.nodeSpotPreviews += 1;
      else previewState.waySpotPreviews += 1;
      if (doc.nameInferenceUsed) run.metrics.nameInferredPreviewCount += 1;
      logEvent({
        runId: run.runId,
        phase: "dry_run_preview_ready",
        message: `Accepted spot: ${spot.displayName} (${spot.category}, activities=${spot.activities?.join(",")}).`,
      });
    }
    run.metrics.docsPreviewed += 1;
  }
  for (const route of result.routes) {
    if (isQuotaMode(run.config)) {
      recordRouteForQuotas(
        {
          categories: route.categories,
          activities: route.activities,
          activity: route.primaryActivity ?? route.categories[0] ?? "hiking",
          routeKind: route.routeKind as LocavaRouteKind,
        },
        run.config.dryRunQuotas,
        ensureDryRunQuotaProgress(run),
      );
    }
    for (const activity of route.activities ?? []) {
      if (run.acceptedActivitySamples.length >= ACTIVITY_SAMPLE_CAP) break;
      if (!run.acceptedActivitySamples.includes(activity)) run.acceptedActivitySamples.push(activity);
    }
    const source = result.routeSourceMap.get(route.id);
    if (
      source &&
      canCollectRoutePreview({
        config: run.config,
        mode: run.mode,
        previewState,
        totalPreviewDocs: run.previewDocs.length,
        quotaProgress: ensureDryRunQuotaProgress(run),
      })
    ) {
      if (
        !routeHasDisplayableGeometry(route) &&
        !isGeoFilterExhaustiveMode(run.config)
      ) {
        run.routeTrailDiagnostics.routesSkippedMissingGeometry += 1;
        continue;
      }
      const doc = buildRoutePreviewDoc({
        route,
        source,
        pbfFilePath: metadata.pbfFilePath,
        sourceProvider: metadata.sourceProvider,
        allowMissingLineGeometry: isGeoFilterExhaustiveMode(run.config),
      });
      if (!doc) {
        run.routeTrailDiagnostics.routesSkippedMissingGeometry += 1;
        continue;
      }
      if (!previewDocWithinGeoFilter(doc, run.config)) {
        run.metrics.geoFilterExcludedPreviewCount += 1;
        continue;
      }
      run.previewDocs.push(doc);
      previewState.routePreviews += 1;
      run.routeTrailDiagnostics.acceptedRoutePreviewCount += 1;
      if (run.routeTrailDiagnostics.sampleAcceptedRoutes.length < 10) {
        run.routeTrailDiagnostics.sampleAcceptedRoutes.push(doc);
      }
      logEvent({
        runId: run.runId,
        phase: "dry_run_preview_ready",
        message: `Accepted route: ${route.displayName} (activities=${route.activities?.join(",")}).`,
      });
    }
    run.metrics.docsPreviewed += 1;
  }

  if (run.mode === "write") {
    try {
      await maybeFlushWrites({ run, spots: result.spots, routes: result.routes });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      run.metrics.errors += 1;
      run.lastError = message;
      logEvent({
        runId: run.runId,
        phase: "writing_batch",
        level: "error",
        message: `Write failed: ${message}`,
      });
      if (run.config.stopOnBudgetExceeded && /BUDGET_EXCEEDED|production_write_blocked|emulator_host_missing/.test(message)) {
        run.status = "paused";
        run.phase = "paused";
        putPbfRun(run);
        throw error;
      }
    }
  }

  // Recompute dry-run-limit flag after each batch flush so the runner can
  // exit promptly even when a single batch overshoots the limit.
  if (shouldStopDryRunScanNow(run, previewState)) {
    run.dryRunLimitReached = true;
  }

  updateRateMetrics(run, startMs);
  putPbfRun(run);
}
