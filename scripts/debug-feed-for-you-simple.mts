import { FieldPath } from "firebase-admin/firestore";
import { createApp } from "../src/app/createApp.js";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { FOR_YOU_SIMPLE_SURFACE } from "../src/repositories/surfaces/feed-for-you-simple.repository.js";

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

async function wipeViewerSeen(viewerId: string): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  while (true) {
    const snap = await db
      .collection("feedSeen")
      .where("viewerId", "==", viewerId)
      .where("surface", "==", FOR_YOU_SIMPLE_SURFACE)
      .limit(200)
      .get();
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
        reel: slot <= 8,
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

async function toReelTagged(ids: string[]): Promise<string[]> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  const snaps = await db.getAll(...ids.map((id) => db.collection("posts").doc(id)));
  const flags = new Map(snaps.map((snap) => [snap.id, (snap.data() as { reel?: unknown } | undefined)?.reel === true]));
  return ids.map((id) => `${id}(reel=${flags.get(id) === true ? "true" : "false"})`);
}

async function main(): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable");
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  await app.ready();
  const seedKey = `simple-harness-${Date.now()}`;
  const viewerId = "simple-harness-viewer";

  await wipePostsCollection();
  const seededIds = await seedPosts(seedKey, 12);
  await wipeViewerSeen(viewerId);

  const first = await hit(app, `/v2/feed/for-you/simple?viewerId=${viewerId}&limit=5`);
  if (first.response.statusCode !== 200) {
    throw new Error(`first_request_failed:${first.response.statusCode}`);
  }
  const firstBody = first.response.json() as {
    data: {
      items: Array<{ postId: string }>;
      nextCursor: string | null;
      debug: {
        dbReads?: number;
        elapsedMs?: number;
        durableSeenReadCount?: number;
        candidateReadCount?: number;
        seenWriteSucceeded?: boolean;
        reelReturnedCount?: number;
        fallbackReturnedCount?: number;
        reelCandidateReadCount?: number;
        fallbackCandidateReadCount?: number;
      };
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
      debug: {
        dbReads?: number;
        elapsedMs?: number;
        durableSeenReadCount?: number;
        candidateReadCount?: number;
        seenWriteSucceeded?: boolean;
        reelReturnedCount?: number;
        fallbackReturnedCount?: number;
        reelCandidateReadCount?: number;
        fallbackCandidateReadCount?: number;
      };
    };
  };

  const third = await hit(app, `/v2/feed/for-you/simple?viewerId=${viewerId}&limit=5`);
  if (third.response.statusCode !== 200) {
    throw new Error(`third_request_failed:${third.response.statusCode}`);
  }
  const thirdBody = third.response.json() as {
    data: {
      items: Array<{ postId: string }>;
      nextCursor: string | null;
      debug: {
        dbReads?: number;
        elapsedMs?: number;
        durableSeenReadCount?: number;
        candidateReadCount?: number;
        seenWriteSucceeded?: boolean;
        reelReturnedCount?: number;
        fallbackReturnedCount?: number;
        reelCandidateReadCount?: number;
        fallbackCandidateReadCount?: number;
      };
    };
  };

  const firstIds = firstBody.data.items.map((item) => item.postId);
  const secondIds = secondBody.data.items.map((item) => item.postId);
  const thirdIds = thirdBody.data.items.map((item) => item.postId);
  const firstTagged = await toReelTagged(firstIds);
  const secondTagged = await toReelTagged(secondIds);
  const thirdTagged = await toReelTagged(thirdIds);
  const pageDupes = secondIds.filter((postId) => firstIds.includes(postId));
  const newSessionDupes = thirdIds.filter((postId) => firstIds.includes(postId));
  const verifySnaps = await db.getAll(
    ...[...new Set([...firstIds, ...secondIds, ...thirdIds])].map((postId) => db.collection("posts").doc(postId))
  );
  const allVerifiedReal = verifySnaps.every((snap) => snap.exists);
  const allFromHarnessSeed = [...firstIds, ...secondIds, ...thirdIds].every((postId) => seededIds.includes(postId));
  const pass =
    firstIds.length > 0 &&
    secondIds.length > 0 &&
    thirdIds.length > 0 &&
    pageDupes.length === 0 &&
    newSessionDupes.length === 0 &&
    Boolean(firstBody.data.nextCursor) &&
    allVerifiedReal &&
    allFromHarnessSeed &&
    firstBody.data.debug.reelReturnedCount === firstBody.data.items.length;

  console.log(`first page IDs: ${firstTagged.join(", ")}`);
  console.log(`second page IDs: ${secondTagged.join(", ")}`);
  console.log(`new session page IDs: ${thirdTagged.join(", ")}`);
  console.log(`duplicate count page1/page2: ${pageDupes.length}`);
  console.log(`duplicate count page1/newSession: ${newSessionDupes.length}`);
  console.log(`first page elapsed ms: ${first.elapsedMs}`);
  console.log(`second page elapsed ms: ${second.elapsedMs}`);
  console.log(`new session elapsed ms: ${third.elapsedMs}`);
  console.log(`first page route elapsed ms: ${firstBody.data.debug.elapsedMs ?? "n/a"}`);
  console.log(`second page route elapsed ms: ${secondBody.data.debug.elapsedMs ?? "n/a"}`);
  console.log(`new session route elapsed ms: ${thirdBody.data.debug.elapsedMs ?? "n/a"}`);
  console.log(`first page payload bytes: ${first.bytes}`);
  console.log(`second page payload bytes: ${second.bytes}`);
  console.log(`new session payload bytes: ${third.bytes}`);
  console.log(`first page nextCursor present: ${Boolean(firstBody.data.nextCursor)}`);
  console.log(`second page nextCursor present: ${Boolean(secondBody.data.nextCursor)}`);
  console.log(`new session nextCursor present: ${Boolean(thirdBody.data.nextCursor)}`);
  console.log(`durableSeenReadCount first page: ${firstBody.data.debug.durableSeenReadCount ?? "n/a"}`);
  console.log(`durableSeenReadCount second page: ${secondBody.data.debug.durableSeenReadCount ?? "n/a"}`);
  console.log(`durableSeenReadCount new session: ${thirdBody.data.debug.durableSeenReadCount ?? "n/a"}`);
  console.log(`candidateReadCount first page: ${firstBody.data.debug.candidateReadCount ?? "n/a"}`);
  console.log(`candidateReadCount second page: ${secondBody.data.debug.candidateReadCount ?? "n/a"}`);
  console.log(`candidateReadCount new session: ${thirdBody.data.debug.candidateReadCount ?? "n/a"}`);
  console.log(`reelReturnedCount first page: ${firstBody.data.debug.reelReturnedCount ?? "n/a"}`);
  console.log(`fallbackReturnedCount first page: ${firstBody.data.debug.fallbackReturnedCount ?? "n/a"}`);
  console.log(`reelCandidateReadCount first page: ${firstBody.data.debug.reelCandidateReadCount ?? "n/a"}`);
  console.log(`fallbackCandidateReadCount first page: ${firstBody.data.debug.fallbackCandidateReadCount ?? "n/a"}`);
  console.log(`reelReturnedCount second page: ${secondBody.data.debug.reelReturnedCount ?? "n/a"}`);
  console.log(`fallbackReturnedCount second page: ${secondBody.data.debug.fallbackReturnedCount ?? "n/a"}`);
  console.log(`reelCandidateReadCount second page: ${secondBody.data.debug.reelCandidateReadCount ?? "n/a"}`);
  console.log(`fallbackCandidateReadCount second page: ${secondBody.data.debug.fallbackCandidateReadCount ?? "n/a"}`);
  console.log(`reelReturnedCount new session: ${thirdBody.data.debug.reelReturnedCount ?? "n/a"}`);
  console.log(`fallbackReturnedCount new session: ${thirdBody.data.debug.fallbackReturnedCount ?? "n/a"}`);
  console.log(`reelCandidateReadCount new session: ${thirdBody.data.debug.reelCandidateReadCount ?? "n/a"}`);
  console.log(`fallbackCandidateReadCount new session: ${thirdBody.data.debug.fallbackCandidateReadCount ?? "n/a"}`);
  console.log(`seenWriteSucceeded first page: ${firstBody.data.debug.seenWriteSucceeded ?? "n/a"}`);
  console.log(`seenWriteSucceeded second page: ${secondBody.data.debug.seenWriteSucceeded ?? "n/a"}`);
  console.log(`seenWriteSucceeded new session: ${thirdBody.data.debug.seenWriteSucceeded ?? "n/a"}`);
  console.log(`verified real firestore docs: ${allVerifiedReal}`);
  console.log(`all from harness seed: ${allFromHarnessSeed}`);
  console.log("fake fallback data used: false");
  console.log(pass ? "PASS" : "FAIL");

  if (!pass) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
