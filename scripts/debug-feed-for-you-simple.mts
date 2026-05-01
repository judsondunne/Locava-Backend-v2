import { FieldPath } from "firebase-admin/firestore";
import { createApp } from "../src/app/createApp.js";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

async function wipePostsCollection(): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  while (true) {
    const snap = await db.collection("posts").orderBy(FieldPath.documentId(), "asc").limit(200).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
}

async function seedPosts(seedKey: string, count: number): Promise<string[]> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  const batch = db.batch();
  const ids: string[] = [];
  const baseMs = Date.now() + 200_000;
  for (let i = 0; i < count; i += 1) {
    const slot = i + 1;
    const postId = `${seedKey}-post-${String(slot).padStart(2, "0")}`;
    ids.push(postId);
    batch.set(
      db.collection("posts").doc(postId),
      {
        userId: `${seedKey}-author-${(slot % 4) + 1}`,
        ownerId: `${seedKey}-author-${(slot % 4) + 1}`,
        userHandle: `${seedKey}.author.${(slot % 4) + 1}`,
        userName: `Harness Author ${(slot % 4) + 1}`,
        userPic: `https://cdn.locava.test/users/${seedKey}-${(slot % 4) + 1}.jpg`,
        title: `Harness Post ${slot}`,
        caption: `Harness caption ${slot}`,
        description: `Harness caption ${slot}`,
        activities: ["hiking", "waterfall"],
        mediaType: slot % 3 === 0 ? "video" : "image",
        thumbUrl: `https://cdn.locava.test/posts/${postId}/thumb.jpg`,
        displayPhotoLink: `https://cdn.locava.test/posts/${postId}/display.jpg`,
        assets: [
          {
            id: `${postId}-asset`,
            type: slot % 3 === 0 ? "video" : "image",
            url: `https://cdn.locava.test/posts/${postId}/main.${slot % 3 === 0 ? "mp4" : "jpg"}`,
            poster: `https://cdn.locava.test/posts/${postId}/poster.jpg`,
            thumbnail: `https://cdn.locava.test/posts/${postId}/thumb.jpg`,
            variants:
              slot % 3 === 0
                ? {
                    preview360: `https://cdn.locava.test/posts/${postId}/preview.mp4`,
                    main720Avc: `https://cdn.locava.test/posts/${postId}/main.mp4`,
                    hls: `https://cdn.locava.test/posts/${postId}/stream.m3u8`,
                    poster: `https://cdn.locava.test/posts/${postId}/poster.jpg`
                  }
                : {}
          }
        ],
        time: baseMs - slot * 1_000,
        createdAtMs: baseMs - slot * 1_000,
        updatedAtMs: baseMs - slot * 1_000 + 100,
        lastUpdated: baseMs - slot * 1_000 + 100,
        randomKey: (slot + 0.5) / 100,
        privacy: "public",
        visibility: "public",
        status: "active",
        hidden: false,
        deleted: false,
        isDeleted: false,
        archived: false,
        likeCount: slot,
        likesCount: slot,
        commentCount: slot % 4,
        commentsCount: slot % 4,
        address: "Easton, PA",
        lat: 40.68843,
        lng: -75.22073,
        long: -75.22073,
        geoData: {
          city: "Easton",
          state: "Pennsylvania",
          country: "United States",
          geohash: "dr4e3x"
        }
      },
      { merge: true }
    );
  }
  await batch.commit();
  return ids;
}

async function hit(app: ReturnType<typeof createApp>, url: string) {
  const startedAt = Date.now();
  const response = await app.inject({
    method: "GET",
    url,
    headers: { "x-viewer-roles": "internal" }
  });
  const elapsedMs = Date.now() - startedAt;
  return {
    response,
    elapsedMs,
    bytes: Buffer.byteLength(response.payload, "utf8")
  };
}

async function main(): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const seedKey = `simple-harness-${Date.now()}`;
  const viewerId = `${seedKey}-viewer`;

  await wipePostsCollection();
  const seededIds = await seedPosts(seedKey, 12);

  const first = await hit(app, `/v2/feed/for-you/simple?viewerId=${viewerId}&limit=5`);
  if (first.response.statusCode !== 200) {
    throw new Error(`first_request_failed:${first.response.statusCode}`);
  }
  const firstBody = first.response.json() as {
    data: {
      items: Array<{ postId: string }>;
      nextCursor: string | null;
      debug: { dbReads?: number; elapsedMs?: number };
    };
  };

  const second = await hit(
    app,
    `/v2/feed/for-you/simple?viewerId=${viewerId}&limit=5&cursor=${encodeURIComponent(String(firstBody.data.nextCursor ?? ""))}`
  );
  if (second.response.statusCode !== 200) {
    throw new Error(`second_request_failed:${second.response.statusCode}`);
  }
  const secondBody = second.response.json() as {
    data: {
      items: Array<{ postId: string }>;
      nextCursor: string | null;
      debug: { dbReads?: number; elapsedMs?: number };
    };
  };

  const firstIds = firstBody.data.items.map((item) => item.postId);
  const secondIds = secondBody.data.items.map((item) => item.postId);
  const duplicates = secondIds.filter((postId) => firstIds.includes(postId));
  const verifySnaps = await db.getAll(...[...new Set([...firstIds, ...secondIds])].map((postId) => db.collection("posts").doc(postId)));
  const allVerifiedReal = verifySnaps.every((snap) => snap.exists);
  const allFromHarnessSeed = [...firstIds, ...secondIds].every((postId) => seededIds.includes(postId));
  const pass =
    firstIds.length > 0 &&
    secondIds.length > 0 &&
    duplicates.length === 0 &&
    Boolean(firstBody.data.nextCursor) &&
    allVerifiedReal &&
    allFromHarnessSeed;

  console.log(`first page IDs: ${firstIds.join(", ")}`);
  console.log(`second page IDs: ${secondIds.join(", ")}`);
  console.log(`duplicate count: ${duplicates.length}`);
  console.log(`first page elapsed ms: ${first.elapsedMs}`);
  console.log(`second page elapsed ms: ${second.elapsedMs}`);
  console.log(`first page payload bytes: ${first.bytes}`);
  console.log(`second page payload bytes: ${second.bytes}`);
  console.log(`first page nextCursor present: ${Boolean(firstBody.data.nextCursor)}`);
  console.log(`second page nextCursor present: ${Boolean(secondBody.data.nextCursor)}`);
  console.log(`verified real firestore docs: ${allVerifiedReal}`);
  console.log(`all from harness seed: ${allFromHarnessSeed}`);
  console.log(pass ? "PASS" : "FAIL");

  if (!pass) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
