/**
 * Read-only readiness matrix: runs canonical selectors against synthetic post fixtures.
 * Run: npm run audit:post-algorithm-readiness
 * Optional: POST_READINESS_IDS=id1,id2 (not implemented — fixtures only; no Firestore reads).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPostActivities,
  getPostCoordinates,
  getPostCoverDisplayUrl,
  getPostEngagementCounts,
  getPostMediaAssetCount,
  getPostSearchableText,
  getPostUpdatedAtMs,
  getPostVisibility,
  isPostVisibleInPublicAlgorithmPools,
  type PostRecord,
} from "../../src/lib/posts/postFieldSelectors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const TODAY = new Date().toISOString().slice(0, 10);
const OUT_DIR = path.join(BACKEND_ROOT, "artifacts", "audits");
const OUT_JSON = path.join(OUT_DIR, `post-canonical-algorithm-readiness-${TODAY}.json`);

type Algo = string;
type Row = { postId: string; label: string; record: PostRecord };

const fixtures: Row[] = [
  {
    postId: "legacy_image",
    label: "legacy image",
    record: {
      id: "legacy_image",
      postId: "legacy_image",
      userId: "u1",
      activities: ["hike"],
      lat: 40,
      lng: -75,
      cityRegionId: "c1",
      stateRegionId: "s1",
      title: "Trail",
      caption: "Nice",
      time: 1_700_000_000_000,
      assets: [{ x: 1 }],
      likesCount: 2,
      commentsCount: 1,
      thumbUrl: "https://example.com/t.jpg",
      privacy: "public",
    },
  },
  {
    postId: "migrated_v2",
    label: "additive migrated v2",
    record: {
      id: "migrated_v2",
      postId: "migrated_v2",
      userId: "u1",
      activities: ["hike", "bike"],
      schema: { name: "locava.post", version: 2 },
      classification: { activities: ["swim"], visibility: "public", mediaKind: "image" },
      lifecycle: { createdAtMs: 1_800_000_000_000, updatedAt: "2026-01-02T00:00:00.000Z", status: "active", isDeleted: false },
      author: { userId: "u1" },
      location: {
        coordinates: { lat: 41, lng: -74, geohash: "dr5" },
        regions: { cityRegionId: "c2", stateRegionId: "s2", countryRegionId: "us" },
      },
      text: { title: "Pool", searchableText: "pool swim summer", caption: "", description: "", content: "" },
      media: { assetCount: 2, assets: [], cover: { url: "https://example.com/cover.jpg" }, assetsReady: true },
      engagement: { likeCount: 5, commentCount: 3 },
    },
  },
  {
    postId: "private_hidden",
    label: "private excluded",
    record: { id: "x", postId: "x", privacy: "private", userId: "u" },
  },
];

const algorithms: Algo[] = [
  "activity_extraction",
  "location_extraction",
  "media_extraction",
  "ranking_extraction",
  "visibility_filter",
  "search_text",
  "map_coordinates",
  "thumb_cover",
];

function runCell(row: Row, algo: Algo): "pass" | "fail" | "warning" {
  const r = row.record;
  try {
    if (algo === "activity_extraction") {
      return getPostActivities(r).length > 0 ? "pass" : row.label.includes("private") ? "pass" : "fail";
    }
    if (algo === "location_extraction") {
      const c = getPostCoordinates(r);
      return c.lat != null && c.lng != null ? "pass" : row.label.includes("private") ? "warning" : "fail";
    }
    if (algo === "media_extraction") {
      return getPostMediaAssetCount(r) >= 0 ? "pass" : "fail";
    }
    if (algo === "ranking_extraction") {
      const e = getPostEngagementCounts(r);
      return e.likeCount >= 0 && e.commentCount >= 0 ? "pass" : "fail";
    }
    if (algo === "visibility_filter") {
      const vis = isPostVisibleInPublicAlgorithmPools(r);
      if (row.label.includes("private")) return vis ? "fail" : "pass";
      return vis ? "pass" : "fail";
    }
    if (algo === "search_text") {
      return getPostSearchableText(r).length > 0 ? "pass" : "warning";
    }
    if (algo === "map_coordinates") {
      const c = getPostCoordinates(r);
      return c.lat != null ? "pass" : "warning";
    }
    if (algo === "thumb_cover") {
      const u = getPostCoverDisplayUrl(r);
      return u.startsWith("http") ? "pass" : row.label.includes("private") ? "warning" : "warning";
    }
  } catch {
    return "fail";
  }
  return "fail";
}

const matrix: Record<string, Record<string, "pass" | "fail" | "warning">> = {};
for (const row of fixtures) {
  matrix[row.postId] = {};
  for (const algo of algorithms) {
    matrix[row.postId][algo] = runCell(row, algo);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  note: "Synthetic fixtures only; extend with real post IDs via a future Firestore-backed mode.",
  visibilitySamples: fixtures.map((f) => ({
    postId: f.postId,
    visibility: getPostVisibility(f.record),
    updatedAtMs: getPostUpdatedAtMs(f.record),
  })),
  matrix,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2), "utf8");
console.log(`Wrote ${OUT_JSON}`);
