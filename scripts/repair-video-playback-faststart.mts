/**
 * Re-enqueue Backendv2 video faststart generation for broken posts (variants pointing at original,
 * or stuck playbackLab queue).
 *
 * Usage:
 *   FIRESTORE_TEST_MODE=disabled npx tsx scripts/repair-video-playback-faststart.mts --dry-run --postId post_xxx
 *   npx tsx scripts/repair-video-playback-faststart.mts --postId post_xxx
 *
 * Requires GCP_PROJECT_ID / GCLOUD_PROJECT / FIREBASE_PROJECT_ID for Cloud Tasks enqueue.
 */
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { enqueueVideoProcessingCloudTask } from "../src/services/posting/video-processing-cloud-task.service.js";

function parseArgs(argv: string[]): {
  dryRun: boolean;
  postId?: string;
} {
  const dryRun = argv.includes("--dry-run");
  const idx = argv.indexOf("--postId");
  const postId = idx >= 0 && argv[idx + 1] ? String(argv[idx + 1]).trim() : undefined;
  return { dryRun, postId };
}

function needsRepair(post: Record<string, unknown>): { needed: boolean; reason: string } {
  const assets = Array.isArray(post.assets) ? (post.assets as Record<string, unknown>[]) : [];
  const v0 = assets.find((a) => String(a.type ?? "").toLowerCase() === "video");
  if (!v0) return { needed: false, reason: "no_video_asset" };
  const original = String(v0.original ?? "").trim();
  const variants = (v0.variants ?? {}) as Record<string, unknown>;
  const preview = String(variants.preview360Avc ?? variants.preview360 ?? "").trim();
  const mainAvc = String(variants.main720Avc ?? "").trim();
  const main = String(variants.main720 ?? "").trim();
  if (!original) return { needed: false, reason: "missing_original" };
  if (!mainAvc) return { needed: true, reason: "missing_main720Avc" };
  if (mainAvc === original) return { needed: true, reason: "main720Avc_alias_original" };
  if (preview && preview === original) return { needed: true, reason: "preview_alias_original" };
  if (main && main === original) return { needed: true, reason: "main720_alias_original" };
  const pl = post.playbackLab as Record<string, unknown> | undefined;
  const st = String(pl?.status ?? post.playbackLabStatus ?? "").toLowerCase();
  if (["queued", "pending", "processing", "partial"].includes(st) && post.assetsReady !== true) {
    return { needed: true, reason: `playback_lab_stuck:${st}` };
  }
  if (post.playbackReady === false && post.videoProcessingStatus === "completed") {
    return { needed: true, reason: "completed_without_playback_ready" };
  }
  return { needed: false, reason: "ok" };
}

async function main(): Promise<void> {
  const { dryRun, postId } = parseArgs(process.argv.slice(2));
  if (!postId) {
    console.error("Usage: --postId <id> [--dry-run]");
    process.exit(1);
  }
  const db = getFirestoreSourceClient();
  if (!db) {
    console.error("Firestore unavailable");
    process.exit(1);
  }
  const snap = await db.collection("posts").doc(postId).get();
  if (!snap.exists) {
    console.error("post_not_found");
    process.exit(1);
  }
  const post = (snap.data() ?? {}) as Record<string, unknown>;
  const userId = String(post.userId ?? "").trim();
  const { needed, reason } = needsRepair(post);
  console.log(JSON.stringify({ postId, needed, reason, dryRun }, null, 2));
  if (!needed) {
    process.exit(0);
  }
  const assets = Array.isArray(post.assets) ? (post.assets as Record<string, unknown>[]) : [];
  const videoAssets = assets
    .filter((a) => String(a.type ?? "").toLowerCase() === "video")
    .map((a) => ({
      id: String(a.id ?? "").trim(),
      original: String(a.original ?? "").trim()
    }))
    .filter((a) => a.id.length > 0 && /^https?:\/\//i.test(a.original));
  if (videoAssets.length === 0) {
    console.error("no_video_assets_with_urls");
    process.exit(1);
  }
  if (!userId) {
    console.error("missing_userId");
    process.exit(1);
  }
  if (dryRun) {
    console.log(JSON.stringify({ enqueue: "skipped_dry_run", videoAssets }, null, 2));
    process.exit(0);
  }
  const r = await enqueueVideoProcessingCloudTask({ postId, userId, videoAssets });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
