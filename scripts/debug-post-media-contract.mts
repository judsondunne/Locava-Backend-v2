import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { toAppPostV2FromAny } from "../src/lib/posts/app-post-v2/toAppPostV2.js";
import { serializeCanonicalPost } from "../src/services/posts/serializeCanonicalPost.js";
import { resolveCanonicalPostMedia } from "../src/services/posts/resolveCanonicalPostMedia.js";

function pickPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

async function main() {
  const postId = String(process.argv[2] ?? "").trim();
  if (!postId) {
    throw new Error("usage: npm run debug:post-media -- <postId>");
  }
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("firestore source client unavailable");
  }
  const snap = await db.collection("posts").doc(postId).get();
  if (!snap.exists) {
    throw new Error(`post not found: ${postId}`);
  }
  const raw = (snap.data() ?? {}) as Record<string, unknown>;
  const canonical = toAppPostV2FromAny(raw, { postId, forceNormalize: true });
  const resolved = resolveCanonicalPostMedia(canonical);
  const serialized = serializeCanonicalPost({ rawPost: raw, postId });
  const serializedResolved = resolveCanonicalPostMedia(serialized);

  const out = {
    postId,
    rawFirestore: {
      "classification.mediaKind": pickPath(raw, "classification.mediaKind") ?? pickPath(raw, "mediaType") ?? null,
      "media.assetCount": pickPath(raw, "media.assetCount") ?? null,
      "media.assets.length": Array.isArray(pickPath(raw, "media.assets"))
        ? (pickPath(raw, "media.assets") as unknown[]).length
        : 0,
      "media.assets[0].type": pickPath(raw, "media.assets.0.type") ?? null,
      "media.assets[0].image.displayUrl": pickPath(raw, "media.assets.0.image.displayUrl") ?? null,
      "media.assets[0].image.originalUrl": pickPath(raw, "media.assets.0.image.originalUrl") ?? null,
      "media.assets[0].image.thumbnailUrl": pickPath(raw, "media.assets.0.image.thumbnailUrl") ?? null,
      "media.assets[0].image.width": pickPath(raw, "media.assets.0.image.width") ?? null,
      "media.assets[0].image.height": pickPath(raw, "media.assets.0.image.height") ?? null,
      "media.assets[0].presentation.letterboxGradient": pickPath(raw, "media.assets.0.presentation.letterboxGradient") ?? null,
      "media.assets[0].video.playback.startupUrl":
        pickPath(raw, "media.assets.0.video.playback.startupUrl") ?? null,
      "media.assets[0].video.readiness.instantPlaybackReady":
        pickPath(raw, "media.assets.0.video.readiness.instantPlaybackReady") ?? null,
      "engagement.likeCount": pickPath(raw, "engagement.likeCount") ?? null,
      "engagement.commentCount": pickPath(raw, "engagement.commentCount") ?? null,
      "engagementPreview.recentComments.length": Array.isArray(pickPath(raw, "engagementPreview.recentComments"))
        ? (pickPath(raw, "engagementPreview.recentComments") as unknown[]).length
        : 0,
      "engagementPreview.recentLikers.length": Array.isArray(pickPath(raw, "engagementPreview.recentLikers"))
        ? (pickPath(raw, "engagementPreview.recentLikers") as unknown[]).length
        : 0,
    },
    resolved: {
      kind: resolved.kind,
      "media.assets.length": resolved.assets.length,
      "media.assets[0].type": resolved.assets[0]?.type ?? null,
      "media.assets[0].video.playback.startupUrl":
        resolved.assets[0]?.type === "video" ? resolved.assets[0].video?.playback?.startupUrl ?? null : null,
    },
    serialized: {
      kind: serializedResolved.kind,
      "media.assets.length": serialized.media.assets.length,
      "media.assets[0].type": serialized.media.assets[0]?.type ?? null,
      "media.assets[0].video.playback.startupUrl":
        serialized.media.assets[0]?.type === "video"
          ? serialized.media.assets[0].video?.playback?.startupUrl ?? null
          : null,
    },
  };

  if (
    out.rawFirestore["media.assets[0].type"] === "video" &&
    out.serialized["media.assets[0].type"] !== "video"
  ) {
    throw new Error(`canonical video dropped during serialization for ${postId}`);
  }
  console.log(JSON.stringify(out, null, 2));
}

void main();

