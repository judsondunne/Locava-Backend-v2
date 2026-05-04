/**
 * Full post surface inventory — grep Backend V2 + Locava-Native, emit JSON + markdown summary.
 * Audit-only: does not modify product source outside docs/audits outputs.
 *
 * Run: npx tsx scripts/audits/full-post-surface-inventory.mts
 * Or:  npm run audit:post-surfaces
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const WORKSPACE_ROOT = path.resolve(BACKEND_ROOT, "..");
const NATIVE_SRC = path.join(WORKSPACE_ROOT, "Locava-Native", "src");

const AUDIT_DATE = "2026-05-04";
const OUT_BACKEND_JSON = path.join(BACKEND_ROOT, `docs/audits/full-post-surface-backend-inventory-${AUDIT_DATE}.json`);
const OUT_NATIVE_JSON = path.join(BACKEND_ROOT, `docs/audits/full-post-surface-native-inventory-${AUDIT_DATE}.json`);
const OUT_SUMMARY_MD = path.join(BACKEND_ROOT, `docs/audits/full-post-surface-inventory-summary-${AUDIT_DATE}.md`);

const SRC_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs"]);

/** Search terms from full-post-surface audit spec (regex source, flags). */
const BACKEND_TERM_RES: Array<{ pattern: string; re: RegExp }> = [
  ["appPost", /\bappPost\b/],
  ["AppPostV2", /\bAppPostV2\b/],
  ["postContractVersion", /\bpostContractVersion\b/],
  ["toAppPostV2", /\btoAppPostV2\b/],
  ["toAppPostV2FromAny", /\btoAppPostV2FromAny\b/],
  ["normalizeMasterPostV2", /\bnormalizeMasterPostV2\b/],
  ["buildPostEnvelope", /\bbuildPostEnvelope\b/],
  ["toFeedCardDTO", /\btoFeedCardDTO\b/],
  ["attachAppPostV2ToRecord", /\battachAppPostV2ToRecord\b/],
  ["batchHydrateAppPostsOnRecords", /\bbatchHydrateAppPostsOnRecords\b/],
  ["sourceRawPost", /\bsourceRawPost\b/],
  ["rawFirestore", /\brawFirestore\b/],
  ["media.assets", /\bmedia\.assets\b/],
  ["media.assetCount", /\bmedia\.assetCount\b/],
  ["media.cover", /\bmedia\.cover\b/],
  ["assets[0]", /assets\s*\[\s*0\s*\]/],
  ["post.assets", /\bpost\.assets\b/],
  ["photoLink", /\bphotoLink\b/],
  ["photoLinks2", /\bphotoLinks2\b/],
  ["photoLinks3", /\bphotoLinks3\b/],
  ["displayPhotoLink", /\bdisplayPhotoLink\b/],
  ["fallbackVideoUrl", /\bfallbackVideoUrl\b/],
  ["posterUrl", /\bposterUrl\b/],
  ["thumbUrl", /\bthumbUrl\b/],
  ["mediaType", /\bmediaType\b/],
  ["hasMultipleAssets", /\bhasMultipleAssets\b/],
  ["assetCount", /\bassetCount\b/],
  ["mediaCompleteness", /\bmediaCompleteness\b/],
  ["isCoverOnlyCard", /\bisCoverOnlyCard\b/],
  ["post_card_cache", /\bpost_card_cache\b/],
  ["details:batch", /details:batch/],
  ["postPreview", /\bpostPreview\b/],
  ["sharedPost", /\bsharedPost\b/],
  ["notification", /\bnotification\b/i]
].map(([pattern, re]) => ({ pattern: pattern as string, re: re as RegExp }));

