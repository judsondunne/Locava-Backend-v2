#!/usr/bin/env npx tsx
/**
 * DEV-ONLY — summarize Undiscovered quality filter output for a Vermont eval bbox.
 */
import { applyPbfQualityFilters, DEFAULT_PBF_QUALITY_FILTER_SETTINGS } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2QualityFilters.js";
import {
  bboxForVermontEvalRegion,
  VERMONT_EVAL_REGIONS,
} from "../src/admin/openstreetmap/national/pbfCopier/pbfVermontEvalRegions.js";
import { MT_TOM_WOODSTOCK_VT_BBOX } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2ViewportPreview.js";
import { scanPbfViewportPreview } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2ViewportPreview.js";
import type { PbfQualityFilteredPreviewDoc } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2QualityFilters.js";

function summarize(items: PbfQualityFilteredPreviewDoc[], label: string) {
  const visible = items.filter((d) => !d.filteredOut);
  const hidden = items.filter((d) => d.filteredOut);
  const countFilter = (key: string) =>
    hidden.filter((d) => (d.filteredBy ?? []).includes(key)).length;

  const catCounts = new Map<string, number>();
  for (const d of visible) {
    const cat = d.primaryCategory || d.primaryActivity || "unknown";
    catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
  }

  return {
    label,
    rawItems: items.length,
    visibleItems: visible.length,
    hiddenItems: hidden.length,
    unqualified_terrain_peak: countFilter("unqualified_terrain_peak"),
    unqualified_terrain_feature: countFilter("unqualified_terrain_feature"),
    generic_road_route: countFilter("generic_road_route"),
    private_or_restricted_access: countFilter("private_or_restricted_access"),
    topVisibleCategories: [...catCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50),
    sampleHidden: hidden.slice(0, 50).map((d) => ({
      name: d.displayName,
      filteredBy: d.filteredBy,
      filterReason: d.filterReason,
    })),
    sampleVisible: visible.slice(0, 50).map((d) => ({
      name: d.displayName,
      category: d.primaryCategory || d.primaryActivity,
    })),
  };
}

async function main(): Promise<void> {
  const regionSlug = process.argv[2] ?? "killington-ski";
  const killingtonSkiBbox = {
    westLng: -72.87,
    southLat: 43.58,
    eastLng: -72.74,
    northLat: 43.68,
  };
  const region = VERMONT_EVAL_REGIONS.find((r) => r.slug === regionSlug);
  const bbox =
    regionSlug === "mt-tom"
      ? MT_TOM_WOODSTOCK_VT_BBOX
      : regionSlug === "killington-ski"
        ? killingtonSkiBbox
        : region
          ? bboxForVermontEvalRegion(region)
          : killingtonSkiBbox;
  const regionName =
    regionSlug === "mt-tom"
      ? "Mt Tom / Woodstock VT"
      : regionSlug === "killington-ski"
        ? "Killington ski / Deer Leap area"
        : region?.name ?? regionSlug;
  const scan = await scanPbfViewportPreview({
    pbfPath: "./data/osm/vermont-latest.osm.pbf",
    bbox,
    mode: "locava_filtered",
  });

  const before = scan.items.map((d) => ({
    ...d,
    filteredOut: false,
    filteredBy: [],
    filterReason: "",
  })) as PbfQualityFilteredPreviewDoc[];

  const filtered = applyPbfQualityFilters(scan.items, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);

  const needles = [
    "Teago Hill",
    "Deer Leap Rock",
    "Deer Leap Mountain",
    "Round Pinnacle",
    "Mount Tom",
    "Mount Peg",
    "Killington Peak",
    "High Mountain Road",
    "East Mountain Road",
    "Summit Road",
    "Quartz Mountain Road",
    "Hannaford",
    "Target",
    "Tennis Court",
    "Vanessa",
    "Supercuts",
  ];

  const manualChecks = Object.fromEntries(
    needles.map((needle) => {
      const hits = filtered.items.filter((d) =>
        (d.displayName || "").toLowerCase().includes(needle.toLowerCase())
      );
      return [
        needle,
        hits.map((h) => ({
          name: h.displayName,
          visible: !h.filteredOut,
          filteredBy: h.filteredBy,
          filterReason: h.filterReason,
        })),
      ];
    })
  );

  console.log(
    JSON.stringify(
      {
        region: regionName,
        bbox,
        scanStats: scan.stats,
        beforeFiltering: summarize(before, "pre-filter (all visible)"),
        afterFiltering: summarize(filtered.items, "post-filter"),
        manualChecks,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
