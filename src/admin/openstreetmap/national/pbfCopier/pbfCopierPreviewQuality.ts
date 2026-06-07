import {
  dedupeActivities,
  isLocavaActivity,
  LOCAVA_ACTIVITIES,
  normalizeActivity,
  pickPrimaryActivity,
  type ActivityWeightMap,
  type LocavaActivity,
} from "../../../../lib/inventory/activities/locavaActivities.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";
import { evaluateOsmVisitability } from "../../../../lib/inventory/inventoryVisitability.js";
import { haversineMeters } from "../../../../lib/inventory/inventoryTileGrid.js";

const CANONICAL_SET = new Set<string>(LOCAVA_ACTIVITIES);

const PREVIEW_TAG_PRIORITY_KEYS = [
  "name",
  "name:en",
  "highway",
  "railway",
  "bridge",
  "footway",
  "surface",
  "service",
  "access",
  "natural",
  "tourism",
  "leisure",
  "amenity",
  "shop",
  "waterway",
  "route",
  "sac_scale",
  "trail_visibility",
  "foot",
  "bicycle",
  "horse",
  "operator",
  "layer",
] as const;

/** Keep destination-critical OSM tags even when the full tag set is large. */
export function samplePreviewTags(
  tags: Record<string, string> | undefined,
  maxFields = 12
): Record<string, string> {
  if (!tags) return {};
  const out: Record<string, string> = {};
  for (const key of PREVIEW_TAG_PRIORITY_KEYS) {
    const value = tags[key]?.trim();
    if (value) out[key] = value;
  }
  for (const [key, value] of Object.entries(tags)) {
    if (Object.keys(out).length >= maxFields) break;
    const trimmed = value?.trim();
    if (!trimmed || out[key]) continue;
    out[key] = trimmed;
  }
  return out;
}