const NATIVE_TERM_RES: Array<{ pattern: string; re: RegExp }> = [
  ["appPost", /\bappPost\b/],
  ["appPostV2", /\bappPostV2\b/],
  ["postContractVersion", /\bpostContractVersion\b/],
  ["normalizeAppPostV2", /\bnormalizeAppPostV2\b/],
  ["getPostMediaAssets", /\bgetPostMediaAssets\b/],
  ["getPostCover", /\bgetPostCover\b/],
  ["getHeroUri", /\bgetHeroUri\b/],
  ["getPostActivities", /\bgetPostActivities\b/],
  ["getPostPlaybackUrls", /\bgetPostPlaybackUrls\b/],
  ["mediaItems", /\bmediaItems\b/],
  ["assets[0]", /assets\s*\[\s*0\s*\]/],
  ["post.assets", /\bpost\.assets\b/],
  ["photoLink", /\bphotoLink\b/],
  ["photoLinks2", /\bphotoLinks2\b/],
  ["photoLinks3", /\bphotoLinks3\b/],
  ["displayPhotoLink", /\bdisplayPhotoLink\b/],
  ["fallbackVideoUrl", /\bfallbackVideoUrl\b/],
  ["posterUrl", /\bposterUrl\b/],
  ["thumbUrl", /\bthumbUrl\b/],
  ["imageUrl", /\bimageUrl\b/],
  ["videoUrl", /\bvideoUrl\b/],
  ["preview360", /\bpreview360\b/],
  ["main720", /\bmain720\b/],
  ["main1080", /\bmain1080\b/],
  ["hls", /\bhls\b/i],
  ["mediaType", /\bmediaType\b/],
  ["assetCount", /\bassetCount\b/],
  ["hasMultipleAssets", /\bhasMultipleAssets\b/],
  ["pagination", /\bpagination\b/i],
  ["dots", /\bdots\b/],
  ["carousel", /\bcarousel\b/i],
  ["FlatList", /\bFlatList\b/],
  ["Pager", /\bPager\b/],
  ["LiftableViewerHost", /\bLiftableViewerHost\b/],
  ["AssetCarouselOnly", /\bAssetCarouselOnly\b/],
  ["PostTile", /\bPostTile\b/],
  ["EnhancedMediaContent", /\bEnhancedMediaContent\b/],
  ["MessageBubble", /\bMessageBubble\b/],
  ["Notifications", /\bNotifications\b/],
  ["Profile", /\bProfile\b/],
  ["UserDisplay", /\bUserDisplay\b/],
  ["Search", /\bSearch\b/],
  ["Map", /\bMap\b/],
  ["Collection", /\bCollection\b/],
  ["Mixes", /\bMixes\b/],
  ["Feed", /\bFeed\b/],
  ["Home", /\bHome\b/],
  ["Reels", /\bReels\b/],
  ["post detail", /\bpost\s+detail\b/i],
  ["comments", /\bcomments\b/i],
  ["share", /\bshare\b/i],
  ["report", /\breport\b/i],
  ["deep link", /\bdeep\s*link\b/i]
].map(([pattern, re]) => ({ pattern: pattern as string, re: re as RegExp }));

export type BackendHitClassification =
  | "canonical_source_writer"
  | "app_post_projection_correct"
  | "app_post_projection_partial"
  | "cover_only_intentional"
  | "cover_only_bug"
  | "legacy_compat_alias_only"
  | "legacy_source_of_truth_risk"
  | "cache_risk"
  | "detail_hydration_required"
  | "proxy_not_transformable"
  | "test_fixture"
  | "needs_manual_review";

export type NativeHitClassification =
  | "app_post_consumer_correct"
  | "app_post_consumer_partial"
  | "legacy_fallback_helper_only"
  | "legacy_source_of_truth_risk"
  | "optimistic_cache_risk"
  | "carousel_asset_risk"
  | "dot_count_risk"
  | "activity_display_risk"
  | "detail_hydration_risk"
  | "cover_only_tile_ok"
  | "test_fixture"
  | "needs_manual_review";

type HitBase = {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
};

export type BackendHit = HitBase & { classification: BackendHitClassification };
export type NativeHit = HitBase & { classification: NativeHitClassification };

function* walkDir(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".git" || e.name === "build") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkDir(full);
    else if (SRC_EXT.has(path.extname(e.name))) yield full;
  }
}

function isTestPath(f: string): boolean {
  const x = f.toLowerCase();
  return (
    x.includes("/test/") ||
    x.includes(".test.") ||
    x.includes(".spec.") ||
    x.endsWith("test.ts") ||
    x.endsWith("test.tsx")
  );
}

function classifyBackend(rel: string, line: string, pattern: string): BackendHitClassification {
  const f = rel.replace(/\\/g, "/").toLowerCase();
  const l = line;
  if (isTestPath(f)) return "test_fixture";
  if (f.includes("/docs/")) return "needs_manual_review";
  if (f.includes("compat/legacy") || f.includes("legacy-monolith") || f.includes("legacy-api-stubs")) {
    if (l.includes("proxy") || l.includes("forward") || l.includes("upstream")) return "proxy_not_transformable";
    return "needs_manual_review";
  }
  if (f.includes("posting-finalize") && (l.includes("canonical") || l.includes("Master") || l.includes("finalize")))
    return "canonical_source_writer";
  if (f.includes("master-post-v2")) {
    if (f.includes("/routes/debug/")) return "needs_manual_review";
    return "app_post_projection_correct";
  }
  if (f.includes("post-envelope") || f.includes("toapppostv2") || f.includes("app-post-v2/")) {
    return "app_post_projection_correct";
  }
  if (f.includes("compact-surface-dto") || f.includes("tofeedcarddto")) {
    if (l.includes("cover_only") || l.includes("mediaCompleteness")) return "cover_only_intentional";
    return "app_post_projection_partial";
  }
  if (f.includes("enrichapppostv2")) return "app_post_projection_correct";
  if (pattern === "post_card_cache" || pattern === "mediaCompleteness") return "cache_risk";
  if (f.includes("global-cache") || f.includes("/cache/") || f.includes("entity-cache") || f.includes("mixcache")) {
    if (l.includes("post") || l.includes("feed") || l.includes("card")) return "cache_risk";
  }
  if (f.includes("posts-detail") || pattern === "details:batch") return "detail_hydration_required";
  if (
    (pattern === "photoLink" || pattern === "displayPhotoLink" || pattern === "thumbUrl") &&
    (f.includes("contracts/") || l.includes("z.") || l.includes("optional"))
  ) {
    return "legacy_compat_alias_only";
  }
  if (
    (pattern === "photoLink" || pattern === "displayPhotoLink" || pattern === "assets[0]") &&
    f.includes("/repositories/") &&
    !l.includes("appPost")
  ) {
    return "legacy_source_of_truth_risk";
  }
  return "needs_manual_review";
}

