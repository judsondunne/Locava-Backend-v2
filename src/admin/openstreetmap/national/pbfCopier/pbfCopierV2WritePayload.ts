/**
 * PBF Copier V2 — transform filtered preview docs into unexploredSpots / unexploredRoutes
 * write payloads matching the original PBF copier schema, plus nested osmV2 metadata.
 */
import type { UnexploredRoute, UnexploredSpot } from "../../../../contracts/entities/osm-national-entities.contract.js";
import type { OsmNationalWriteTarget } from "../osmNationalWriteGuard.js";
import {
  validateUnexploredRouteForCopier,
  validateUnexploredSpotForCopier,
} from "../copier/osmNationalCopierRunner.js";
import { normalizePreviewDisplayName } from "./pbfCopierPreviewQuality.js";
import { isSyntheticPreviewLabel } from "./pbfCopierV2MountainQuality.js";
import { isSupportObject } from "./pbfCopierV2SupportObjects.js";
import type { PbfQualityFilterSettings } from "./pbfCopierV2QualityFilters.js";
import type { PbfOutdoorGroupingSummary } from "./pbfCopierV2OutdoorDestinationGroups.js";
import { trimDocForFirestore } from "../osmNationalDocSize.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { materializeV2PreviewDocWritePayload } from "./pbfCopierV2BlankDocBuilder.js";
import { inferStateCodeFromFilePath } from "./pbfCopierPathHelpers.js";

export type PbfV2WriteScope = "all_visible" | "viewport_rendered";

export type PbfCopierV2WriteBbox = {
  westLng: number;
  southLat: number;
  eastLng: number;
  northLat: number;
};

export type BuildPbfV2WritePayloadInput = {
  visibleItems: PbfCopierPreviewDoc[];
  rawItems: PbfCopierPreviewDoc[];
  bbox: PbfCopierV2WriteBbox;
  scanCacheId: string | null;
  qualityFilterSettings?: PbfQualityFilterSettings;
  qualityFilterSummary?: Record<string, unknown> | null;
  groupingSummary?: PbfOutdoorGroupingSummary | null;
  selectedWriteScope: PbfV2WriteScope;
  /** When true, include items marked filteredOut (hidden junk). Default false. */
  includeHidden?: boolean;
  /** When true, write support objects as standalone spots even if attached. Default false. */
  includeSupportAsPrimary?: boolean;
  /** Doc ids currently rendered on the map (viewport_rendered scope). */
  viewportRenderedIds?: string[];
  writeTarget?: OsmNationalWriteTarget;
  writeRunId?: string;
};

export type PbfV2WriteSkipExample = {
  id: string;
  displayName: string;
  kind: string;
  reason: string;
};

export type PbfV2WriteValidExample = {
  id: string;
  displayName: string;
  kind: "spot" | "route";
  collection: "unexploredSpots" | "unexploredRoutes";
  sourceKey: string;
};

export type PbfV2WritePayloadPlan = {
  spots: UnexploredSpot[];
  routes: UnexploredRoute[];
  attempted: number;
  spotsPlanned: number;
  routesPlanned: number;
  skippedInvalid: number;
  skippedSupportOnly: number;
  skippedFilteredOut: number;
  supportObjectsNested: number;
  skippedExamples: PbfV2WriteSkipExample[];
  validExamples: PbfV2WriteValidExample[];
  validationErrors: string[];
  writeTarget: {
    spotsCollection: "unexploredSpots";
    routesCollection: "unexploredRoutes";
    postsWriteForbidden: true;
  };
  sourceKeys: string[];
};

export const PBF_V2_WRITE_TARGET = {
  spotsCollection: "unexploredSpots" as const,
  routesCollection: "unexploredRoutes" as const,
  postsWriteForbidden: true as const,
};

export const PBF_V2_LARGE_WRITE_THRESHOLD = 500;

/** Deterministic V2 source id for duplicate detection. */
export function computePbfV2SourceKey(doc: PbfCopierPreviewDoc): string {
  if (doc.kind === "unexplored_route" && doc.destinationGroupId) {
    const normalized =
      normalizePreviewDisplayName(doc.displayName) || doc.destinationGroupId;
    return `osm-v2-route-group:${doc.destinationGroupId || normalized}`;
  }
  return `osm-v2:${doc.osmType}:${doc.osmId}`;
}