/** Conservative normalized display name for duplicate detection. */
export function normalizePreviewDisplayName(name: string | null | undefined): string {
  if (!name?.trim()) return "";
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type PreviewDuplicateRemoval = {
  normalizedName: string;
  keptId: string;
  keptDisplayName: string;
  removedId: string;
  removedDisplayName: string;
  reason: string;
};

export type PreviewQualityDiagnostics = {
  totalPreviewDocs: number;
  spotsCount: number;
  routesCount: number;
  duplicateNamesRemoved: number;
  invalidActivityDocsCount: number;
  invalidActivitiesFound: string[];
  activityDistribution: Record<string, number>;
  primaryActivityDistribution: Record<string, number>;
  sampleDuplicatesRemoved: PreviewDuplicateRemoval[];
  samplePreviewDocsByActivity: Record<string, PbfCopierPreviewDoc[]>;
  sampleRejectedWeakActivityMappings: Array<{
    id: string;
    displayName: string;
    primaryActivity: string | null;
    activities: string[];
    invalidActivities: string[];
  }>;
  maxAcceptedRequested?: number;
  maxAcceptedApplied?: number;
  acceptedLargeNaturalAreasCount?: number;
  rejectedLargeNaturalAreasCount?: number;
  acceptedProtectedAreasCount?: number;
  rejectedProtectedAreasCount?: number;
  acceptedRouteCandidatesCount?: number;
  rejectedRouteCandidatesCount?: number;
  rawRouteCandidatesSeen?: number;
  trailAssemblyRoutesBuilt?: number;
  builtPublicRouteDocsCount?: number;
  routeMapReadinessCounts?: Record<string, number>;
  routeRejectReasons?: Record<string, number>;
  sampleAcceptedRoutes?: PbfCopierPreviewDoc[];
  sampleRejectedRoutes?: Array<{ name: string; reason: string; tags: Record<string, string> }>;
  sampleAcceptedLargeNaturalAreas?: Array<{ name: string; signals: string[]; tags: Record<string, string> }>;
  sampleRejectedLargeNaturalAreas?: Array<{ name: string; reason: string; tags: Record<string, string> }>;
  sampleAcceptedWeakVisitability?: Array<{ name: string; tier: string; tags: Record<string, string> }>;
  sampleRejectedWeakVisitability?: Array<{ name: string; reason: string; tags: Record<string, string> }>;
  visitabilitySignalDistribution?: Record<string, number>;
  topAcceptedByObjectKind?: Record<string, number>;
  topRejectedByObjectKind?: Record<string, number>;
};

function tagStrength(doc: PbfCopierPreviewDoc): number {
  return Object.keys(doc.sourceTagSample ?? {}).length;
}

function readinessScore(doc: PbfCopierPreviewDoc): number {
  if (doc.mapReadiness === "ready") return 3;
  if (doc.mapReadiness === "review") return 2;
  if (doc.mapReadiness === "hidden") return 0;
  return 1;
}

function activitySpecificityScore(activity: string | null | undefined): number {
  if (!activity) return 0;
  const generic = new Set(["nature", "conservation", "forest", "things", "random", "water"]);
  if (generic.has(activity)) return 1;
  if (activity === "view" || activity === "walking" || activity === "park") return 2;
  return 4;
}

/** Higher = better candidate to keep when names collide. */
export function scorePreviewDocForDedup(doc: PbfCopierPreviewDoc): number {
  let score = 0;
  score += tagStrength(doc) * 4;
  score += readinessScore(doc) * 25;
  score += doc.publicMapEligible ? 20 : 0;
  score += activitySpecificityScore(doc.primaryActivity) * 15;
  score += (doc.activities?.length ?? 0) * 3;
  score += doc.nameInferenceUsed ? -8 : 6;
  if (doc.osmType === "way") score += 4;
  else if (doc.osmType === "relation") score += 3;
  else score += 1;
  return score;
}

export function sanitizePreviewDocActivities(doc: PbfCopierPreviewDoc): PbfCopierPreviewDoc {
  const raw = doc.activities ?? [];
  const valid = dedupeActivities(raw);
  let primary = doc.primaryActivity ? normalizeActivity(doc.primaryActivity) : null;
  if (primary && !valid.includes(primary)) valid.unshift(primary);

  // Demote weak primaries (e.g. nature) — do not re-rank flat-weight activity lists or offroading wins spuriously.
  if (primary === "nature" && valid.length > 1) {
    const weights: ActivityWeightMap = {};
    for (const activity of valid) weights[activity] = 1;
    primary = pickPrimaryActivity(weights) ?? valid.find((a) => a !== "nature") ?? primary;
  }

  if (!primary && valid.length) {
    primary = valid[0] ?? null;
  }

  const alignedCategory =
    primary ?? (doc.primaryCategory ? normalizeActivity(doc.primaryCategory) : null) ?? doc.primaryCategory;

  return {
    ...doc,
    primaryActivity: primary,
    primaryCategory: alignedCategory ?? doc.primaryCategory,
    activities: dedupeActivities(valid),
  };
}

export function dedupePreviewDocsByDisplayName(docs: PbfCopierPreviewDoc[]): {
  kept: PbfCopierPreviewDoc[];
  removed: PreviewDuplicateRemoval[];
} {
  const byName = new Map<string, PbfCopierPreviewDoc[]>();
  for (const doc of docs) {
    const key = normalizePreviewDisplayName(doc.displayName);
    if (!key) continue;
    const bucket = byName.get(key) ?? [];
    bucket.push(doc);
    byName.set(key, bucket);
  }

  const kept: PbfCopierPreviewDoc[] = [];
  const removed: PreviewDuplicateRemoval[] = [];
  const keptIds = new Set<string>();

  for (const doc of docs) {
    const key = normalizePreviewDisplayName(doc.displayName);
    if (!key) {
      kept.push(doc);
      keptIds.add(doc.id);
      continue;
    }
    const bucket = byName.get(key) ?? [doc];
    if (bucket.length === 1) {
      if (!keptIds.has(doc.id)) {
        kept.push(doc);
        keptIds.add(doc.id);
      }
      continue;
    }
    const winner = [...bucket].sort((a, b) => scorePreviewDocForDedup(b) - scorePreviewDocForDedup(a))[0]!;
    if (doc.id === winner.id) {
      if (!keptIds.has(doc.id)) {
        kept.push(doc);
        keptIds.add(doc.id);
      }
      continue;
    }
    removed.push({
      normalizedName: key,
      keptId: winner.id,
      keptDisplayName: winner.displayName,
      removedId: doc.id,
      removedDisplayName: doc.displayName,
      reason: "duplicate_normalized_display_name",
    });
  }

  return { kept, removed };
}

const NEAR_DUPLICATE_SPOT_METERS = 75;

/** Generic generated outdoor labels must not collapse across a whole bbox. */
const GENERIC_OUTDOOR_DEDUPE_NAMES = new Set([
  "beach",
  "park",
  "nature reserve",
  "trail",
  "trailhead",
  "trailhead parking",
  "shelter",
  "picnic shelter",
  "pavilion",
  "playground",
  "viewpoint",
  "picnic area",
  "water access",
  "swimming area",
  "campground",
  "summit",
  "sports court",
  "sports field",
  "skate park",
  "boat launch",
  "waterfall",
  "spring",
  "tennis court",
  "basketball court",
  "pickleball court",
]);

function isGenericOutdoorDedupeName(key: string): boolean {
  return GENERIC_OUTDOOR_DEDUPE_NAMES.has(key);
}

/** Hide weaker visible spots/routes that duplicate a stronger item with the same normalized name nearby. */
export function dedupeNearVisiblePreviewItems<T extends PbfCopierPreviewDoc & { filteredOut?: boolean }>(
  items: T[]
): { items: T[]; duplicatesHidden: number } {
  const suppressIds = new Set<string>();

  const visibleSpots = items.filter((d) => !d.filteredOut && d.kind === "unexplored_spot");
  const keptSpots = [...visibleSpots].sort((a, b) => scorePreviewDocForDedup(b) - scorePreviewDocForDedup(a));
  const winners: typeof visibleSpots = [];

  for (const spot of keptSpots) {
    const key = normalizePreviewDisplayName(spot.displayName);
    if (!key || isGenericOutdoorDedupeName(key) || spot.warnings?.includes("v2_generated_outdoor_name")) {
      winners.push(spot);
      continue;
    }
    const dup = winners.find((existing) => {
      if (normalizePreviewDisplayName(existing.displayName) !== key) return false;
      if (
        spot.lat == null ||
        spot.lng == null ||
        existing.lat == null ||
        existing.lng == null
      ) {
        return false;
      }
      return (
        haversineMeters({ lat: existing.lat, lng: existing.lng }, { lat: spot.lat, lng: spot.lng }) <=
        NEAR_DUPLICATE_SPOT_METERS
      );
    });
    if (dup) {
      suppressIds.add(spot.id);
      continue;
    }
    winners.push(spot);
  }

  if (suppressIds.size === 0) return { items, duplicatesHidden: 0 };

  const next = items.map((item) => {
    if (!suppressIds.has(item.id) || item.filteredOut) return item;
    return {
      ...item,
      filteredOut: true,
      filteredBy: [...new Set([...(item.filteredBy ?? []), "address_only"])],
      filterReason: [item.filterReason, "near_duplicate_preview"].filter(Boolean).join("; "),
    };
  });

  return { items: next, duplicatesHidden: suppressIds.size };
}

export function partitionInvalidActivities(doc: PbfCopierPreviewDoc): {
  invalid: string[];
  valid: LocavaActivity[];
} {
  const invalid: string[] = [];
  const valid: LocavaActivity[] = [];
  for (const activity of doc.activities ?? []) {
    if (isLocavaActivity(activity)) valid.push(activity);
    else invalid.push(activity);
  }
  if (doc.primaryActivity && !isLocavaActivity(doc.primaryActivity)) {
    invalid.push(doc.primaryActivity);
  }
  return { invalid: [...new Set(invalid)], valid: dedupeActivities(valid) };
}

export function buildPreviewQualityDiagnostics(docs: PbfCopierPreviewDoc[]): PreviewQualityDiagnostics {
  const activityDistribution: Record<string, number> = {};
  const primaryActivityDistribution: Record<string, number> = {};
  const invalidActivitiesFound = new Set<string>();
  let invalidActivityDocsCount = 0;
  const sampleRejectedWeakActivityMappings: PreviewQualityDiagnostics["sampleRejectedWeakActivityMappings"] = [];

  for (const doc of docs) {
    for (const activity of doc.activities ?? []) {
      activityDistribution[activity] = (activityDistribution[activity] ?? 0) + 1;
    }
    const primary = doc.primaryActivity ?? "(none)";
    primaryActivityDistribution[primary] = (primaryActivityDistribution[primary] ?? 0) + 1;
    const { invalid } = partitionInvalidActivities(doc);
    if (invalid.length > 0) {
      invalidActivityDocsCount += 1;
      for (const bad of invalid) invalidActivitiesFound.add(bad);
      if (sampleRejectedWeakActivityMappings.length < 25) {
        sampleRejectedWeakActivityMappings.push({
          id: doc.id,
          displayName: doc.displayName,
          primaryActivity: doc.primaryActivity,
          activities: doc.activities ?? [],
          invalidActivities: invalid,
        });
      }
    }
  }

  const samplePreviewDocsByActivity: Record<string, PbfCopierPreviewDoc[]> = {};
  for (const doc of docs) {
    const key = doc.primaryActivity ?? "unknown";
    const bucket = samplePreviewDocsByActivity[key] ?? [];
    if (bucket.length < 3) bucket.push(doc);
    samplePreviewDocsByActivity[key] = bucket;
  }

  return {
    totalPreviewDocs: docs.length,
    spotsCount: docs.filter((d) => d.kind === "unexplored_spot").length,
    routesCount: docs.filter((d) => d.kind === "unexplored_route").length,
    duplicateNamesRemoved: 0,
    invalidActivityDocsCount,
    invalidActivitiesFound: [...invalidActivitiesFound].sort(),
    activityDistribution: Object.fromEntries(
      Object.entries(activityDistribution).sort((a, b) => b[1] - a[1])
    ),
    primaryActivityDistribution: Object.fromEntries(
      Object.entries(primaryActivityDistribution).sort((a, b) => b[1] - a[1])
    ),
    sampleDuplicatesRemoved: [],
    samplePreviewDocsByActivity,
    sampleRejectedWeakActivityMappings,
  };
}

function isLargeNaturalDoc(doc: PbfCopierPreviewDoc): boolean {
  const tags = doc.sourceTagSample ?? {};
  return evaluateOsmVisitability(tags, { name: doc.displayName }).isLargeNaturalOrProtectedArea;
}

export function enrichPreviewQualityDiagnostics(
  diagnostics: PreviewQualityDiagnostics,
  input: {
    maxAcceptedRequested?: number;
    maxAcceptedApplied?: number;
    routeTrailDiagnostics?: {
      rawRouteCandidatesSeen?: number;
      trailAssemblyRoutesBuilt?: number;
      builtPublicRouteDocsCount?: number;
      routeMapReadinessCounts?: Record<string, number>;
      acceptedRoutePreviewCount?: number;
      rejectedRouteReasons?: Record<string, number>;
      sampleAcceptedRoutes?: PbfCopierPreviewDoc[];
      sampleRejectedRoutes?: Array<{ name: string; reason: string; tags: Record<string, string> }>;
    };
    rejectedSamples?: Array<{ name?: string | null; rejectionReason?: string; topTags?: Record<string, string> }>;
    previewDocs: PbfCopierPreviewDoc[];
  }
): PreviewQualityDiagnostics {
  const visitDist: Record<string, number> = {};
  const acceptedByKind: Record<string, number> = {};
  const sampleAcceptedLarge: NonNullable<PreviewQualityDiagnostics["sampleAcceptedLargeNaturalAreas"]> = [];
  const sampleAcceptedWeak: NonNullable<PreviewQualityDiagnostics["sampleAcceptedWeakVisitability"]> = [];
  let acceptedLarge = 0;
  let acceptedProtected = 0;

  for (const doc of input.previewDocs) {
    const tags = doc.sourceTagSample ?? {};
    const visit = evaluateOsmVisitability(tags, { name: doc.displayName });
    for (const signal of visit.signals) visitDist[signal] = (visitDist[signal] ?? 0) + 1;
    acceptedByKind[visit.objectKind] = (acceptedByKind[visit.objectKind] ?? 0) + 1;
    if (isLargeNaturalDoc(doc)) {
      acceptedLarge += 1;
      if (sampleAcceptedLarge.length < 15) sampleAcceptedLarge.push({ name: doc.displayName, signals: visit.signals, tags });
    }
    if (tags.boundary === "protected_area" || tags.leisure === "nature_reserve") acceptedProtected += 1;
    if (visit.visitabilityTier === "weak" && sampleAcceptedWeak.length < 15) {
      sampleAcceptedWeak.push({ name: doc.displayName, tier: visit.visitabilityTier, tags });
    }
  }

  const rejectedLarge: NonNullable<PreviewQualityDiagnostics["sampleRejectedLargeNaturalAreas"]> = [];
  const rejectedWeak: NonNullable<PreviewQualityDiagnostics["sampleRejectedWeakVisitability"]> = [];
  const rejectedByKind: Record<string, number> = {};
  let rejectedLargeCount = 0;
  let rejectedProtectedCount = 0;

  for (const sample of input.rejectedSamples ?? []) {
    const tags = sample.topTags ?? {};
    const visit = evaluateOsmVisitability(tags, { name: sample.name ?? undefined });
    rejectedByKind[visit.objectKind] = (rejectedByKind[visit.objectKind] ?? 0) + 1;
    const reason = sample.rejectionReason ?? "unknown";
    if (reason === "large_natural_area_no_visitor_signal") {
      rejectedLargeCount += 1;
      if (rejectedLarge.length < 15) rejectedLarge.push({ name: sample.name ?? "(unnamed)", reason, tags });
    }
    if (tags.boundary === "protected_area" || tags.leisure === "nature_reserve") rejectedProtectedCount += 1;
    if (visit.visitabilityTier === "none" || visit.visitabilityTier === "weak") {
      if (rejectedWeak.length < 15) rejectedWeak.push({ name: sample.name ?? "(unnamed)", reason, tags });
    }
  }

  const rtd = input.routeTrailDiagnostics ?? {};
  return {
    ...diagnostics,
    maxAcceptedRequested: input.maxAcceptedRequested,
    maxAcceptedApplied: input.maxAcceptedApplied,
    acceptedLargeNaturalAreasCount: acceptedLarge,
    rejectedLargeNaturalAreasCount: rejectedLargeCount,
    acceptedProtectedAreasCount: acceptedProtected,
    rejectedProtectedAreasCount: rejectedProtectedCount,
    acceptedRouteCandidatesCount: rtd.acceptedRoutePreviewCount ?? diagnostics.routesCount,
    rejectedRouteCandidatesCount: Object.values(rtd.rejectedRouteReasons ?? {}).reduce((a, b) => a + b, 0),
    rawRouteCandidatesSeen: rtd.rawRouteCandidatesSeen,
    trailAssemblyRoutesBuilt: rtd.trailAssemblyRoutesBuilt,
    builtPublicRouteDocsCount: rtd.builtPublicRouteDocsCount,
    routeMapReadinessCounts: rtd.routeMapReadinessCounts,
    routeRejectReasons: rtd.rejectedRouteReasons,
    sampleAcceptedRoutes:
      rtd.sampleAcceptedRoutes ?? input.previewDocs.filter((d) => d.kind === "unexplored_route").slice(0, 10),
    sampleRejectedRoutes: rtd.sampleRejectedRoutes,
    sampleAcceptedLargeNaturalAreas: sampleAcceptedLarge,
    sampleRejectedLargeNaturalAreas: rejectedLarge,
    sampleAcceptedWeakVisitability: sampleAcceptedWeak,
    sampleRejectedWeakVisitability: rejectedWeak,
    visitabilitySignalDistribution: visitDist,
    topAcceptedByObjectKind: acceptedByKind,
    topRejectedByObjectKind: rejectedByKind,
  };
}

export function finalizePreviewDocsQuality(
  docs: PbfCopierPreviewDoc[],
  options?: { skipDisplayNameDedupe?: boolean }
): {
  previewDocs: PbfCopierPreviewDoc[];
  diagnostics: PreviewQualityDiagnostics;
} {
  const sanitized = docs.map(sanitizePreviewDocActivities);
  const { kept, removed } = options?.skipDisplayNameDedupe
    ? { kept: sanitized, removed: [] as PreviewDuplicateRemoval[] }
    : dedupePreviewDocsByDisplayName(sanitized);
  const diagnostics = buildPreviewQualityDiagnostics(kept);
  diagnostics.duplicateNamesRemoved = removed.length;
  diagnostics.sampleDuplicatesRemoved = removed.slice(0, 25);
  return { previewDocs: kept, diagnostics };
}

export function assertPreviewDocsQuality(docs: PbfCopierPreviewDoc[]): {
  ok: boolean;
  duplicateNames: string[];
  invalidActivityCount: number;
} {
  const names = docs.map((d) => normalizePreviewDisplayName(d.displayName)).filter(Boolean);
  const duplicateNames = names.filter((n, i) => names.indexOf(n) !== i);
  let invalidActivityCount = 0;
  for (const doc of docs) {
    const { invalid } = partitionInvalidActivities(doc);
    if (invalid.length > 0) invalidActivityCount += 1;
  }
  return {
    ok: duplicateNames.length === 0 && invalidActivityCount === 0,
    duplicateNames: [...new Set(duplicateNames)],
    invalidActivityCount,
  };
}

export { CANONICAL_SET };