function classifyNative(rel: string, line: string, pattern: string): NativeHitClassification {
  const f = rel.replace(/\\/g, "/").toLowerCase();
  const l = line;
  if (isTestPath(f)) return "test_fixture";
  if (f.includes("/docs/")) return "needs_manual_review";
  if (f.includes("apppostv2/") && (f.includes("getpost") || f.includes("normalize"))) {
    if (l.includes("legacy") || l.includes("||") || l.includes("fallback")) return "legacy_fallback_helper_only";
    return "app_post_consumer_correct";
  }
  if (f.includes("mergepost") || f.includes("continuity/merge") || f.includes("optimistic")) return "optimistic_cache_risk";
  if (f.includes("posttile") && (pattern === "photoLink" || pattern === "displayPhotoLink" || pattern === "thumbUrl"))
    return "legacy_source_of_truth_risk";
  if (f.includes("activitymixesshelf") && (pattern === "thumbUrl" || pattern === "displayPhotoLink")) return "legacy_source_of_truth_risk";
  if (f.includes("liftableprecache") || f.includes("mediaprefetchcoordinator")) return "carousel_asset_risk";
  if (pattern === "dots" || (pattern === "pagination" && f.includes("liftable"))) return "dot_count_risk";
  if (pattern === "getPostActivities" || f.includes("getpostactivities")) return "app_post_consumer_correct";
  if (f.includes("getherouri") && (l.includes("displayPhotoLink") || l.includes("photoLink"))) return "legacy_fallback_helper_only";
  if (f.includes("assetcarouselonly") || f.includes("getpostmediaassets")) return "app_post_consumer_correct";
  if (
    ["photoLink", "displayPhotoLink", "assets[0]", "post.assets", "thumbUrl"].includes(pattern) &&
    f.includes("/features/") &&
    !f.includes("apppostv2") &&
    !f.includes("normalize") &&
    !l.includes("appPost")
  ) {
    return "legacy_source_of_truth_risk";
  }
  if (["Feed", "Home", "Search", "Map", "Profile", "Collection", "Mixes", "Reels"].includes(pattern)) return "needs_manual_review";
  return "needs_manual_review";
}

function scanRoot(
  baseDir: string,
  labelPrefix: string,
  terms: Array<{ pattern: string; re: RegExp }>,
  classify: (rel: string, line: string, pattern: string) => BackendHitClassification | NativeHitClassification
): { hits: Array<HitBase & { classification: string }>; patternCounts: Record<string, number> } {
  const hits: Array<HitBase & { classification: string }> = [];
  const patternCounts: Record<string, number> = {};
  for (const t of terms) patternCounts[t.pattern] = 0;

  for (const file of walkDir(baseDir)) {
    const rel = `${labelPrefix}/${path.relative(baseDir, file).replace(/\\/g, "/")}`;
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const { pattern, re } of terms) {
        const r = new RegExp(re.source, re.flags);
        if (r.test(line)) {
          patternCounts[pattern] = (patternCounts[pattern] ?? 0) + 1;
          hits.push({
            file: rel,
            line: i + 1,
            pattern,
            snippet: line.trim().slice(0, 240),
            classification: classify(rel, line, pattern) as string
          });
        }
      }
    }
  }
  return { hits, patternCounts };
}

function summarizeClass(hits: Array<{ classification: string }>): Record<string, number> {
  const m: Record<string, number> = {};
  for (const h of hits) m[h.classification] = (m[h.classification] ?? 0) + 1;
  return m;
}

