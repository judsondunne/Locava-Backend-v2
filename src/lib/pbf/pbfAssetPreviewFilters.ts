import { scorePreviewDocForDedup } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierPreviewQuality.js";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import { computePbfV2SourceKey } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2WritePayload.js";
import {
  buildOsmSpecificPhotoQuery,
  type OsmPhotoQueryResult,
} from "./buildOsmSpecificPhotoQuery.js";

const EXCLUDED_FILTER_KEYS = new Set([
  "service_road",
  "address_only",
  "traffic_signal",
  "railway_level_crossing",
  "power_tower",
  "residential_label",
  "residential_home",
  "infrastructure",
]);

const RAW_TAG_NAME = /^[a-z][a-z0-9_]*=\S+$/i;

function hasCoordinates(doc: PbfCopierPreviewDoc): boolean {
  if (Number.isFinite(doc.lat) && Number.isFinite(doc.lng)) return true;
  if (doc.routeMarkerCoordinate?.lat != null && doc.routeMarkerCoordinate?.lng != null) return true;
  if (doc.routeCenterCoordinate?.lat != null && doc.routeCenterCoordinate?.lng != null) return true;
  return false;
}

function isRawUntransformedName(name: string): boolean {
  const trimmed = name.trim();
  if (/^highway=\S+$/i.test(trimmed)) return true;
  if (/^route=\S+$/i.test(trimmed)) return true;
  return false;
}

/** Raw OSM tag dumps and other non-destination labels unsuitable for photo preview. */
export function isJunkAssetPreviewName(displayName: string): boolean {
  const name = displayName.trim();
  if (!name) return true;
  if (RAW_TAG_NAME.test(name)) return true;
  if (/^abandoned:/i.test(name)) return true;
  if (/^abandoned\s+yes$/i.test(name)) return true;
  if (/^13\/\d+$/.test(name)) return true;
  if (/^connector\s+trail$/i.test(name)) return true;
  if (/connector trail connector trail/i.test(name)) return true;
  if (/^abandoned\s+/i.test(name) && /connector trail/i.test(name)) return true;
  if (/^highway=/i.test(name)) return true;
  if (/^route=/i.test(name)) return true;
  if (/^aeroway=/i.test(name)) return true;
  if (/^barrier=/i.test(name)) return true;
  if (/^bicycle=/i.test(name)) return true;
  return false;
}

function normalizeSelectionName(displayName: string): string {
  return displayName.trim().toLowerCase().replace(/\s+/g, " ");
}

function hasTownHint(doc: PbfCopierPreviewDoc, query: OsmPhotoQueryResult): boolean {
  if (query.confidenceHints.some((hint) => hint.startsWith("town:"))) return true;
  const payload = doc.writePayload as { location?: { city?: string } } | undefined;
  return Boolean(payload?.location?.city?.trim() || doc.sourceTagSample?.["addr:city"]?.trim());
}

export function scoreAssetPreviewCandidate(
  doc: PbfCopierPreviewDoc,
  query: OsmPhotoQueryResult,
): number {
  let score = scorePreviewDocForDedup(doc);
  score += query.querySpecificityScore * 4;
  if (doc.kind === "unexplored_spot") score += 22;
  if (hasTownHint(doc, query)) score += 18;
  if (doc.publicMapEligible) score += 8;
  if (doc.warnings?.includes("v2_generated_outdoor_name")) score -= 30;
  if (doc.nameInferenceUsed) score -= 6;
  if (/covered bridge|waterfall|swimming area|viewpoint|summit|peak|museum|library|park/i.test(doc.displayName)) {
    score += 12;
  }
  return score;
}

export type PbfAssetPreviewSelection = {
  selected: PbfCopierPreviewDoc[];
  eligibleCount: number;
  photoQueryReadyCount: number;
  junkExcludedCount: number;
  querySkippedCount: number;
};

export function selectPbfAssetPreviewCandidates(
  docs: PbfCopierPreviewDoc[],
  maxSpots: number,
  options?: { preferWriteReady?: boolean },
): PbfAssetPreviewSelection {
  const eligible = docs.filter(isPbfItemEligibleForAssetPreview);
  let junkExcludedCount = 0;
  let querySkippedCount = 0;
  const ranked: Array<{ doc: PbfCopierPreviewDoc; score: number }> = [];

  for (const doc of eligible) {
    if (isJunkAssetPreviewName(doc.displayName)) {
      junkExcludedCount += 1;
      continue;
    }
    const query = buildOsmSpecificPhotoQuery(doc);
    if (query.skip) {
      querySkippedCount += 1;
      continue;
    }
    let score = scoreAssetPreviewCandidate(doc, query);
    if (options?.preferWriteReady) {
      if (doc.writePayload) score += 28;
      if (doc.publicMapEligible) score += 12;
      if (doc.mapReadiness === "ready") score += 8;
    }
    ranked.push({ doc, score });
  }

  ranked.sort((a, b) => b.score - a.score);

  const seenNames = new Set<string>();
  const selected: PbfCopierPreviewDoc[] = [];
  for (const row of ranked) {
    const key = normalizeSelectionName(row.doc.displayName);
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    selected.push(row.doc);
    if (selected.length >= maxSpots) break;
  }

  return {
    selected,
    eligibleCount: eligible.length,
    photoQueryReadyCount: ranked.length,
    junkExcludedCount,
    querySkippedCount,
  };
}

export function isPbfItemEligibleForAssetPreview(doc: PbfCopierPreviewDoc): boolean {
  if (doc.filteredOut === true) return false;
  if (!doc.displayName?.trim()) return false;
  if (isRawUntransformedName(doc.displayName)) return false;
  if (!hasCoordinates(doc)) return false;
  if (!doc.id?.trim()) return false;
  if (!doc.osmType || !Number.isFinite(doc.osmId)) return false;
  if (!computePbfV2SourceKey(doc)) return false;

  const filteredBy = doc.filteredBy ?? [];
  if (filteredBy.some((key) => EXCLUDED_FILTER_KEYS.has(key))) return false;

  const reason = (doc.filterReason ?? "").toLowerCase();
  if (
    reason.includes("service road") ||
    reason.includes("traffic signal") ||
    reason.includes("level crossing") ||
    reason.includes("power tower") ||
    reason.includes("address-only") ||
    reason.includes("address only") ||
    reason.includes("residential")
  ) {
    return false;
  }

  if (doc.mapReadiness === "hidden") return false;
  return true;
}

export function summarizePbfPreviewItem(doc: PbfCopierPreviewDoc): Record<string, unknown> {
  const payload = doc.writePayload as { location?: Record<string, string> } | undefined;
  return {
    id: doc.id,
    kind: doc.kind,
    displayName: doc.displayName,
    primaryActivity: doc.primaryActivity,
    primaryCategory: doc.primaryCategory,
    activities: doc.activities,
    osmType: doc.osmType,
    osmId: doc.osmId,
    lat: doc.lat,
    lng: doc.lng,
    routeMarkerCoordinate: doc.routeMarkerCoordinate,
    routeCenterCoordinate: doc.routeCenterCoordinate,
    address: payload?.location?.address ?? null,
    town: payload?.location?.city ?? doc.sourceTagSample?.["addr:city"] ?? null,
    state: payload?.location?.state ?? doc.sourceTagSample?.["addr:state"] ?? null,
    sourceTagSample: doc.sourceTagSample,
    warnings: doc.warnings,
    filteredBy: doc.filteredBy,
    attachedTo: doc.attachedTo,
    supportMetadata: doc.supportMetadata,
    writePayload: doc.writePayload,
  };
}
