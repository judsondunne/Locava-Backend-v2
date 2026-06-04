import path from "node:path";
import { classifyOpenStreetMapFeaturesForInventory } from "../../openstreetmap.service.js";
import {
  parseOverpassElement,
  type OsmFeatureListItem,
} from "../../../../lib/openstreetmap/osmFeatureParse.js";
import {
  adaptPbfEntityToOverpassElement,
  isPbfEntitySupportedForCopier,
  type PbfRawEntity,
} from "../../../../lib/openstreetmap/pbf/pbfElementAdapter.js";
import {
  buildPbfAdapterMetadata,
  defaultPbfFeatureReaderFactory,
  type PbfFeatureReaderFactory,
} from "../../../../lib/openstreetmap/pbf/pbfFeatureReader.js";
import {
  createPbfTagFilter,
  DEFAULT_PBF_TAG_FILTER_POLICY,
} from "../../../../lib/openstreetmap/pbf/pbfTagFilter.js";
import { buildUnexploredDocsFromClassification } from "../osmNationalDocBuilder.js";
import {
  validateUnexploredRouteForCopier,
  validateUnexploredSpotForCopier,
} from "../copier/osmNationalCopierRunner.js";
import type { LocavaInventoryRoute, LocavaInventorySpot } from "../../../../lib/inventory/inventoryLocavaTypes.js";
import { dedupeLocavaInventory } from "../../../../lib/inventory/inventoryLocavaDedupe.js";
import {
  describeLocavaNatureSignals,
  inferActivitiesFromOsmTags,
  listActivityRelevantTags,
} from "../../../../lib/inventory/inventoryOsmActivityTags.js";
import { validatePbfFile } from "./pbfCopierRunner.js";
import type { PbfCopierRunnerHooks } from "./pbfCopierRunner.js";
import { inferStateCodeFromFilePath } from "./pbfCopierPathHelpers.js";
import { computeScanQualityAssessment } from "./pbfCopierScanQuality.js";
import { emptyPbfCopierMetrics } from "./pbfCopierTypes.js";

export type DiagnosePlaceMatch = {
  osmType: "node" | "way" | "relation";
  osmId: number;
  name: string | null;
  lat: number | null;
  lng: number | null;
  geometrySummary: string;
  tags: Record<string, string>;
  passedTagFilter: boolean;
  adaptedToOverpass: boolean;
  parsedFeature: boolean;
  featureId: string | null;
  classifierScore: number | null;
  classifierDecision: string | null;
  rejectionReason: string | null;
  primaryCategory: string | null;
  activities: string[];
  wouldBuildSpot: boolean;
  wouldBuildRoute: boolean;
  docBuildBlockReason: string | null;
  nameOnlyPlaceWithBeachInName: boolean;
  diagnosticNote: string | null;
  activityRelevantTags: Record<string, string>;
  locavaNatureSignals: string[];
  activitiesFromTagsOnly: string[];
  distanceMetersFromFirstMatch: number | null;
};

export type DiagnosePlaceResult = {
  filePath: string;
  resolvedPath: string;
  searchText: string;
  matches: DiagnosePlaceMatch[];
  rawObjectsScanned: number;
  nodesScanned: number;
  waysScanned: number;
  relationsScanned: number;
  scanQuality: ReturnType<typeof computeScanQualityAssessment>;
  rawScanLimitReached: boolean;
  fileEnded: boolean;
  summaryNote: string | null;
};

function normalizeSearch(text: string): string {
  return String(text ?? "")
    .trim()
    .toLowerCase();
}

function entityMatchesSearch(entity: PbfRawEntity, search: string): boolean {
  if (!search) return false;
  const tags = entity.tags ?? {};
  const name = String(tags.name ?? tags["name:en"] ?? "").toLowerCase();
  if (name.includes(search)) return true;
  for (const [k, v] of Object.entries(tags)) {
    if (`${k}=${v}`.toLowerCase().includes(search)) return true;
    if (String(v).toLowerCase().includes(search)) return true;
  }
  return false;
}