function isAttachedSupportOnly(doc: PbfCopierPreviewDoc): boolean {
  if (doc.attachedTo) return true;
  if (doc.attachedToRouteId && isSupportObject(doc)) return true;
  if (isSupportObject(doc) && doc.filteredOut && doc.filteredBy?.includes("support_attached")) {
    return true;
  }
  return false;
}

function hasValidCoordinates(doc: PbfCopierPreviewDoc): boolean {
  if (doc.kind === "unexplored_route") {
    const anchor = doc.routeMarkerCoordinate ?? doc.center ?? { lat: doc.lat, lng: doc.lng };
    return Number.isFinite(anchor?.lat) && Number.isFinite(anchor?.lng);
  }
  return Number.isFinite(doc.lat) && Number.isFinite(doc.lng);
}

function hasMeaningfulDisplayName(doc: PbfCopierPreviewDoc): boolean {
  const name = (doc.displayName || "").trim();
  if (!name) return false;
  if (isSyntheticPreviewLabel(doc)) return false;
  return true;
}

function hasPrimaryActivity(doc: PbfCopierPreviewDoc): boolean {
  return Boolean(
    doc.primaryActivity?.trim() ||
      (Array.isArray(doc.activities) && doc.activities.length > 0) ||
      doc.primaryCategory?.trim()
  );
}

export function validatePbfV2PreviewDocForWrite(
  doc: PbfCopierPreviewDoc,
  input?: { includeHidden?: boolean; includeSupportAsPrimary?: boolean }
): string[] {
  const reasons: string[] = [];

  if (doc.filteredOut && !input?.includeHidden) {
    reasons.push("filtered_out");
  }
  if (isAttachedSupportOnly(doc) && !input?.includeSupportAsPrimary) {
    reasons.push("support_attached_to_parent");
  }
  if (isSupportObject(doc) && !input?.includeSupportAsPrimary && !doc.destinationGroupId) {
    if (doc.attachedTo || doc.attachedToRouteId) {
      reasons.push("support_object_without_standalone");
    }
  }
  if (!hasMeaningfulDisplayName(doc)) {
    reasons.push("generic_or_missing_display_name");
  }
  if (!hasValidCoordinates(doc)) {
    reasons.push("missing_coordinates");
  }
  if (!hasPrimaryActivity(doc)) {
    reasons.push("missing_activity_or_category");
  }
  if (!doc.osmType || doc.osmId == null) {
    reasons.push("missing_osm_identity");
  }
  if (!computePbfV2SourceKey(doc)) {
    reasons.push("missing_source_key");
  }

  const payload = doc.writePayload;
  if (!payload || typeof payload !== "object") {
    reasons.push("missing_write_payload");
  } else if (doc.kind === "unexplored_spot") {
    reasons.push(...validateUnexploredSpotForCopier(payload as UnexploredSpot));
  } else if (doc.kind === "unexplored_route") {
    reasons.push(...validateUnexploredRouteForCopier(payload as UnexploredRoute));
  } else {
    reasons.push("unknown_kind");
  }

  return [...new Set(reasons)];
}

function selectItemsForWrite(input: BuildPbfV2WritePayloadInput): PbfCopierPreviewDoc[] {
  const pool =
    input.selectedWriteScope === "viewport_rendered"
      ? input.visibleItems
      : input.includeHidden
        ? input.rawItems
        : input.visibleItems;

  if (input.selectedWriteScope === "viewport_rendered") {
    const idSet = new Set(input.viewportRenderedIds ?? []);
    return pool.filter((d) => idSet.has(d.id));
  }

  return pool;
}

function countNestedSupportObjects(doc: PbfCopierPreviewDoc): number {
  const meta = doc.supportMetadata;
  if (!meta) return 0;
  let n = 0;
  for (const key of [
    "parking",
    "trailheads",
    "toilets",
    "benches",
    "shelters",
    "informationMaps",
    "connectors",
    "viewpoints",
    "waterfalls",
  ] as const) {
    const arr = meta[key];
    if (Array.isArray(arr)) n += arr.length;
  }
  return n;
}

