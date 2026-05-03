/**
 * Local debug: load a Firestore post document and print canonical video variant selection.
 *
 * Usage:
 *   npm run debug:video:variant-selection -- --postId <id>
 *
 * Requires FIRESTORE_SOURCE_ENABLED and credentials like other debug scripts.
 */
import "dotenv/config";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import {
  playbackBatchShouldFetchFirestoreDetail,
  selectBestVideoPlaybackAsset,
} from "../src/lib/posts/video-playback-selection.js";
import { buildPostMediaReadiness } from "../src/lib/posts/media-readiness.js";

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return undefined;
  return process.argv[idx + 1]?.trim() || undefined;
}

function collectUrlsFromValue(value: unknown, out: Set<string>): void {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    out.add(value.trim());
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const v of Object.values(value as Record<string, unknown>)) {
    collectUrlsFromValue(v, out);
  }
}

function main(): void {
  const postId = argValue("--postId");
  if (!postId) {
    console.error("Usage: npm run debug:video:variant-selection -- --postId <postId>");
    process.exit(1);
  }
  const db = getFirestoreSourceClient();
  if (!db) {
    console.error("Firestore client unavailable (check FIRESTORE_SOURCE_ENABLED / credentials).");
    process.exit(2);
  }

  void (async () => {
    const snap = await db.collection("posts").doc(postId).get();
    if (!snap.exists) {
      console.error(`No document posts/${postId}`);
      process.exit(3);
    }
    const raw = snap.data() as Record<string, unknown>;
    const post = { ...raw, postId };

    const urls = new Set<string>();
    collectUrlsFromValue(post.assets, urls);
    collectUrlsFromValue(post.playbackLab, urls);
    if (typeof post.fallbackVideoUrl === "string") urls.add(post.fallbackVideoUrl);
    if (typeof post.playbackUrl === "string") urls.add(post.playbackUrl);

    const card = selectBestVideoPlaybackAsset(post, {
      hydrationMode: "card",
      allowPreviewOnly: true,
      includeDiagnostics: true,
    });
    const playback = selectBestVideoPlaybackAsset(post, {
      hydrationMode: "playback",
      allowPreviewOnly: true,
      includeDiagnostics: true,
    });
    const detail = selectBestVideoPlaybackAsset(post, {
      hydrationMode: "detail",
      allowPreviewOnly: true,
      includeDiagnostics: true,
    });
    const readiness = buildPostMediaReadiness(post, { hydrationMode: "detail" });

    console.log(
      JSON.stringify(
        {
          postId,
          mediaType: post.mediaType,
          assetsReady: post.assetsReady,
          videoProcessingStatus: post.videoProcessingStatus,
          wouldFetchPlaybackBatch: playbackBatchShouldFetchFirestoreDetail(post),
          detectedHttpUrls: [...urls].sort(),
          selectionCard: card,
          selectionPlayback: playback,
          selectionDetail: detail,
          mediaReadiness: readiness,
        },
        null,
        2,
      ),
    );
  })().catch((e) => {
    console.error(e);
    process.exit(4);
  });
}

main();
