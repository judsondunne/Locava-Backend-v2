import type { ExistingMediaKind, ExistingMediaRef, MediaSummaryFields } from "./inventoryExistingMediaRefs.js";

export type ExistingMediaCatalogItem = {
  decision: "accepted" | "rejected";
  kind: "spot" | "route" | "raw";
  name: string;
  displayName?: string;
  category?: string | null;
  activity?: string | null;
  sourceKey: string;
  sourceId?: string;
  locavaScore?: number;
  qualityScore?: number;
  displayPriority?: string | null;
  rejectionReason?: string | null;
  tags: Record<string, unknown>;
} & MediaSummaryFields;

export type ExistingMediaDiagnostics = {
  algorithmVersion: "locava_existing_media_refs_v1";
  generatedAt: string;
  noRefetch: true;
  noApiCalls: true;
  source: "existing_osm_tags_only";
  runId: string;
  dataSource: "openstreetmap_classification" | "inventory_dry_run" | "none";
  checked: {
    acceptedSpots: number;
    acceptedRoutes: number;
    rejectedObjects: number;
    total: number;
  };
  counts: {
    itemsWithAnyMediaRef: number;
    itemsWithPreviewableMedia: number;
    itemsWithDirectImage: number;
    itemsWithCommonsFile: number;
    itemsWithCommonsCategory: number;
    itemsWithWikidata: number;
    itemsWithWikipedia: number;
    itemsWithMapillary: number;
    itemsWithWebsite: number;
    itemsWithNoMediaRefs: number;
  };
  byCategory: Record<string, number>;
  byDisplayPriority: Record<string, number>;
  byMediaKind: Record<string, number>;
  topMediaTagKeys: Array<{ tagKey: string; count: number }>;
  samples: {
    bestPreviewable: Array<Record<string, unknown>>;
    commonsFiles: Array<Record<string, unknown>>;
    commonsCategories: Array<Record<string, unknown>>;
    wikidataOnly: Array<Record<string, unknown>>;
    wikipediaOnly: Array<Record<string, unknown>>;
    mapillaryOnly: Array<Record<string, unknown>>;
    websiteOnly: Array<Record<string, unknown>>;
    noMediaHeroSpots: Array<Record<string, unknown>>;
    noMediaHighSpots: Array<Record<string, unknown>>;
    brokenPreviewCandidates: Array<Record<string, unknown>>;
  };
  notes: string[];
};

function itemBrief(item: ExistingMediaCatalogItem): Record<string, unknown> {
  return {
    name: item.displayName ?? item.name,
    kind: item.kind,
    sourceKey: item.sourceKey,
    existingMediaRefCount: item.existingMediaRefCount,
    previewableMediaCount: item.previewableMediaCount,
  };
}