function buildOsmV2Metadata(
  doc: PbfCopierPreviewDoc,
  input: BuildPbfV2WritePayloadInput,
  sourceKey: string
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    source: "pbf-copier-v2",
    sourceKey,
    scanCacheId: input.scanCacheId,
    osmType: doc.osmType,
    osmId: doc.osmId,
    tags: doc.sourceTagSample ?? {},
    bbox: input.bbox,
    qualityFilterSettings: input.qualityFilterSettings ?? null,
    filteredBy: doc.filteredBy ?? [],
    filterReason: doc.filterReason ?? null,
    derivedName: doc.derivedName ?? false,
    nameSource: doc.nameSource ?? null,
    nameConfidence: doc.nameConfidence ?? null,
    destinationGroupId: doc.destinationGroupId ?? null,
    attachedToRouteId: doc.attachedToRouteId ?? null,
    supportMetadata: doc.supportMetadata ?? null,
    routeMarkerCoordinate: doc.routeMarkerCoordinate ?? null,
    routeCenterCoordinate: doc.routeCenterCoordinate ?? null,
    linePointCount: doc.geometryPointCount ?? doc.routeLineCoordinates?.length ?? null,
    routeLineColor: doc.routeLineColor ?? null,
    routeShapeHint: doc.routeShapeHint ?? null,
    distanceMeters: doc.distanceMeters ?? null,
    distanceMiles: doc.distanceMiles ?? null,
    distanceLabel: doc.distanceLabel ?? null,
    writtenAt: now,
    schemaVersion: 2,
  };
}

function enrichSpotWritePayload(
  doc: PbfCopierPreviewDoc,
  input: BuildPbfV2WritePayloadInput,
  sourceKey: string
): UnexploredSpot {
  const base = structuredClone(doc.writePayload) as UnexploredSpot;
  const now = new Date().toISOString();
  const writeTarget = input.writeTarget ?? "none";

  if (input.writeRunId) {
    base.import = {
      ...base.import,
      runId: input.writeRunId,
      importedAt: now,
      writeMode: writeTarget !== "none",
      writeTarget,
    };
  }
  base.audit = {
    ...base.audit,
    updatedAt: now,
    lastSeenAt: now,
  };

  const sourceKeys = [...new Set([...(base.sourceKeys ?? []), sourceKey])];
  base.sourceKeys = sourceKeys;

  const enriched = {
    ...base,
    osmV2: buildOsmV2Metadata(doc, input, sourceKey),
  } as UnexploredSpot & { osmV2: Record<string, unknown> };

  const trimmed = trimDocForFirestore(enriched as unknown as Record<string, unknown>);
  return trimmed.doc as unknown as UnexploredSpot;
}

function enrichRouteWritePayload(
  doc: PbfCopierPreviewDoc,
  input: BuildPbfV2WritePayloadInput,
  sourceKey: string
): UnexploredRoute {
  const base = structuredClone(doc.writePayload) as UnexploredRoute;
  const now = new Date().toISOString();
  const writeTarget = input.writeTarget ?? "none";

  if (input.writeRunId) {
    base.import = {
      ...base.import,
      runId: input.writeRunId,
      importedAt: now,
      writeMode: writeTarget !== "none",
      writeTarget,
    };
  }
  base.audit = {
    ...base.audit,
    updatedAt: now,
    lastSeenAt: now,
  };

  const sourceKeys = [...new Set([...(base.sourceKeys ?? []), sourceKey])];
  base.sourceKeys = sourceKeys;

  const routeCoords = doc.routeLineCoordinates;
  const marker = doc.routeMarkerCoordinate ?? doc.center ?? { lat: doc.lat, lng: doc.lng };
  const center = doc.routeCenterCoordinate ?? doc.center ?? marker;

  const enriched = {
    ...base,
    isRoute: true,
    routeCoordinates: routeCoords?.length ? routeCoords : undefined,
    routeLineColor: doc.routeLineColor,
    routeMarkerCoordinate: marker,
    routeCenterCoordinate: center,
    linePointCount: doc.geometryPointCount ?? routeCoords?.length,
    osmV2: buildOsmV2Metadata(doc, input, sourceKey),
  } as UnexploredRoute & {
    isRoute?: boolean;
    routeCoordinates?: Array<{ lat: number; lng: number }>;
    routeLineColor?: string;
    routeMarkerCoordinate?: { lat: number; lng: number };
    routeCenterCoordinate?: { lat: number; lng: number };
    linePointCount?: number;
    osmV2: Record<string, unknown>;
  };

  const trimmed = trimDocForFirestore(enriched as unknown as Record<string, unknown>);
  return trimmed.doc as unknown as UnexploredRoute;
}

