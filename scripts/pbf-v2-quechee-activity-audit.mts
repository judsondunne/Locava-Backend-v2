#!/usr/bin/env npx tsx
/**
 * DEV-ONLY — Quechee bbox audit for canonical activity normalization.
 */
import { applyPbfQualityFilters, DEFAULT_PBF_QUALITY_FILTER_SETTINGS } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2QualityFilters.js";
import { enrichUnnamedOutdoorDisplayNames } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2GeneratedDisplayNames.js";
import { postProcessRawOsmPreviewDocs } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2RawDisplay.js";
import { isRawOsmTagActivityString } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2CanonicalActivities.js";
import { isLocavaActivity } from "../src/lib/inventory/activities/locavaActivities.js";
import {
  bboxForVermontEvalRegion,
  VERMONT_EVAL_REGIONS,
} from "../src/admin/openstreetmap/national/pbfCopier/pbfVermontEvalRegions.js";
import { scanPbfViewportPreview } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2ViewportPreview.js";
import type { PbfQualityFilteredPreviewDoc } from "../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2QualityFilters.js";

const region = VERMONT_EVAL_REGIONS.find((r) => r.slug === "quechee-hartford")!;
const bbox = bboxForVermontEvalRegion(region);

function countVisible(items: PbfQualityFilteredPreviewDoc[]) {
  return items.filter((d) => !d.filteredOut).length;
}

function summarizeVisible(items: PbfQualityFilteredPreviewDoc[]) {
  return items
    .filter((d) => !d.filteredOut)
    .map((d) => ({
      displayName: d.displayName,
      primaryActivity: d.primaryActivity,
      activities: d.activities,
      whyVisible: d.whyVisible,
      activityEvidence: d.activityEvidence,
      canonicalActivitySource: d.canonicalActivitySource,
      rawTagActivitySuppressed: d.rawTagActivitySuppressed,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function main(): Promise<void> {
  const scan = await scanPbfViewportPreview({
    pbfPath: "./data/osm/vermont-latest.osm.pbf",
    bbox,
    mode: "raw_osm",
  });

  const raw = postProcessRawOsmPreviewDocs(scan.items);
  const withNames = enrichUnnamedOutdoorDisplayNames(raw.items);

  const beforeVisible = withNames.map((d) => ({
    ...d,
    filteredOut: false,
    filteredBy: [],
    filterReason: "",
  })) as PbfQualityFilteredPreviewDoc[];

  const filtered = applyPbfQualityFilters(withNames, DEFAULT_PBF_QUALITY_FILTER_SETTINGS);
  const visible = filtered.items.filter((d) => !d.filteredOut);

  const canonicalizedFromRaw = visible.filter(
    (d) => (d.rawTagActivitySuppressed?.length ?? 0) > 0
  );

  const rawLeaks = visible.filter((d) => {
    const values = [d.primaryActivity, d.primaryCategory, ...(d.activities ?? [])];
    return values.some((v) => v && isRawOsmTagActivityString(v));
  });

  const nonCanonical = visible.filter((d) => {
    for (const a of [d.primaryActivity, ...(d.activities ?? [])]) {
      if (!a) continue;
      if (a === "train_bridge") continue;
      if (!isLocavaActivity(a)) return true;
    }
    return false;
  });

  const questionable = visible.filter((d) => {
    const n = (d.displayName || "").toLowerCase();
    return (
      n.startsWith("building=") ||
      n.startsWith("landuse=") ||
      n.startsWith("man_made=") ||
      n.includes("building:part=")
    );
  });

  console.log("=== Quechee Canonical Activity Audit ===");
  console.log("Region:", region.name);
  console.log("Bbox:", bbox);
  console.log("Scan items:", scan.items.length, "→ postProcess:", raw.items.length);
  console.log("Visible before filters:", countVisible(beforeVisible));
  console.log("Hidden before filters:", beforeVisible.length - countVisible(beforeVisible));
  console.log("Visible after filters:", visible.length);
  console.log("Hidden after filters:", filtered.items.length - visible.length);

  console.log("\n--- All visible items ---");
  console.log(JSON.stringify(summarizeVisible(filtered.items), null, 2));

  console.log("\n--- Canonicalized from raw tags ---");
  console.log(JSON.stringify(summarizeVisible(canonicalizedFromRaw), null, 2));

  console.log("\n--- Suppressed raw activity leaks (visible) ---");
  console.log(rawLeaks.length ? JSON.stringify(summarizeVisible(rawLeaks), null, 2) : "none");

  console.log("\n--- Non-canonical visible activities ---");
  console.log(nonCanonical.length ? JSON.stringify(summarizeVisible(nonCanonical), null, 2) : "none");

  console.log("\n--- Questionable visible items ---");
  console.log(questionable.length ? JSON.stringify(summarizeVisible(questionable), null, 2) : "none");

  const waterAccess = visible.filter((d) => /water access/i.test(d.displayName));
  console.log("\n--- Water Access spots ---");
  console.log(JSON.stringify(summarizeVisible(waterAccess), null, 2));

  const islands = visible.filter(
    (d) =>
      d.sourceTagSample?.place === "island" ||
      d.sourceTagSample?.place === "islet" ||
      /island/i.test(d.displayName)
  );
  console.log("\n--- Island / place=island features ---");
  console.log(JSON.stringify(summarizeVisible(islands), null, 2));

  const quecheeVillage = visible.filter((d) => /quechee gorge village/i.test(d.displayName));
  console.log("\n--- Quechee Gorge Village ---");
  console.log(JSON.stringify(summarizeVisible(quecheeVillage), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
