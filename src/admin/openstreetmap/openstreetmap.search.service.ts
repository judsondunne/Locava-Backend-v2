import type { OpenStreetMapClassificationResult } from "./openstreetmap.service.js";
import { getOpenStreetMapClassificationRun } from "./openstreetmapRunStore.js";
import { buildLocavaFilterAudit } from "../../lib/inventory/inventoryFilterAudit.js";

export type OpenStreetMapSearchResult = {
  decision: "accepted" | "rejected" | "duplicate";
  kind: "spot" | "route" | "raw";
  name: string | null;
  sourceKey: string;
  sourceType: string;
  rawTypeLabel: string;
  category: string | null;
  activity: string | null;
  lat: number | null;
  lng: number | null;
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null;
  pointCount: number | null;
  distanceMeters: number | null;
  distanceMiles: number | null;
  locavaScore: number;
  confidence: string | null;
  displayPriority: string | null;
  showAtZoom: number | null;
  reason: string | null;
  rejectionReason: string | null;
  tagSignals: string[];
  negativeSignals: string[];
  topTags: Record<string, string>;
  geometryPreview: {
    type: "point" | "line" | "multiline" | "none";
    coordinates?: Array<{ lat: number; lng: number }>;
    segments?: Array<Array<{ lat: number; lng: number }>>;
  };
  suspicious?: boolean;
  displayName?: string | null;
  rawName?: string | null;
  anchorType?: string | null;
  nameQuality?: string | null;
  areaCenter?: { lat: number; lng: number } | null;
  childHighlights?: Array<{ lat: number; lng: number; type: string; displayName: string }>;
  legalDisplayLabel?: string | null;
  offroadCategory?: string | null;
  offroadConfidence?: string | null;
  accessStatus?: string | null;
  placeKind?: string | null;
  parentPlaceName?: string | null;
  hasParking?: boolean;
  selectedParking?: { lat: number; lng: number; name?: string | null } | null;
  selectedTrailhead?: { lat: number; lng: number; name?: string | null } | null;
  subtitle?: string | null;
  primaryActivity?: string | null;
  activities?: string[];
  titleQuality?: string | null;
  activityConfidence?: string | null;
  mapReadiness?: string | null;
  readinessReason?: string | null;
  searchableAliases?: string[];
  searchText?: string | null;
};

export type OpenStreetMapSearchResponse = {
  runId: string;
  total: number;
  limit: number;
  offset: number;
  query: string;
  filters: Record<string, unknown>;
  results: OpenStreetMapSearchResult[];
};

