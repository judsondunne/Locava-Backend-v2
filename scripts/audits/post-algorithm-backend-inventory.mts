/**
 * Scans Backend V2 `src/` for post field reads and classifies algorithm surfaces.
 * Run: npx tsx scripts/audits/post-algorithm-backend-inventory.mts
 * Output: docs/audits/post-algorithm-backend-inventory-YYYY-MM-DD.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(BACKEND_ROOT, "src");
const TODAY = new Date().toISOString().slice(0, 10);
const OUT = path.join(BACKEND_ROOT, "docs", "audits", `post-algorithm-backend-inventory-${TODAY}.json`);

const SEARCH_RES: Array<{ id: string; re: RegExp }> = [
  { id: "activities_top", re: /\bactivities\b/g },
  { id: "primaryActivity", re: /\bprimaryActivity\b/g },
  { id: "settingType", re: /\bsettingType\b/g },
  { id: "privacy_visibility", re: /\b(privacy|visibility)\b/g },
  { id: "moderatorTier", re: /\bmoderatorTier\b/g },
  { id: "deleted_flags", re: /\b(deleted|isDeleted|archived|hidden)\b/g },
  { id: "lifecycle", re: /\blifecycle\b/g },
  { id: "userId_author", re: /\b(userId|author\.userId)\b/g },
  { id: "time_created", re: /\b(time|createdAtMs|createdAt|updatedAtMs|lastUpdated)\b/g },
  { id: "lat_lng", re: /\b(lat|lng|long)\b/g },
  { id: "geohash_geo", re: /\b(geohash|geoData)\b/g },
  { id: "region_ids", re: /\b(cityRegionId|stateRegionId|countryRegionId)\b/g },
  { id: "title_content_search", re: /\b(title|content|searchableText|searchText)\b/g },
  { id: "ranking", re: /\b(rankingAggregates|rankingRollup|qualityScoreCached)\b/g },
  { id: "impressions_opens", re: /\b(impressions|opens)\b/g },
  { id: "likes_comments", re: /\b(likesCount|likeCount|commentCount|commentsCount)\b/g },
  { id: "mediaType_reel", re: /\b(mediaType|reel)\b/g },
  { id: "assetsReady", re: /\bassetsReady\b/g },
  { id: "assets_length", re: /\bassets\b/g },
  { id: "photo_links", re: /\b(photoLink|displayPhotoLink|fallbackVideoUrl)\b/g },
  { id: "recordings", re: /\brecordings\b/g },
  { id: "collection_posts", re: /\b(collection|saved)\b/gi },
  { id: "feed_for_you", re: /\b(feed|for-you|forYou|bootstrap|page)\b/gi },
  { id: "search_mix", re: /\b(search|mix|mixes)\b/gi },
  { id: "map_radius", re: /\b(map|radius|nearby)\b/gi },
  { id: "notification_chat", re: /\b(notification|chat|sharedPost|deep\s*link)\b/gi },
];

type Bucket =
  | "query_filter_firestore_index"
  | "in_memory_filter"
  | "ranking_algorithm"
  | "search_algorithm"
  | "mix_generation"
  | "map_cluster_marker"
  | "profile_grid_selector"
  | "collection_selector"
  | "notification_post_preview"
  | "chat_shared_post_preview"
  | "detail_hydration"
  | "legacy_compat_proxy"
  | "test_fixture"
  | "selector_helper"
  | "needs_manual_review";

function classifyPath(file: string): Bucket {
  const f = file.replace(/\\/g, "/").toLowerCase();
  if (f.includes("postfieldselectors") || f.includes("post-algorithm")) return "selector_helper";
  if (f.includes(".test.") || f.includes("/test/")) return "test_fixture";
  if (f.includes("legacy-api") || f.includes("compat/legacy")) return "legacy_compat_proxy";
  if (f.includes("notification")) return "notification_post_preview";
  if (f.includes("chat")) return "chat_shared_post_preview";
  if (f.includes("mix")) return "mix_generation";
  if (f.includes("search")) return "search_algorithm";
  if (f.includes("map-marker") || f.includes("map_markers")) return "map_cluster_marker";
  if (f.includes("profile")) return "profile_grid_selector";
  if (f.includes("collection")) return "collection_selector";
  if (f.includes("feed-detail") || f.includes("post-detail") || f.includes("hydrat")) return "detail_hydration";
  if (f.includes("repository") || f.includes("firestore.adapter")) {
    if (f.includes("where") || f.includes("orderby")) return "query_filter_firestore_index";
    return "query_filter_firestore_index";
  }
  if (f.includes("rank") || f.includes("score")) return "ranking_algorithm";
  if (f.includes("feed")) return "in_memory_filter";
  return "needs_manual_review";
}

const SRC_EXT = new Set([".ts", ".mts", ".cts"]);

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (SRC_EXT.has(path.extname(e.name))) yield full;
  }
}

type Hit = { file: string; line: number; termId: string; snippet: string; bucket: Bucket };

const hits: Hit[] = [];

for (const file of walk(SRC)) {
  const rel = path.relative(BACKEND_ROOT, file);
  if (!rel.startsWith("src" + path.sep)) continue;
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\n/);
  const bucket = classifyPath(rel);
  lines.forEach((line, i) => {
    for (const { id, re } of SEARCH_RES) {
      re.lastIndex = 0;
      if (re.test(line)) {
        hits.push({
          file: rel.replace(/\\/g, "/"),
          line: i + 1,
          termId: id,
          snippet: line.trim().slice(0, 220),
          bucket,
        });
      }
    }
  });
}

const byFile = new Map<string, Hit[]>();
for (const h of hits) {
  const arr = byFile.get(h.file) ?? [];
  arr.push(h);
  byFile.set(h.file, arr);
}

const payload = {
  generatedAt: new Date().toISOString(),
  root: "Locava Backendv2/src",
  totalHits: hits.length,
  uniqueFiles: byFile.size,
  buckets: [...new Set(hits.map((h) => h.bucket))].sort(),
  termCounts: Object.fromEntries(
    SEARCH_RES.map(({ id }) => [id, hits.filter((h) => h.termId === id).length]).sort((a, b) => b[1] - a[1]),
  ),
  files: [...byFile.entries()]
    .map(([file, hh]) => ({ file, hitCount: hh.length, buckets: [...new Set(hh.map((x) => x.bucket))] }))
    .sort((a, b) => b.hitCount - a.hitCount),
  hitsSample: hits.slice(0, 400),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), "utf8");
console.log(`Wrote ${OUT} (${hits.length} hits, ${byFile.size} files)`);
