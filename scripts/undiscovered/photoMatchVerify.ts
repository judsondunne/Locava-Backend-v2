/**
 * Photo-match verification for obscure locations.
 *
 * Pulls real, lesser-known named spots from the Vermont PBF (OSM name+lat/lng =
 * ground truth), runs the live photo search for each, then validates every photo
 * with the production metadata-consensus scorer (scorePhotoSearchResultsForPlace).
 * Prints accepted/rejected per spot with confidences and reject reasons.
 *
 * Usage: npx tsx scripts/undiscovered/photoMatchVerify.ts
 */
import { loadEnv } from "../../src/config/env.js";
import { scanPbfViewportPreview } from "../../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2ViewportPreview.js";
import { runPbfCopierV2Pipeline } from "../../src/admin/openstreetmap/national/pbfCopier/pbfCopierV2Pipeline.js";
import { buildOsmSpecificPhotoQuery } from "../../src/lib/pbf/buildOsmSpecificPhotoQuery.js";
import { searchPlaceImages } from "../../src/lib/places/searchPlaceImages.service.js";
import { scorePhotoSearchResultsForPlace } from "../../src/lib/pbf/scorePhotoSearchResultsForPlace.js";
import type { PbfCopierPreviewDoc } from "../../src/admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";

const PBF = "data/osm/vermont-latest.osm.pbf";

// Rural areas unlikely to hold tourist-famous spots.
const AREAS = [
  { label: "Mount Holly / Ludlow hills", bbox: { westLng: -72.85, southLat: 43.38, eastLng: -72.6, northLat: 43.55 } },
  { label: "Groton State Forest area", bbox: { westLng: -72.4, southLat: 44.2, eastLng: -72.2, northLat: 44.35 } },
];

const FAMOUS = /moss glen|texas falls|warren falls|bristol falls|quechee|bingham|camel|mansfield|ben & jerry|stowe pinnacle/i;
// Distinctive feature types first — generic "X Hill" names are near-unverifiable
// and the validator correctly refuses them (proven in the first run).
const INTERESTING = /falls|cascade|gorge|ledge|lookout|overlook|pond|brook|trail|mountain/i;
const TOO_GENERIC = /^(dry|blueberry|blake|colby|debby|comtois)?\s*hill$/i;

async function main() {
  const env = loadEnv();
  if (!String(env.SERPER_API_KEY ?? "").trim()) {
    console.error("SERPER_API_KEY missing — live verification needs it.");
    process.exit(1);
  }

  // 1) Collect obscure named docs from the real PBF.
  const picked: PbfCopierPreviewDoc[] = [];
  for (const area of AREAS) {
    const scan = await scanPbfViewportPreview({ pbfPath: PBF, bbox: area.bbox, mode: "raw_osm" });
    const filtered = runPbfCopierV2Pipeline({ rawItems: scan.items, skipHeavyGrouping: true });
    const named = filtered.items.filter(
      (d) =>
        !d.filteredOut &&
        d.displayName &&
        !d.displayName.includes("=") &&
        d.displayName.length > 5 &&
        INTERESTING.test(d.displayName) &&
        !/\bhill\b/i.test(d.displayName) &&
        !TOO_GENERIC.test(d.displayName) &&
        !FAMOUS.test(d.displayName),
    );
    // Prefer distinctive water/terrain features over trails for verifiability.
    named.sort((a, b) => {
      const rank = (n: string) => (/falls|cascade|gorge/i.test(n) ? 0 : /pond|brook|ledge|lookout|overlook/i.test(n) ? 1 : 2);
      return rank(a.displayName) - rank(b.displayName);
    });
    const seen = new Set<string>();
    for (const d of named) {
      const k = d.displayName.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      picked.push(d);
      if (seen.size >= 4) break;
    }
    console.log(`[scan] ${area.label}: ${scan.items.length} raw → ${named.length} obscure named; picked ${Math.min(4, named.length)}`);
  }

  // 2) For each: query → live search → production scorer.
  let spotsWithPhotos = 0;
  let totalAccepted = 0;
  let totalRejected = 0;
  for (const doc of picked) {
    const query = buildOsmSpecificPhotoQuery(doc);
    console.log(`\n=== ${doc.displayName} (${doc.lat.toFixed(4)}, ${doc.lng.toFixed(4)}) [${doc.primaryCategory}] ===`);
    if (query.skip || !query.query) {
      console.log("  query builder skipped (name too generic) — correctly refuses to search");
      continue;
    }
    console.log(`  query: "${query.query}" (specificity ${query.querySpecificityScore})`);
    let results: Awaited<ReturnType<typeof searchPlaceImages>>["results"] = [];
    let source = "none";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await searchPlaceImages(query.query, env, { resultLimit: 10, skipLoadVerification: true });
        results = r.results;
        source = r.source;
        break;
      } catch (err) {
        console.log(`  attempt ${attempt} failed (${err instanceof Error ? err.message : err}) — retrying`);
        await new Promise((res) => setTimeout(res, 1500 * attempt));
      }
    }
    if (source === "none") {
      console.log("  all attempts failed — skipping spot");
      continue;
    }
    // Exact-phrase queries for hyper-obscure OSM names often return nothing —
    // fall back to the unquoted form (recall over precision; scorer still gates).
    if (results.length === 0 && query.query.includes('"')) {
      const relaxed = query.query.replace(/"/g, "");
      try {
        const r2 = await searchPlaceImages(relaxed, env, { resultLimit: 10, skipLoadVerification: true });
        results = r2.results;
        source = r2.source + "+unquoted";
      } catch {
        /* keep empty */
      }
    }
    const strict = scorePhotoSearchResultsForPlace(doc, query, results);
    const score = scorePhotoSearchResultsForPlace(doc, query, results, { scoringProfile: "undiscovered_app" });
    totalAccepted += score.acceptedAssets.length;
    totalRejected += score.rejectedAssets.length;
    if (score.acceptedAssets.length > 0) spotsWithPhotos += 1;
    console.log(`  [${source}] ${results.length} results | admin_strict: ${strict.acceptedAssets.length} ok | app profile: ${score.acceptedAssets.length} ok / ${score.rejectedAssets.length} rejected (set ${score.resultSetScore})`);
    for (const a of score.acceptedAssets.slice(0, 3)) {
      console.log(`   ✓ [${a.assetMatchConfidence}|${a.assetMatchScore}] ${(a.sourceDomain ?? "").slice(0, 36)} — ${(a.caption ?? "").slice(0, 60)}`);
    }
    for (const r of score.rejectedAssets.slice(0, 2)) {
      console.log(`   ✗ [${r.score}] ${(r.sourceDomain ?? "").slice(0, 30)} — ${r.rejectReasons.join(",")}`);
    }
  }

  console.log(`\n===== SUMMARY =====`);
  console.log(`obscure spots tested: ${picked.length}`);
  console.log(`spots with ≥1 verified-match photo: ${spotsWithPhotos}`);
  console.log(`photos accepted: ${totalAccepted} | rejected by validator: ${totalRejected}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
