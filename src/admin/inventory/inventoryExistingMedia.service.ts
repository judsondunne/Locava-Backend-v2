import type { InventoryRoute, InventorySpot } from "../../contracts/entities/inventory-entities.contract.js";
import { getInventoryRunArtifacts, getLatestInventoryRunMemory } from "./inventoryImportRunStore.js";
import { getOpenStreetMapClassificationRun } from "../openstreetmap/openstreetmapRunStore.js";
import {
  attachExistingMediaFields,
  extractExistingMediaRefsFromTags,
  summarizeExistingMediaRefs,
} from "../../lib/inventory/media/inventoryExistingMediaRefs.js";
import {
  buildExistingMediaDiagnostics,
  type ExistingMediaCatalogItem,
  type ExistingMediaDiagnostics,
} from "../../lib/inventory/media/inventoryExistingMediaDiagnostics.js";

export type ExistingMediaBundle = {
  runId: string;
  dataSource: ExistingMediaDiagnostics["dataSource"];
  items: ExistingMediaCatalogItem[];
  diagnostics: ExistingMediaDiagnostics;
};

let latestBundle: ExistingMediaBundle | null = null;

export function putExistingMediaBundle(bundle: ExistingMediaBundle): void {
  latestBundle = bundle;
}

export function getExistingMediaBundle(runId?: string | null): ExistingMediaBundle | null {
  if (!latestBundle) return null;
  if (runId && latestBundle.runId !== runId) return null;
  return latestBundle;
}

function catalogFromOsmRun(runId: string): ExistingMediaCatalogItem[] {
  const run = getOpenStreetMapClassificationRun(runId);
  if (!run) return [];

  const items: ExistingMediaCatalogItem[] = [];

  for (const spot of run.acceptedSpots) {
    const enriched = attachExistingMediaFields({
      id: spot.id,
      sourceKey: spot.sourceKey,
      name: spot.name,
      displayName: spot.displayName ?? spot.name,
      kind: "inventory_spot",
      tags: spot.tags,
    });
    items.push({
      decision: "accepted",
      kind: "spot",
      name: spot.name,
      displayName: spot.displayName ?? spot.name,
      category: spot.category,
      activity: null,
      sourceKey: spot.sourceKey,
      sourceId: spot.sourceId,
      locavaScore: spot.locavaScore,
      displayPriority: spot.displayPriority,
      rejectionReason: null,
      tags: spot.tags,
      ...summarizeExistingMediaRefs(enriched.existingMediaRefs),
    });
  }

  for (const route of run.acceptedRoutes) {
    const enriched = attachExistingMediaFields({
      id: route.id,
      sourceKey: route.sourceKey,
      name: route.name,
      kind: "inventory_route",
      tags: route.tags,
    });
    items.push({
      decision: "accepted",
      kind: "route",
      name: route.name,
      displayName: route.name,
      category: null,
      activity: route.activity,
      sourceKey: route.sourceKey,
      sourceId: route.sourceId,
      locavaScore: route.locavaScore,
      displayPriority: route.displayPriority,
      rejectionReason: null,
      tags: route.tags,
      ...summarizeExistingMediaRefs(enriched.existingMediaRefs),
    });
  }

  for (const rej of run.rejected) {
    const tags = rej.topTags ?? {};
    const refs = extractExistingMediaRefsFromTags(tags, {
      sourceKey: rej.sourceKey,
      inventoryName: rej.name ?? undefined,
      itemKind: "raw",
    });
    items.push({
      decision: "rejected",
      kind: rej.coordinates && rej.coordinates.length >= 2 ? "route" : "spot",
      name: rej.name ?? rej.sourceKey,
      displayName: rej.name ?? rej.sourceKey,
      category: null,
      activity: null,
      sourceKey: rej.sourceKey,
      sourceId: rej.sourceId,
      locavaScore: rej.locavaScore,
      displayPriority: null,
      rejectionReason: rej.rejectionReason,
      tags,
      ...summarizeExistingMediaRefs(refs),
    });
  }

  return items;
}

function catalogFromInventoryRun(runId: string): ExistingMediaCatalogItem[] {
  const artifacts = getInventoryRunArtifacts(runId);
  if (!artifacts) return [];
  const items: ExistingMediaCatalogItem[] = [];

  for (const spot of artifacts.stagedSpots) {
    items.push(toCatalogItem(spot, "spot", "accepted"));
  }
  for (const route of artifacts.stagedRoutes) {
    items.push(toCatalogItem(route, "route", "accepted"));
  }
  return items;
}

function toCatalogItem(
  item: InventorySpot | InventoryRoute,
  kind: "spot" | "route",
  decision: "accepted" | "rejected"
): ExistingMediaCatalogItem {
  const tags = Object.fromEntries(Object.entries(item.tags ?? {}).map(([k, v]) => [k, v]));
  const enriched = attachExistingMediaFields({
    id: item.id,
    sourceKey: item.sourceKey,
    name: item.name,
    kind: item.kind,
    tags,
  });
  return {
    decision,
    kind,
    name: item.name,
    displayName: item.name,
    category: kind === "spot" ? (item as InventorySpot).category : null,
    activity: kind === "route" ? (item as InventoryRoute).activity : null,
    sourceKey: item.sourceKey,
    sourceId: item.sourceId,
    qualityScore: item.qualityScore,
    displayPriority: null,
    rejectionReason: null,
    tags,
    ...summarizeExistingMediaRefs(enriched.existingMediaRefs),
  };
}