function trimTags(tags: Record<string, unknown> | undefined): Record<string, string> {
  if (!tags) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    out[k] = typeof v === "string" ? v : JSON.stringify(v).slice(0, 120);
  }
  return out;
}

function geometrySummary(entity: PbfRawEntity): string {
  if (entity.type === "node") {
    return entity.lat != null && entity.lon != null
      ? `node @ ${entity.lat.toFixed(5)}, ${entity.lon.toFixed(5)}`
      : "node (no coords)";
  }
  if (entity.type === "way") {
    const refs = entity.refs?.length ?? 0;
    return `way with ${refs} node refs`;
  }
  const refs = entity.members?.length ?? 0;
  return `${entity.type} with ${refs} member refs`;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function isNameOnlyPlaceWithBeachInName(tags: Record<string, string>, name: string | null): boolean {
  const n = (name ?? "").toLowerCase();
  const hasBeachName = /\bbeach\b|\bfalls\b|\bpond\b|\bmountain\b/.test(n);
  const placeTag = tags.place;
  const hasDestinationTag =
    tags.natural === "beach" ||
    tags.leisure === "beach" ||
    tags.natural === "water" ||
    tags.waterway === "waterfall" ||
    tags.natural === "waterfall" ||
    tags.tourism === "viewpoint" ||
    tags.leisure === "park";
  return Boolean(hasBeachName && placeTag && !hasDestinationTag);
}

export async function diagnosePlaceInPbf(input: {
  filePath: string;
  searchText: string;
  maxRawObjectsToScan?: number | null;
  includeNodes?: boolean;
  includeWays?: boolean;
  includeRelations?: boolean;
  stateCode?: string;
  includePublicOnly?: boolean;
  includeReviewDocs?: boolean;
  hooks?: PbfCopierRunnerHooks;
}): Promise<DiagnosePlaceResult> {
  const search = normalizeSearch(input.searchText);
  if (!search) {
    throw new Error("missing_search_text");
  }

  const validation = await validatePbfFile(input.filePath);
  if (!validation.exists || !validation.readable) {
    throw new Error(`pbf_file_not_readable:${validation.warnings.join(";")}`);
  }

  const includeNodes = input.includeNodes !== false;
  const includeWays = input.includeWays !== false;
  const includeRelations = input.includeRelations !== false;
  const stateCode = input.stateCode?.trim() || inferStateCodeFromFilePath(input.filePath);
  const includePublicOnly = input.includePublicOnly !== false;
  const includeReviewDocs = input.includeReviewDocs === true;

  const readerFactory: PbfFeatureReaderFactory =
    input.hooks?.readerFactory ?? defaultPbfFeatureReaderFactory;
  const classifyFn = input.hooks?.classify ?? classifyOpenStreetMapFeaturesForInventory;

  const reader = await readerFactory({ filePath: validation.resolvedPath });
  const opened = await reader.open({ filePath: validation.resolvedPath });
  const metadata = buildPbfAdapterMetadata({
    filePath: validation.resolvedPath,
    parserVersion: opened.parserVersion,
    sourceTimestamp: opened.sourceTimestamp,
  });
  const tagFilter = createPbfTagFilter(DEFAULT_PBF_TAG_FILTER_POLICY);

  const matches: DiagnosePlaceMatch[] = [];
  let rawObjectsScanned = 0;
  let nodesScanned = 0;
  let waysScanned = 0;
  let relationsScanned = 0;
  let rawScanLimitReached = false;
  let fileEnded = false;
  const maxCap = input.maxRawObjectsToScan ?? null;

  try {
    scanLoop: for await (const chunk of reader.read()) {
      for (const entity of chunk.entities) {
        rawObjectsScanned += 1;
        if (entity.type === "node") nodesScanned += 1;
        else if (entity.type === "way") waysScanned += 1;
        else if (entity.type === "relation") relationsScanned += 1;

        if (entity.type === "node" && !includeNodes) continue;
        if (entity.type === "way" && !includeWays) continue;
        if (entity.type === "relation" && !includeRelations) continue;

        if (!entityMatchesSearch(entity as PbfRawEntity, search)) continue;

        const tags = trimTags(entity.tags as Record<string, unknown>);
        const name = tags.name ?? tags["name:en"] ?? null;
        const supported = isPbfEntitySupportedForCopier(entity as PbfRawEntity);
        const passedTagFilter = supported && tagFilter.isCandidate(entity.tags);
        const adapted = passedTagFilter
          ? adaptPbfEntityToOverpassElement(entity as PbfRawEntity, metadata)
          : null;
        const feature: OsmFeatureListItem | null =
          adapted?.element != null ? parseOverpassElement(adapted.element) : null;

        let classifierScore: number | null = null;
        let classifierDecision: string | null = null;
        let rejectionReason: string | null = null;
        let primaryCategory: string | null = null;
        let activities: string[] = [];
        let wouldBuildSpot = false;
        let wouldBuildRoute = false;
        let docBuildBlockReason: string | null = null;
        let diagnosticNote: string | null = null;

        if (isNameOnlyPlaceWithBeachInName(tags, name)) {
          diagnosticNote =
            "GNIS/populated-place node (place=*) with a scenic name but no destination tags on THIS object. " +
            "Activities are never inferred from the name — only from OSM tags on this node. " +
            "Check other matches: the waterfall/beach icon may be a separate nearby OSM feature.";
        }

        if (feature) {
          const classification = await classifyFn({
            bbox: {
              minLat: feature.lat - 0.01,
              minLng: feature.lng - 0.01,
              maxLat: feature.lat + 0.01,
              maxLng: feature.lng + 0.01,
            },
            stateCode,
            runId: "diagnose_place",
            source: "fixture",
            rawFeatures: [feature],
            elementsById: new Map(),
            includeOsmSpots: true,
            includeOsmRoutes: true,
            includeOsmOffroad: true,
            offroadSource: "osm",
            useLiveVtrans: false,
            useLiveNhdot: false,
            includeClass4: false,
            includeLegalTrails: false,
            includeClass6: false,
          });

          const rejected = classification.rejected.find((r) => r.sourceKey === feature.id);
          if (rejected) {
            classifierScore = rejected.locavaScore ?? null;
            classifierDecision = "reject";
            rejectionReason = rejected.rejectionReason ?? "below_threshold";
            primaryCategory = rejected.rawTypeLabel || null;
          } else {
            const spot = classification.acceptedSpots[0] as LocavaInventorySpot | undefined;
            const route = classification.acceptedRoutes[0] as LocavaInventoryRoute | undefined;
            if (spot) {
              classifierScore = spot.locavaScore;
              classifierDecision = "spot";
              primaryCategory = spot.category;
              activities = spot.activities ?? [];
            } else if (route) {
              classifierScore = route.locavaScore;
              classifierDecision = "route";
              primaryCategory = route.categories?.[0] ?? route.activity;
              activities = route.activities ?? [];
            }
          }

          const dedupedRoutes = dedupeLocavaInventory({
            spots: [],
            routes: classification.acceptedRoutes as LocavaInventoryRoute[],
          });
          const { spots, routes } = buildUnexploredDocsFromClassification({
            spots: classification.acceptedSpots as LocavaInventorySpot[],
            routes: dedupedRoutes.routes,
            stateCode,
            runId: "diagnose_place",
            chunkId: `diagnose_${path.basename(metadata.pbfFilePath)}`,
            writeMode: false,
            writeTarget: "none",
            includePublicOnly,
            includeReviewItems: includeReviewDocs,
            includeOsmSpots: true,
            includeOsmRoutes: true,
            includeOffroad: true,
          });

          if (spots.length > 0) {
            const reasons = validateUnexploredSpotForCopier(spots[0]!);
            wouldBuildSpot = reasons.length === 0;
            if (!wouldBuildSpot) docBuildBlockReason = reasons.join(",");
          } else if (routes.length > 0) {
            const reasons = validateUnexploredRouteForCopier(routes[0]!);
            wouldBuildRoute = reasons.length === 0;
            if (!wouldBuildRoute) docBuildBlockReason = reasons.join(",");
          } else if (
            (classification.acceptedSpots.length > 0 || classification.acceptedRoutes.length > 0) &&
            includePublicOnly
          ) {
            docBuildBlockReason = "filtered_by_public_ready_or_review_settings";
          } else if (!feature && !passedTagFilter) {
            docBuildBlockReason = "tag_filter_or_adapter";
          }
        } else if (!passedTagFilter) {
          docBuildBlockReason = "failed_pbf_tag_filter";
        } else if (!adapted) {
          docBuildBlockReason = "adapter_failed";
        } else {
          docBuildBlockReason = "parse_failed";
        }

        matches.push({
          osmType: entity.type,
          osmId: Number(entity.id) || 0,
          name,
          lat: entity.type === "node" ? (entity.lat ?? null) : feature?.lat ?? null,
          lng: entity.type === "node" ? (entity.lon ?? null) : feature?.lng ?? null,
          geometrySummary: geometrySummary(entity as PbfRawEntity),
          tags,
          passedTagFilter,
          adaptedToOverpass: Boolean(adapted),
          parsedFeature: Boolean(feature),
          featureId: feature?.id ?? null,
          classifierScore,
          classifierDecision,
          rejectionReason,
          primaryCategory,
          activities,
          wouldBuildSpot,
          wouldBuildRoute,
          docBuildBlockReason,
          nameOnlyPlaceWithBeachInName: isNameOnlyPlaceWithBeachInName(tags, name),
          diagnosticNote,
          activityRelevantTags: listActivityRelevantTags(tags),
          locavaNatureSignals: describeLocavaNatureSignals(tags),
          activitiesFromTagsOnly: inferActivitiesFromOsmTags(tags),
          distanceMetersFromFirstMatch: null,
        });

        if (maxCap != null && rawObjectsScanned >= maxCap) {
          rawScanLimitReached = true;
          break scanLoop;
        }
      }
      if (rawScanLimitReached) break scanLoop;
    }
    if (!rawScanLimitReached) fileEnded = true;
  } finally {
    await reader.close().catch(() => {});
  }

  if (matches.length > 0) {
    const anchor = matches[0]!;
    if (anchor.lat != null && anchor.lng != null) {
      for (let i = 1; i < matches.length; i++) {
        const m = matches[i]!;
        if (m.lat != null && m.lng != null) {
          m.distanceMetersFromFirstMatch = Math.round(haversineMeters(anchor.lat, anchor.lng, m.lat, m.lng));
        }
      }
    }
  }

  let summaryNote: string | null = null;
  const accepted = matches.filter((m) => m.classifierDecision === "spot" || m.classifierDecision === "route");
  const rejected = matches.filter((m) => m.classifierDecision === "reject");
  if (matches.length > 1) {
    summaryNote =
      `Found ${matches.length} OSM object(s) matching "${input.searchText}". ` +
      `${accepted.length} accepted, ${rejected.length} rejected. ` +
      "Map icons often come from a different object than a GNIS place=hamlet node — compare activityRelevantTags on each match.";
  }

  const scanQuality = computeScanQualityAssessment({
    metrics: {
      ...emptyPbfCopierMetrics(),
      fileBytesTotal: validation.fileSizeBytes,
      rawObjectsScanned,
      nodesScanned,
      waysScanned,
      relationsScanned,
    },
    dryRunLimitReached: false,
    rawScanLimitReached,
    fileEnded,
    maxRawObjectsToScan: maxCap,
    mode: "dry_run_preview",
  });

  return {
    filePath: input.filePath,
    resolvedPath: validation.resolvedPath,
    searchText: input.searchText,
    matches,
    rawObjectsScanned,
    nodesScanned,
    waysScanned,
    relationsScanned,
    scanQuality,
    rawScanLimitReached,
    fileEnded,
    summaryNote,
  };
}
