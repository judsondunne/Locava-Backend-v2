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
  const hay = JSON.stringify(row).toLowerCase();
  return hay.includes(q.toLowerCase());
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
      name: spot.name,
      sourceKey: spot.sourceKey,
      sourceType: spot.sourceType,
      rawTypeLabel: spot.tags.amenity ? `amenity=${spot.tags.amenity}` : spot.category,
      category: spot.category,
      activity: null,
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
      activity: route.activity,
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
        route.geometryType === "MultiLineString" && route.segments
          ? { type: "multiline", segments: route.segments }
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
  if (input.onlyNature) rows = rows.filter((r) => /park|peak|viewpoint|waterfall|wetland|nature|water/.test(`${r.category} ${r.rawTypeLabel}`));

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

export function buildPresetSearch(preset: "trail_debug" | "suspicious_accepted" | "possible_misses", runId?: string) {
  if (preset === "trail_debug") {
    return searchOpenStreetMapClassification({ runId, kind: "route", decision: "accepted", onlyTrails: true, limit: 200 });
  }
  if (preset === "suspicious_accepted") {
    return searchOpenStreetMapClassification({ runId, decision: "accepted", onlySuspicious: true, limit: 200 });
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