export function refreshExistingMediaBundle(preferredRunId?: string): ExistingMediaBundle | null {
  const osmRun = getOpenStreetMapClassificationRun(preferredRunId);
  if (osmRun) {
    const items = catalogFromOsmRun(osmRun.runId);
    const diagnostics = buildExistingMediaDiagnostics({
      runId: osmRun.runId,
      dataSource: "openstreetmap_classification",
      items,
    });
    const bundle = { runId: osmRun.runId, dataSource: "openstreetmap_classification" as const, items, diagnostics };
    latestBundle = bundle;
    return bundle;
  }

  const invRun = getLatestInventoryRunMemory();
  if (!invRun) return null;
  if (preferredRunId && invRun.runId !== preferredRunId) return null;

  const items = catalogFromInventoryRun(invRun.runId);
  const diagnostics = buildExistingMediaDiagnostics({
    runId: invRun.runId,
    dataSource: "inventory_dry_run",
    items,
  });
  const bundle = { runId: invRun.runId, dataSource: "inventory_dry_run" as const, items, diagnostics };
  latestBundle = bundle;
  return bundle;
}

export function getOrRefreshExistingMediaBundle(runId?: string): ExistingMediaBundle | null {
  const cached = getExistingMediaBundle(runId);
  if (cached) return cached;
  return refreshExistingMediaBundle(runId);
}

export type ExistingMediaSearchFilters = {
  runId?: string;
  q?: string;
  decision?: "all" | "accepted" | "rejected";
  kind?: "all" | "spot" | "route" | "raw";
  hasMediaRef?: boolean;
  canPreview?: boolean;
  mediaKind?: string;
  mediaTagKey?: string;
  includeRejected?: boolean;
  limit?: number;
  offset?: number;
};

export type ExistingMediaSearchResult = {
  runId: string;
  total: number;
  limit: number;
  offset: number;
  query: string;
  filters: Record<string, unknown>;
  summary: ExistingMediaDiagnostics["counts"];
  results: ExistingMediaCatalogItem[];
};

function matchesQuery(item: ExistingMediaCatalogItem, q: string): boolean {
  if (!q) return true;
  const hay = JSON.stringify({
    name: item.displayName ?? item.name,
    category: item.category,
    activity: item.activity,
    sourceKey: item.sourceKey,
    tags: item.tags,
    refs: item.existingMediaRefs,
  }).toLowerCase();
  return hay.includes(q.toLowerCase());
}

export function searchExistingMedia(input: ExistingMediaSearchFilters): ExistingMediaSearchResult | null {
  const bundle = getOrRefreshExistingMediaBundle(input.runId);
  if (!bundle) return null;

  let rows = [...bundle.items];
  const q = input.q?.trim() ?? "";

  if (input.decision && input.decision !== "all") {
    rows = rows.filter((r) => r.decision === input.decision);
  } else if (input.includeRejected === false) {
    rows = rows.filter((r) => r.decision === "accepted");
  }

  if (input.kind && input.kind !== "all") {
    rows = rows.filter((r) => r.kind === input.kind);
  }

  if (input.hasMediaRef === true) rows = rows.filter((r) => r.existingMediaRefCount > 0);
  if (input.hasMediaRef === false) rows = rows.filter((r) => r.existingMediaRefCount === 0);
  if (input.canPreview === true) rows = rows.filter((r) => r.previewableMediaCount > 0);
  if (input.canPreview === false) rows = rows.filter((r) => r.previewableMediaCount === 0);
  if (input.mediaKind) rows = rows.filter((r) => r.existingMediaRefs.some((ref) => ref.mediaKind === input.mediaKind));
  if (input.mediaTagKey) rows = rows.filter((r) => r.existingMediaRefs.some((ref) => ref.tagKey === input.mediaTagKey));

  rows = rows.filter((r) => matchesQuery(r, q));

  rows.sort((a, b) => {
    const da = a.decision === "accepted" ? 0 : 1;
    const db = b.decision === "accepted" ? 0 : 1;
    if (da !== db) return da - db;
    if ((b.previewableMediaCount ?? 0) !== (a.previewableMediaCount ?? 0)) {
      return (b.previewableMediaCount ?? 0) - (a.previewableMediaCount ?? 0);
    }
    return (b.existingMediaRefCount ?? 0) - (a.existingMediaRefCount ?? 0);
  });

  const total = rows.length;
  const limit = input.limit ?? 200;
  const offset = input.offset ?? 0;
  const page = rows.slice(offset, offset + limit);

  return {
    runId: bundle.runId,
    total,
    limit,
    offset,
    query: q,
    filters: { ...input },
    summary: bundle.diagnostics.counts,
    results: page,
  };
}

export function resetExistingMediaBundleForTests(): void {
  latestBundle = null;
}