function main(): void {
  const backendRoots = [
    { dir: path.join(BACKEND_ROOT, "src"), label: "Locava Backendv2/src" },
    { dir: path.join(BACKEND_ROOT, "scripts"), label: "Locava Backendv2/scripts" }
  ];
  const backendHits: BackendHit[] = [];
  const backendPatternTotals: Record<string, number> = {};
  for (const t of BACKEND_TERM_RES) backendPatternTotals[t.pattern] = 0;

  for (const { dir, label } of backendRoots) {
    if (!fs.existsSync(dir)) continue;
    const { hits, patternCounts } = scanRoot(dir, label, BACKEND_TERM_RES, classifyBackend);
    for (const p of Object.keys(patternCounts)) backendPatternTotals[p] = (backendPatternTotals[p] ?? 0) + patternCounts[p];
    backendHits.push(...(hits as BackendHit[]));
  }

  const nativeHits: NativeHit[] = [];
  const nativePatternTotals: Record<string, number> = {};
  for (const t of NATIVE_TERM_RES) nativePatternTotals[t.pattern] = 0;

  if (fs.existsSync(NATIVE_SRC)) {
    const { hits, patternCounts } = scanRoot(NATIVE_SRC, "Locava-Native/src", NATIVE_TERM_RES, classifyNative);
    for (const p of Object.keys(patternCounts)) nativePatternTotals[p] = (nativePatternTotals[p] ?? 0) + patternCounts[p];
    nativeHits.push(...(hits as NativeHit[]));
  }

  fs.mkdirSync(path.dirname(OUT_BACKEND_JSON), { recursive: true });
  fs.writeFileSync(
    OUT_BACKEND_JSON,
    JSON.stringify(
      {
        meta: {
          auditDate: AUDIT_DATE,
          generatedAt: new Date().toISOString(),
          workspaceRoot: WORKSPACE_ROOT,
          backendRoot: BACKEND_ROOT,
          totalHits: backendHits.length,
          uniqueFiles: new Set(backendHits.map((h) => h.file)).size
        },
        patternMatchLineCounts: backendPatternTotals,
        classificationCounts: summarizeClass(backendHits),
        hits: backendHits
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    OUT_NATIVE_JSON,
    JSON.stringify(
      {
        meta: {
          auditDate: AUDIT_DATE,
          generatedAt: new Date().toISOString(),
          nativeSrc: NATIVE_SRC,
          totalHits: nativeHits.length,
          uniqueFiles: new Set(nativeHits.map((h) => h.file)).size
        },
        patternMatchLineCounts: nativePatternTotals,
        classificationCounts: summarizeClass(nativeHits),
        hits: nativeHits
      },
      null,
      2
    ),
    "utf8"
  );

  let md = `# Full post surface inventory (machine-generated)\n\n`;
  md += `Date: ${AUDIT_DATE}\n\n`;
  md += `## Backend\n\n`;
  md += `- Total line hits: **${backendHits.length}**\n`;
  md += `- Unique files: **${new Set(backendHits.map((h) => h.file)).size}**\n\n`;
  md += `### Classification counts\n\n`;
  for (const [k, v] of Object.entries(summarizeClass(backendHits)).sort((a, b) => b[1] - a[1])) {
    md += `- ${k}: ${v}\n`;
  }
  md += `\n### Pattern line counts\n\n`;
  for (const [k, v] of Object.entries(backendPatternTotals).sort((a, b) => b[1] - a[1])) {
    md += `- \`${k}\`: ${v}\n`;
  }

  md += `\n## Native\n\n`;
  md += `- Total line hits: **${nativeHits.length}**\n`;
  md += `- Unique files: **${new Set(nativeHits.map((h) => h.file)).size}**\n\n`;
  md += `### Classification counts\n\n`;
  for (const [k, v] of Object.entries(summarizeClass(nativeHits)).sort((a, b) => b[1] - a[1])) {
    md += `- ${k}: ${v}\n`;
  }
  md += `\n### Pattern line counts (noisy broad terms at bottom)\n\n`;
  for (const [k, v] of Object.entries(nativePatternTotals).sort((a, b) => b[1] - a[1])) {
    md += `- \`${k}\`: ${v}\n`;
  }

  md += `\n## Outputs\n\n`;
  md += `- \`${path.relative(BACKEND_ROOT, OUT_BACKEND_JSON)}\`\n`;
  md += `- \`${path.relative(BACKEND_ROOT, OUT_NATIVE_JSON)}\`\n`;

  fs.writeFileSync(OUT_SUMMARY_MD, md, "utf8");

  console.log(`Wrote ${OUT_BACKEND_JSON}`);
  console.log(`Wrote ${OUT_NATIVE_JSON}`);
  console.log(`Wrote ${OUT_SUMMARY_MD}`);
  console.log(`Backend hits: ${backendHits.length}, Native hits: ${nativeHits.length}`);
}

main();