/** Transform V2 preview docs into Firestore write payloads. */
export function buildPbfV2WritePayload(input: BuildPbfV2WritePayloadInput): PbfV2WritePayloadPlan {
  const candidates = selectItemsForWrite(input);
  const spots: UnexploredSpot[] = [];
  const routes: UnexploredRoute[] = [];
  const skippedExamples: PbfV2WriteSkipExample[] = [];
  const validExamples: PbfV2WriteValidExample[] = [];
  const sourceKeys: string[] = [];
  const validationErrors: string[] = [];

  let skippedInvalid = 0;
  let skippedSupportOnly = 0;
  let skippedFilteredOut = 0;
  let supportObjectsNested = 0;

  const blankDocInput = {
    runId: input.writeRunId ?? "pbf-v2-write",
    writeTarget: input.writeTarget ?? "none",
    stateCode: inferStateCodeFromFilePath(input.visibleItems[0]?.pbfFilePath ?? ""),
  };

  for (const rawDoc of candidates) {
    const doc = materializeV2PreviewDocWritePayload(rawDoc, blankDocInput);
    if (doc.filteredOut && !input.includeHidden) {
      skippedFilteredOut += 1;
      if (skippedExamples.length < 20) {
        skippedExamples.push({
          id: doc.id,
          displayName: doc.displayName,
          kind: doc.kind,
          reason: doc.filterReason ?? "filtered_out",
        });
      }
      continue;
    }

    if (isAttachedSupportOnly(doc) && !input.includeSupportAsPrimary) {
      skippedSupportOnly += 1;
      if (skippedExamples.length < 20) {
        skippedExamples.push({
          id: doc.id,
          displayName: doc.displayName,
          kind: doc.kind,
          reason: "support_attached_to_parent",
        });
      }
      continue;
    }

    const reasons = validatePbfV2PreviewDocForWrite(doc, {
      includeHidden: input.includeHidden,
      includeSupportAsPrimary: input.includeSupportAsPrimary,
    });
    if (reasons.length > 0) {
      skippedInvalid += 1;
      if (skippedExamples.length < 20) {
        skippedExamples.push({
          id: doc.id,
          displayName: doc.displayName,
          kind: doc.kind,
          reason: reasons.join(", "),
        });
      }
      continue;
    }

    const sourceKey = computePbfV2SourceKey(doc);
    sourceKeys.push(sourceKey);
    supportObjectsNested += countNestedSupportObjects(doc);

    if (doc.kind === "unexplored_spot") {
      spots.push(enrichSpotWritePayload(doc, input, sourceKey));
    } else {
      routes.push(enrichRouteWritePayload(doc, input, sourceKey));
    }

    if (validExamples.length < 20) {
      validExamples.push({
        id: doc.id,
        displayName: doc.displayName,
        kind: doc.kind === "unexplored_route" ? "route" : "spot",
        collection: doc.kind === "unexplored_route" ? "unexploredRoutes" : "unexploredSpots",
        sourceKey,
      });
    }
  }

  if (spots.length === 0 && routes.length === 0) {
    validationErrors.push("no_valid_write_items");
  }

  return {
    spots,
    routes,
    attempted: candidates.length,
    spotsPlanned: spots.length,
    routesPlanned: routes.length,
    skippedInvalid,
    skippedSupportOnly,
    skippedFilteredOut,
    supportObjectsNested,
    skippedExamples,
    validExamples,
    validationErrors,
    writeTarget: PBF_V2_WRITE_TARGET,
    sourceKeys,
  };
}
