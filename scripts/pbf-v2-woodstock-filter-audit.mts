#!/usr/bin/env npx tsx
import { applyPbfQualityFilters, DEFAULT_PBF_QUALITY_FILTER_SETTINGS } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2QualityFilters.js";
import { postProcessRawOsmPreviewDocs } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2RawDisplay.js";
import { MT_TOM_WOODSTOCK_VT_BBOX, scanPbfViewportPreview } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2ViewportPreview.js";

const NEEDLES = [
  "pogue",
  "covered bridge",
  "west woodstock bridge",
  "middle covered",
  "taftsville",
  "billings pond",
  "faulkner trail",
  "north ridge",
  "mount tom",
  "deer leap",
  "lake",
  " pond",
];

async function main(): Promise<void> {
  const scan = await scanPbfViewportPreview({
    pbfPath: "./data/osm/vermont-latest.osm.pbf",
    bbox: MT_TOM_WOODSTOCK_VT_BBOX,
    mode: "raw_osm",
  });
  const raw = postProcessRawOsmPreviewDocs(scan.items);
  const filtered = applyPbfQualityFilters(raw.items, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
  const docs = filtered.items;

  console.log("Scan raw:", scan.items.length, "→ postProcess:", raw.items.length);
  console.log("Trail merged:", raw.hikingTrailGroupsMerged, "collapsed:", raw.hikingTrailSegmentsCollapsed);
  console.log("Visible:", docs.filter((d) => !d.filteredOut).length, "Hidden:", docs.filter((d) => d.filteredOut).length);

  for (const needle of NEEDLES) {
    const hits = docs.filter((d) => (d.displayName || "").toLowerCase().includes(needle.trim()));
    const vis = hits.filter((d) => !d.filteredOut);
    const hid = hits.filter((d) => d.filteredOut);
    console.log(`\n--- ${needle} --- visible=${vis.length} hidden=${hid.length}`);
    for (const d of vis.slice(0, 5)) {
      console.log("  V", d.displayName, d.kind, d.primaryCategory, d.filteredBy?.join(",") || "");
    }
    for (const d of hid.slice(0, 8)) {
      console.log("  H", d.displayName, d.kind, d.filteredBy?.join(","), d.filterReason);
    }
  }

  const trailNames = docs
    .filter((d) => !d.filteredOut && (d.primaryCategory === "hiking" || d.warnings?.includes("v2_hiking_trail_merged")))
    .map((d) => d.displayName)
    .sort();
  console.log("\n--- Visible hiking (merged) ---", trailNames.length);
  console.log(trailNames.slice(0, 40).join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