function matchesQuery(row: OpenStreetMapSearchResult, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase().trim();
  const tokens = ql.split(/\s+/).filter(Boolean);
  const fields = [
    row.searchText,
    row.name,
    row.displayName,
    row.subtitle,
    row.primaryActivity,
    row.activity,
    row.category,
    row.readinessReason,
    ...(row.activities ?? []),
    ...(row.searchableAliases ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (fields.includes(ql)) return true;
  if (tokens.length > 1) return tokens.every((t) => fields.includes(t));
  return fields.includes(ql) || JSON.stringify(row).toLowerCase().includes(ql);
}

function isSuspicious(row: OpenStreetMapSearchResult): boolean {
  const junkCats = new Set(["path", "track", "cycleway", "footway", "unclassified", "tertiary", "primary", "secondary", "trunk"]);
  if (row.kind === "spot" && row.category && junkCats.has(row.category)) return true;
  if (row.kind === "route" && row.activity && junkCats.has(row.activity)) return true;
  if (row.kind === "route" && (row.distanceMeters ?? 0) < 100) return true;
  return false;
}

function flattenRun(run: OpenStreetMapClassificationResult): OpenStreetMapSearchResult[] {
  const out: OpenStreetMapSearchResult[] = [];

  for (const spot of run.acceptedSpots) {
    out.push({
      decision: "accepted",
      kind: "spot",
      name: spot.displayName ?? spot.name,
      displayName: spot.displayName ?? spot.name,
      rawName: spot.rawName ?? spot.name,
      anchorType: spot.primaryAnchor?.anchorType ?? null,
      nameQuality: spot.nameQuality ?? null,
      areaCenter: spot.areaCenter ?? null,
      childHighlights: spot.childHighlights?.map((c) => ({ lat: c.lat, lng: c.lng, type: c.type, displayName: c.displayName })),
      placeKind: spot.placeKind ?? null,
      parentPlaceName: spot.parentPlaceName ?? null,
      hasParking: spot.parking?.hasParking ?? false,
      selectedParking: spot.parking?.selectedParking
        ? { lat: spot.parking.selectedParking.lat, lng: spot.parking.selectedParking.lng, name: spot.parking.selectedParking.name }
        : null,
      selectedTrailhead: spot.trailhead?.selectedTrailhead
        ? { lat: spot.trailhead.selectedTrailhead.lat, lng: spot.trailhead.selectedTrailhead.lng, name: spot.trailhead.selectedTrailhead.name }
        : null,
      sourceKey: spot.sourceKey,
      sourceType: spot.sourceType,
      rawTypeLabel: spot.tags.amenity ? `amenity=${spot.tags.amenity}` : spot.category,
      category: spot.category,
      activity: spot.primaryActivity ?? spot.activities?.[0] ?? null,
      primaryActivity: spot.primaryActivity ?? null,
      activities: spot.activities ?? [],
      subtitle: spot.subtitle ?? null,
      titleQuality: spot.titleQuality ?? null,
      activityConfidence: spot.activityConfidence ?? null,
      mapReadiness: spot.mapReadiness ?? null,
      readinessReason: spot.readinessReason ?? null,
      searchableAliases: spot.searchableAliases ?? [],
      searchText: spot.searchText ?? null,
      lat: spot.lat,
      lng: spot.lng,
      bbox: spot.bbox,
      pointCount: 1,
      distanceMeters: null,
      distanceMiles: null,
      locavaScore: spot.locavaScore,
      confidence: spot.confidence,
      displayPriority: spot.displayPriority,
      showAtZoom: spot.showAtZoom,
      reason: spot.classificationReason,
      rejectionReason: null,
      tagSignals: spot.tagSignals,
      negativeSignals: spot.negativeSignals,
      topTags: Object.fromEntries(Object.entries(spot.tags).slice(0, 10)),
      geometryPreview: { type: "point", coordinates: [{ lat: spot.lat, lng: spot.lng }] },
      suspicious: isSuspicious({
        kind: "spot",
        category: spot.category,
      } as OpenStreetMapSearchResult),
    });
  }

  for (const route of run.acceptedRoutes) {
    out.push({
      decision: "accepted",
      kind: "route",
      name: route.name,
      sourceKey: route.sourceKey,
      sourceType: route.sourceType,
      rawTypeLabel: route.tags.highway ? `highway=${route.tags.highway}` : `route=${route.activity}`,
      category: null,
      activity: route.primaryActivity ?? route.activity,
      primaryActivity: route.primaryActivity ?? route.activity,
      activities: route.activities ?? [],
      subtitle: route.subtitle ?? null,
      titleQuality: route.titleQuality ?? null,
      activityConfidence: route.activityConfidence ?? null,
      mapReadiness: route.mapReadiness ?? null,
      readinessReason: route.readinessReason ?? null,
      searchableAliases: route.searchableAliases ?? [],
      searchText: route.searchText ?? null,
      legalDisplayLabel: route.offroad?.legalDisplayLabel ?? null,
      offroadCategory: route.offroad?.offroadCategory ?? null,
      offroadConfidence: route.offroad?.offroadConfidence ?? null,
      accessStatus: route.offroad?.accessStatus ?? null,
      placeKind: route.placeKind ?? null,
      parentPlaceName: route.parentPlaceName ?? null,
      hasParking: Boolean(route.selectedParking),
      selectedParking: route.selectedParking
        ? { lat: route.selectedParking.lat, lng: route.selectedParking.lng, name: route.selectedParking.name }
        : null,
      selectedTrailhead: route.selectedTrailhead
        ? { lat: route.selectedTrailhead.lat, lng: route.selectedTrailhead.lng, name: route.selectedTrailhead.name }
        : null,
      lat: route.center.lat,
      lng: route.center.lng,
      bbox: route.bbox,
      pointCount: route.coordinates?.length ?? route.segments?.flat().length ?? null,
      distanceMeters: route.distanceMeters,
      distanceMiles: route.distanceMiles,
      locavaScore: route.locavaScore,
      confidence: route.confidence,
      displayPriority: route.displayPriority,
      showAtZoom: route.showAtZoom,
      reason: route.classificationReason,
      rejectionReason: null,
      tagSignals: route.tagSignals,
      negativeSignals: route.negativeSignals,
      topTags: Object.fromEntries(Object.entries(route.tags).slice(0, 10)),
      geometryPreview:
        route.segments && route.segments.length > 0
          ? route.segments.length === 1
            ? { type: "line", coordinates: route.segments[0]! }
            : { type: "multiline", segments: route.segments }
          : route.coordinates
            ? { type: "line", coordinates: route.coordinates }
            : { type: "none" },
      suspicious: isSuspicious({
        kind: "route",
        activity: route.activity,
        distanceMeters: route.distanceMeters,
      } as OpenStreetMapSearchResult),
    });
  }

  for (const rej of run.rejected) {
    out.push({
      decision: "rejected",
      kind: rej.coordinates && rej.coordinates.length >= 2 ? "route" : "spot",
      name: rej.name,
      sourceKey: rej.sourceKey,
      sourceType: rej.sourceType,
      rawTypeLabel: rej.rawTypeLabel,
      category: null,
      activity: null,
      lat: rej.lat ?? null,
      lng: rej.lng ?? null,
      bbox: null,
      pointCount: rej.coordinates?.length ?? null,
      distanceMeters: null,
      distanceMiles: null,
      locavaScore: rej.locavaScore,
      confidence: null,
      displayPriority: null,
      showAtZoom: null,
      reason: null,
      rejectionReason: rej.rejectionReason,
      tagSignals: rej.tagSignals,
      negativeSignals: rej.negativeSignals,
      topTags: rej.topTags,
      geometryPreview: rej.coordinates
        ? { type: "line", coordinates: rej.coordinates }
        : rej.lat != null && rej.lng != null
          ? { type: "point", coordinates: [{ lat: rej.lat, lng: rej.lng }] }
          : { type: "none" },
    });
  }

  for (const dup of run.diagnostics.samples.duplicates ?? []) {
    out.push({
      decision: "duplicate",
      kind: "raw",
      name: String(dup.suppressed ?? dup.kept ?? "duplicate"),
      sourceKey: String(dup.suppressed ?? dup.kept ?? ""),
      sourceType: "duplicate",
      rawTypeLabel: String(dup.reason ?? "duplicate"),
      category: null,
      activity: null,
      lat: null,
      lng: null,
      bbox: null,
      pointCount: null,
      distanceMeters: null,
      distanceMiles: null,
      locavaScore: 0,
      confidence: null,
      displayPriority: null,
      showAtZoom: null,
      reason: String(dup.reason ?? ""),
      rejectionReason: null,
      tagSignals: [],
      negativeSignals: [],
      topTags: {},
      geometryPreview: { type: "none" },
    });
  }

  return out;
}

export function searchOpenStreetMapClassification(input: {
  runId?: string;
  q?: string;
  decision?: "all" | "accepted" | "rejected" | "duplicate";
  kind?: "all" | "spot" | "route" | "raw";
  category?: string;
  activity?: string;
  displayPriority?: string;
  confidence?: string;
  rejectionReason?: string;
  rawType?: string;
  minScore?: number;
  maxScore?: number;
  hasGeometry?: boolean;
  onlySuspicious?: boolean;
  onlyTrails?: boolean;
  onlyFood?: boolean;
  onlyNature?: boolean;
  onlySwimmingBeach?: boolean;
  onlyWeakNames?: boolean;
  onlyAnchoredParents?: boolean;
  offroadCategory?: string;
  offroadConfidence?: string;
  accessStatus?: string;
  hasParking?: boolean;
  missingParking?: boolean;
  placeKind?: string;
  mapReadiness?: string;
  titleQuality?: string;
  activityConfidence?: string;
  primaryActivity?: string;
  limit?: number;
  offset?: number;
}): OpenStreetMapSearchResponse | null {
  const run = getOpenStreetMapClassificationRun(input.runId);
  if (!run) return null;

  let rows = flattenRun(run);
  const q = input.q?.trim() ?? "";

  if (input.decision && input.decision !== "all") {
    rows = rows.filter((r) => r.decision === input.decision);
  }
  if (input.kind && input.kind !== "all") {
    rows = rows.filter((r) => r.kind === input.kind);
  }
  if (input.category) rows = rows.filter((r) => r.category === input.category);
  if (input.activity) rows = rows.filter((r) => r.activity === input.activity);
  if (input.displayPriority) rows = rows.filter((r) => r.displayPriority === input.displayPriority);
  if (input.confidence) rows = rows.filter((r) => r.confidence === input.confidence);
  if (input.rejectionReason) rows = rows.filter((r) => r.rejectionReason === input.rejectionReason);
  if (input.rawType) rows = rows.filter((r) => r.rawTypeLabel.includes(input.rawType as string));
  if (input.minScore !== undefined) rows = rows.filter((r) => r.locavaScore >= input.minScore!);
  if (input.maxScore !== undefined) rows = rows.filter((r) => r.locavaScore <= input.maxScore!);
  if (input.hasGeometry) rows = rows.filter((r) => r.geometryPreview.type !== "none");
  if (input.onlySuspicious) rows = rows.filter((r) => r.suspicious);
  if (input.onlyTrails) rows = rows.filter((r) => r.kind === "route" || /path|trail|footway|hiking/.test(`${r.activity} ${r.rawTypeLabel}`));
  if (input.onlyFood) rows = rows.filter((r) => /cafe|restaurant|ice_cream|pub|marketplace|fast_food/.test(`${r.category} ${r.rawTypeLabel}`));
  if (input.onlyNature) rows = rows.filter((r) => /park|peak|viewpoint|waterfall|wetland|nature|water|beach|swim/.test(`${r.category} ${r.rawTypeLabel}`));
  if (input.onlySwimmingBeach) rows = rows.filter((r) => r.category && /beach|swimming/.test(r.category));
  if (input.onlyWeakNames) rows = rows.filter((r) => r.nameQuality === "weak_generic" || r.nameQuality === "unnamed");
  if (input.onlyAnchoredParents) rows = rows.filter((r) => r.anchorType && r.anchorType !== "area_center");
  if (input.offroadCategory) rows = rows.filter((r) => r.offroadCategory === input.offroadCategory);
  if (input.offroadConfidence) rows = rows.filter((r) => r.offroadConfidence === input.offroadConfidence);
  if (input.accessStatus) rows = rows.filter((r) => r.accessStatus === input.accessStatus);
  if (input.hasParking === true) rows = rows.filter((r) => r.hasParking);
  if (input.missingParking === true) rows = rows.filter((r) => !r.hasParking);
  if (input.placeKind) rows = rows.filter((r) => r.placeKind === input.placeKind);
  if (input.mapReadiness) rows = rows.filter((r) => r.mapReadiness === input.mapReadiness);
  if (input.titleQuality) rows = rows.filter((r) => r.titleQuality === input.titleQuality);
  if (input.activityConfidence) rows = rows.filter((r) => r.activityConfidence === input.activityConfidence);
  if (input.primaryActivity) rows = rows.filter((r) => r.primaryActivity === input.primaryActivity || r.activity === input.primaryActivity);

  rows = rows.filter((r) => matchesQuery(r, q));

  // Accepted first, then rejected
  rows.sort((a, b) => {
    const order = { accepted: 0, duplicate: 1, rejected: 2 };
    const da = order[a.decision] ?? 3;
    const db = order[b.decision] ?? 3;
    if (da !== db) return da - db;
    if (a.kind === "spot" && b.kind !== "spot") return -1;
    if (b.kind === "spot" && a.kind !== "spot") return 1;
    return (b.locavaScore ?? 0) - (a.locavaScore ?? 0);
  });

  const total = rows.length;
  const limit = input.limit ?? 200;
  const offset = input.offset ?? 0;
  const page = rows.slice(offset, offset + limit);

  return {
    runId: run.runId,
    total,
    limit,
    offset,
    query: q,
    filters: { ...input },
    results: page,
  };
}

export function buildPresetSearch(
  preset:
    | "trail_debug"
    | "suspicious_accepted"
    | "possible_misses"
    | "swimming_beaches"
    | "weak_names"
    | "anchored_parents"
    | "name_only_rejections"
    | "private_rejections"
    | "viewpoints_waterfalls"
    | "remaining_concerns"
    | "offroading"
    | "offroad_class4"
    | "offroad_legal_trail"
    | "offroad_class6"
    | "offroad_candidates"
    | "offroad_private_rejected"
    | "missing_parking"
    | "parent_places"
    | "activity_qa"
    | "weak_activity"
    | "niche_ready"
    | "bad_titles"
    | "generated_titles"
    | "natural_feature_fixes"
    | "ready_low_confidence"
    | "hidden_niche"
    | "search_alias_preview",
  runId?: string,
  limit?: number
) {
  const offroadLimit = limit ?? 500;
  if (preset === "activity_qa") {
    return searchOpenStreetMapClassification({ runId, decision: "accepted", mapReadiness: "ready", limit: 200 });
  }
  if (preset === "weak_activity") {
    return searchOpenStreetMapClassification({ runId, decision: "accepted", activityConfidence: "low", limit: 200 });
  }
  if (preset === "niche_ready") {
    const run = getOpenStreetMapClassificationRun(runId);
    if (!run) return null;
    const samples = run.diagnostics.activityTitleDiagnostics?.nicheReadyItems ?? [];
    const q = samples[0]?.name ? String(samples[0].name).split(" ")[0] : "nature";
    return searchOpenStreetMapClassification({ runId, decision: "accepted", q, limit: 200 });
  }
  if (preset === "bad_titles") {
    return searchOpenStreetMapClassification({ runId, decision: "accepted", titleQuality: "bad", limit: 200 });
  }
  if (preset === "generated_titles") {
    return searchOpenStreetMapClassification({ runId, decision: "accepted", titleQuality: "generated", limit: 200 });
  }
  if (preset === "natural_feature_fixes") {
    const run = getOpenStreetMapClassificationRun(runId);
    if (!run) return null;
    const q = "natural";
    return searchOpenStreetMapClassification({ runId, decision: "accepted", q, limit: 200 });
  }
  if (preset === "ready_low_confidence") {
    return searchOpenStreetMapClassification({ runId, decision: "accepted", mapReadiness: "review", limit: 200 });
  }
  if (preset === "hidden_niche") {
    return searchOpenStreetMapClassification({ runId, decision: "accepted", mapReadiness: "hidden", q: "nature", limit: 200 });
  }
  if (preset === "search_alias_preview") {
    return searchOpenStreetMapClassification({ runId, decision: "accepted", q: "sunset view", limit: 200 });
  }
  if (preset === "offroading") {
    return searchOpenStreetMapClassification({ runId, activity: "offroading", decision: "accepted", limit: offroadLimit });
  }
  if (preset === "offroad_class4") {
    return searchOpenStreetMapClassification({ runId, activity: "offroading", offroadCategory: "class4_road", limit: offroadLimit });
  }
  if (preset === "offroad_legal_trail") {
    return searchOpenStreetMapClassification({ runId, activity: "offroading", offroadCategory: "legal_trail", limit: offroadLimit });
  }
  if (preset === "offroad_class6") {
    return searchOpenStreetMapClassification({ runId, activity: "offroading", offroadCategory: "class6_road", limit: offroadLimit });
  }
  if (preset === "offroad_candidates") {
    return searchOpenStreetMapClassification({ runId, activity: "offroading", offroadConfidence: "candidate", limit: offroadLimit });
  }
  if (preset === "offroad_private_rejected") {
    return searchOpenStreetMapClassification({ runId, decision: "rejected", q: "private_access offroad", limit: 200 });
  }
  if (preset === "missing_parking") {
    return searchOpenStreetMapClassification({ runId, kind: "route", missingParking: true, limit: 200 });
  }
  if (preset === "parent_places") {
    return searchOpenStreetMapClassification({ runId, placeKind: "parent_place", decision: "accepted", limit: 200 });
  }
  if (preset === "trail_debug") {
    return searchOpenStreetMapClassification({ runId, kind: "route", decision: "accepted", onlyTrails: true, limit: 200 });
  }
  if (preset === "suspicious_accepted") {
    return searchOpenStreetMapClassification({ runId, decision: "accepted", onlySuspicious: true, limit: 200 });
  }
  if (preset === "swimming_beaches") {
    return searchOpenStreetMapClassification({ runId, decision: "accepted", onlySwimmingBeach: true, limit: 200 });
  }
  if (preset === "weak_names") {
    return searchOpenStreetMapClassification({ runId, decision: "accepted", onlyWeakNames: true, limit: 200 });
  }
  if (preset === "anchored_parents") {
    return searchOpenStreetMapClassification({ runId, decision: "accepted", onlyAnchoredParents: true, limit: 200 });
  }
  if (preset === "name_only_rejections") {
    return searchOpenStreetMapClassification({ runId, decision: "rejected", rejectionReason: "name_only_no_locava_signal", limit: 200 });
  }
  if (preset === "private_rejections") {
    return searchOpenStreetMapClassification({ runId, decision: "rejected", rejectionReason: "private_access", limit: 200 });
  }
  if (preset === "viewpoints_waterfalls") {
    return searchOpenStreetMapClassification({ runId, decision: "accepted", q: "waterfall viewpoint", limit: 200 });
  }
  if (preset === "remaining_concerns") {
    const run = getOpenStreetMapClassificationRun(runId);
    if (!run) return null;
    const concerns = run.diagnostics.finalPolishDiagnostics?.remainingConcerns ?? [];
    return searchOpenStreetMapClassification({ runId, decision: "all", q: concerns[0]?.split(":")[1] ?? "", limit: 200 });
  }
  const run = getOpenStreetMapClassificationRun(runId);
  if (!run) return null;
  const audit = buildLocavaFilterAudit({ spots: run.acceptedSpots, routes: run.acceptedRoutes, rejected: run.rejected });
  return searchOpenStreetMapClassification({
    runId,
    decision: "rejected",
    q: "",
    limit: 200,
    ...(audit.rejectedLikelyGoodNature.length > 0 ? { onlyNature: true } : {}),
  });
}
