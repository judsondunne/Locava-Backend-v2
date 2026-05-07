import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { readWasabiConfigFromEnv } from "../src/services/storage/wasabi-config.js";
import { headObjectExists } from "../src/services/storage/wasabi-staging.service.js";

type RepairRow = {
  postId: string;
  userId: string | null;
  brokenUrls: string[];
  finalPublicObjectExists: boolean;
  stagingObjectExists: boolean;
  proposedPatch: Record<string, unknown>;
};

function hasPendingUrl(value: unknown): boolean {
  return typeof value === "string" && value.includes("_pending.jpg");
}

function collectBrokenUrls(post: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  const push = (v: unknown) => {
    if (hasPendingUrl(v)) candidates.push(String(v));
  };
  push(post.displayPhotoLink);
  push(post.photoLink);
  push(post.photoLinks2);
  push(post.photoLinks3);
  push(post.thumbUrl);
  const assets = Array.isArray(post.assets) ? (post.assets as Record<string, unknown>[]) : [];
  for (const asset of assets) {
    push(asset.original);
    push(asset.poster);
    push(asset.thumbnail);
    const variants = asset.variants && typeof asset.variants === "object" ? (asset.variants as Record<string, unknown>) : {};
    for (const value of Object.values(variants)) {
      if (typeof value === "string") push(value);
      else if (value && typeof value === "object") {
        for (const inner of Object.values(value as Record<string, unknown>)) push(inner);
      }
    }
  }
  return [...new Set(candidates)];
}

async function main() {
  const write = process.argv.includes("--write");
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  const cfg = readWasabiConfigFromEnv();
  const snap = await db.collection("posts").where("mediaType", "==", "image").limit(500).get();
  const rows: RepairRow[] = [];

  for (const doc of snap.docs) {
    const post = (doc.data() ?? {}) as Record<string, unknown>;
    const brokenUrls = collectBrokenUrls(post);
    if (brokenUrls.length === 0) continue;
    const firstPending = brokenUrls[0] ?? "";
    const keyMatch = firstPending.match(/\/locava\.app\/(.+)$/);
    const finalKey = keyMatch?.[1] ?? "";
    const stagingKey = finalKey.replace(/^images\//, "postSessionStaging/");
    const finalPublicObjectExists = cfg && finalKey ? await headObjectExists(cfg, finalKey) : false;
    const stagingObjectExists = cfg && stagingKey ? await headObjectExists(cfg, stagingKey) : false;
    const proposedPatch: Record<string, unknown> = {
      assetsReady: false,
      mediaStatus: "processing",
      imageProcessingStatus: "pending",
      displayPhotoLink: FieldValue.delete(),
      photoLink: FieldValue.delete(),
      photoLinks2: FieldValue.delete(),
      photoLinks3: FieldValue.delete(),
      thumbUrl: FieldValue.delete()
    };
    rows.push({
      postId: doc.id,
      userId: typeof post.userId === "string" ? post.userId : null,
      brokenUrls,
      finalPublicObjectExists,
      stagingObjectExists,
      proposedPatch: {
        assetsReady: false,
        mediaStatus: "processing",
        imageProcessingStatus: "pending",
        clearDisplayFields: true
      }
    });
    if (write) {
      await doc.ref.update(proposedPatch);
    }
  }

  console.info(JSON.stringify({ scanned: snap.size, affected: rows.length, write, rows }, null, 2));
}

main().catch((error) => {
  console.error("[repair-broken-photo-pending-urls] failed", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