export function buildExistingMediaDiagnostics(input: {
  runId: string;
  dataSource: ExistingMediaDiagnostics["dataSource"];
  items: ExistingMediaCatalogItem[];
}): ExistingMediaDiagnostics {
  const acceptedSpots = input.items.filter((i) => i.decision === "accepted" && i.kind === "spot").length;
  const acceptedRoutes = input.items.filter((i) => i.decision === "accepted" && i.kind === "route").length;
  const rejectedObjects = input.items.filter((i) => i.decision === "rejected").length;

  const withAny = input.items.filter((i) => i.existingMediaRefCount > 0);
  const withPreview = input.items.filter((i) => i.previewableMediaCount > 0);

  const byCategory: Record<string, number> = {};
  const byDisplayPriority: Record<string, number> = {};
  const byMediaKind: Record<string, number> = {};
  const tagKeyCounts: Record<string, number> = {};

  for (const item of withAny) {
    const cat = item.category ?? item.activity ?? "unknown";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    const pri = item.displayPriority ?? "unknown";
    byDisplayPriority[pri] = (byDisplayPriority[pri] ?? 0) + 1;
    for (const ref of item.existingMediaRefs) {
      byMediaKind[ref.mediaKind] = (byMediaKind[ref.mediaKind] ?? 0) + 1;
      tagKeyCounts[ref.tagKey] = (tagKeyCounts[ref.tagKey] ?? 0) + 1;
    }
  }

  const topMediaTagKeys = Object.entries(tagKeyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tagKey, count]) => ({ tagKey, count }));

  const hasKind = (item: ExistingMediaCatalogItem, kind: ExistingMediaKind) =>
    item.existingMediaRefs.some((r) => r.mediaKind === kind);

  const onlyKind = (item: ExistingMediaCatalogItem, kind: ExistingMediaKind) =>
    item.existingMediaRefs.length > 0 && item.existingMediaRefs.every((r) => r.mediaKind === kind);

  return {
    algorithmVersion: "locava_existing_media_refs_v1",
    generatedAt: new Date().toISOString(),
    noRefetch: true,
    noApiCalls: true,
    source: "existing_osm_tags_only",
    runId: input.runId,
    dataSource: input.dataSource,
    checked: {
      acceptedSpots,
      acceptedRoutes,
      rejectedObjects,
      total: input.items.length,
    },
    counts: {
      itemsWithAnyMediaRef: withAny.length,
      itemsWithPreviewableMedia: withPreview.length,
      itemsWithDirectImage: input.items.filter((i) => hasKind(i, "direct_image")).length,
      itemsWithCommonsFile: input.items.filter((i) => hasKind(i, "commons_file")).length,
      itemsWithCommonsCategory: input.items.filter((i) => hasKind(i, "commons_category")).length,
      itemsWithWikidata: input.items.filter((i) => hasKind(i, "wikidata")).length,
      itemsWithWikipedia: input.items.filter((i) => hasKind(i, "wikipedia")).length,
      itemsWithMapillary: input.items.filter((i) => hasKind(i, "mapillary")).length,
      itemsWithWebsite: input.items.filter((i) => hasKind(i, "website")).length,
      itemsWithNoMediaRefs: input.items.filter((i) => i.existingMediaRefCount === 0).length,
    },
    byCategory,
    byDisplayPriority,
    byMediaKind,
    topMediaTagKeys,
    samples: {
      bestPreviewable: withPreview.slice(0, 10).map(itemBrief),
      commonsFiles: input.items.filter((i) => hasKind(i, "commons_file")).slice(0, 10).map(itemBrief),
      commonsCategories: input.items.filter((i) => hasKind(i, "commons_category")).slice(0, 10).map(itemBrief),
      wikidataOnly: input.items.filter((i) => onlyKind(i, "wikidata")).slice(0, 10).map(itemBrief),
      wikipediaOnly: input.items.filter((i) => onlyKind(i, "wikipedia")).slice(0, 10).map(itemBrief),
      mapillaryOnly: input.items.filter((i) => onlyKind(i, "mapillary")).slice(0, 10).map(itemBrief),
      websiteOnly: input.items.filter((i) => onlyKind(i, "website")).slice(0, 10).map(itemBrief),
      noMediaHeroSpots: input.items
        .filter((i) => i.kind === "spot" && i.displayPriority === "hero" && i.existingMediaRefCount === 0)
        .slice(0, 10)
        .map(itemBrief),
      noMediaHighSpots: input.items
        .filter((i) => i.kind === "spot" && i.displayPriority === "high" && i.existingMediaRefCount === 0)
        .slice(0, 10)
        .map(itemBrief),
      brokenPreviewCandidates: [],
    },
    notes: [
      "This only inspects media already present in existing OSM tags/properties.",
      "No Wikidata/Wikipedia/Commons API resolution was performed.",
      "Website links are not treated as reusable photos unless they are direct image URLs.",
      "Previewing does not mean Locava can legally store/rehost the image.",
    ],
  };
}

export function mergeRefNotes(refs: ExistingMediaRef[]): ExistingMediaRef[] {
  return refs;
}
