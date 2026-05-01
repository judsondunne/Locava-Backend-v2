import { describe, expect, it } from "vitest";
import { FieldPath } from "firebase-admin/firestore";
import { createApp } from "../../app/createApp.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { FOR_YOU_SIMPLE_SURFACE } from "../../repositories/surfaces/feed-for-you-simple.repository.js";

const isEmulator = process.env.FIRESTORE_TEST_MODE === "emulator";
const headers = { "x-viewer-roles": "internal" };

async function wipePostsCollection(): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable_for_test");
  while (true) {
    const snap = await db.collection("posts").orderBy(FieldPath.documentId(), "asc").limit(200).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
}

async function wipeFeedSeenCollection(): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable_for_test");
  while (true) {
    const snap = await db.collection("feedSeen").orderBy(FieldPath.documentId(), "asc").limit(200).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
}

async function seedSimplePosts(input: {
  seedKey: string;
  count: number;
  hiddenEvery?: number;
  privateEvery?: number;
  omitMediaEvery?: number;
  reelPredicate?: (slot: number) => boolean;
}): Promise<string[]> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable_for_test");
  const batch = db.batch();
  const ids: string[] = [];
  const baseMs = Date.now() + 500_000;
  for (let i = 0; i < input.count; i += 1) {
    const slot = i + 1;
    const postId = `${input.seedKey}-post-${String(slot).padStart(2, "0")}`;
    const hidden = input.hiddenEvery != null && slot % input.hiddenEvery === 0;
    const isPrivate = input.privateEvery != null && slot % input.privateEvery === 0;
    const omitMedia = input.omitMediaEvery != null && slot % input.omitMediaEvery === 0;
    ids.push(postId);
    batch.set(
      db.collection("posts").doc(postId),
      {
        userId: `${input.seedKey}-author-${(slot % 3) + 1}`,
        ownerId: `${input.seedKey}-author-${(slot % 3) + 1}`,
        userHandle: `${input.seedKey}.author.${(slot % 3) + 1}`,
        userName: `Simple Author ${(slot % 3) + 1}`,
        userPic: `https://cdn.locava.test/users/${input.seedKey}-${(slot % 3) + 1}.jpg`,
        title: `Simple Post ${slot}`,
        caption: `Simple caption ${slot}`,
        description: `Simple caption ${slot}`,
        activities: ["hiking", "waterfall"],
        mediaType: slot % 4 === 0 ? "video" : "image",
        thumbUrl: omitMedia ? "" : `https://cdn.locava.test/posts/${postId}/thumb.jpg`,
        displayPhotoLink: omitMedia ? "" : `https://cdn.locava.test/posts/${postId}/display.jpg`,
        assets: omitMedia
          ? []
          : [
              {
                id: `${postId}-asset`,
                type: slot % 4 === 0 ? "video" : "image",
                url: `https://cdn.locava.test/posts/${postId}/main.${slot % 4 === 0 ? "mp4" : "jpg"}`,
                poster: `https://cdn.locava.test/posts/${postId}/poster.jpg`,
                thumbnail: `https://cdn.locava.test/posts/${postId}/thumb.jpg`,
                variants:
                  slot % 4 === 0
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
        updatedAtMs: baseMs - slot * 1_000 + 200,
        lastUpdated: baseMs - slot * 1_000 + 200,
        randomKey: (slot + 0.5) / 100,
        reel: input.reelPredicate ? input.reelPredicate(slot) : true,
        privacy: isPrivate ? "private" : "public",
        visibility: isPrivate ? "private" : "public",
        status: hidden ? "archived" : "active",
        hidden,
        deleted: false,
        isDeleted: false,
        archived: false,
        likeCount: slot,
        likesCount: slot,
        commentCount: slot % 3,
        commentsCount: slot % 3,
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

async function verifyDocsExist(postIds: string[]): Promise<boolean> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable_for_test");
  const snaps = await db.getAll(...postIds.map((postId) => db.collection("posts").doc(postId)));
  return snaps.every((snap) => snap.exists);
}

async function listViewerSeenPostIds(viewerId: string): Promise<string[]> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable_for_test");
  const snap = await db
    .collection("feedSeen")
    .where("viewerId", "==", viewerId)
    .where("surface", "==", FOR_YOU_SIMPLE_SURFACE)
    .limit(500)
    .get();
  return snap.docs
    .map((doc) => (doc.data() as { postId?: unknown }).postId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

async function getReelFlags(postIds: string[]): Promise<Map<string, boolean>> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable_for_test");
  const snaps = await db.getAll(...postIds.map((postId) => db.collection("posts").doc(postId)));
  const out = new Map<string, boolean>();
  for (const snap of snaps) {
    out.set(snap.id, (snap.data() as { reel?: unknown } | undefined)?.reel === true);
  }
  return out;
}

describe.runIf(isEmulator)("v2 feed for-you simple route (emulator)", () => {
  it("prioritizes reel posts first when enough reel posts exist", async () => {
    await wipePostsCollection();
    await wipeFeedSeenCollection();
    const viewerId = "simple-viewer-reel-priority";
    await seedSimplePosts({
      seedKey: `simple-reel-priority-${Date.now()}`,
      count: 16,
      reelPredicate: (slot) => slot <= 8
    });
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const response = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you/simple?viewerId=${viewerId}&limit=5`,
      headers
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        items: Array<{ postId: string }>;
        debug: { reelFirstEnabled: boolean; reelReturnedCount: number; fallbackReturnedCount: number };
      };
    };
    expect(body.data.items).toHaveLength(5);
    const reelFlags = await getReelFlags(body.data.items.map((item) => item.postId));
    expect(body.data.items.every((item) => reelFlags.get(item.postId) === true)).toBe(true);
    expect(new Set(body.data.items.map((item) => item.postId)).size).toBe(body.data.items.length);
    expect(body.data.debug.reelFirstEnabled).toBe(true);
    expect(body.data.debug.reelReturnedCount).toBe(5);
    expect(body.data.debug.fallbackReturnedCount).toBe(0);
  });

  it("falls back to normal random posts after reel posts are exhausted", async () => {
    await wipePostsCollection();
    await wipeFeedSeenCollection();
    const viewerId = "simple-viewer-reel-fallback";
    await seedSimplePosts({
      seedKey: `simple-reel-fallback-${Date.now()}`,
      count: 12,
      reelPredicate: (slot) => slot <= 2
    });
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const response = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you/simple?viewerId=${viewerId}&limit=5`,
      headers
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        items: Array<{ postId: string }>;
        debug: { reelReturnedCount: number; fallbackReturnedCount: number };
      };
    };
    expect(body.data.items).toHaveLength(5);
    expect(body.data.debug.reelReturnedCount).toBe(2);
    expect(body.data.debug.fallbackReturnedCount).toBe(3);
    const reelFlags = await getReelFlags(body.data.items.map((item) => item.postId));
    const reelCount = body.data.items.filter((item) => reelFlags.get(item.postId) === true).length;
    expect(reelCount).toBe(2);
    expect(new Set(body.data.items.map((item) => item.postId)).size).toBe(body.data.items.length);
  });

  it("durable seen still works with reel-first pagination", async () => {
    await wipePostsCollection();
    await wipeFeedSeenCollection();
    const viewerId = "simple-viewer-reel-paging";
    await seedSimplePosts({ seedKey: `simple-reel-paging-${Date.now()}`, count: 12, reelPredicate: () => true });
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const first = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you/simple?viewerId=${viewerId}&limit=5`,
      headers
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      data: {
        items: Array<{ postId: string }>;
        nextCursor: string | null;
        debug: { reelReturnedCount: number };
      };
    };
    const second = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you/simple?viewerId=${viewerId}&limit=5&cursor=${encodeURIComponent(String(firstBody.data.nextCursor))}`,
      headers
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as {
      data: {
        items: Array<{ postId: string }>;
        debug: { reelReturnedCount: number; seenWriteSucceeded: boolean };
      };
    };
    const firstIds = new Set(firstBody.data.items.map((item) => item.postId));
    const secondIds = new Set(secondBody.data.items.map((item) => item.postId));
    expect([...secondIds].some((postId) => firstIds.has(postId))).toBe(false);
    expect(firstBody.data.debug.reelReturnedCount).toBe(firstBody.data.items.length);
    expect(secondBody.data.debug.reelReturnedCount).toBe(secondBody.data.items.length);
    expect(secondBody.data.debug.seenWriteSucceeded).toBe(true);
    const seenPostIds = await listViewerSeenPostIds(viewerId);
    expect(seenPostIds.length).toBeGreaterThanOrEqual(firstIds.size);
  });

  it("new session avoids previously served reel posts for the same viewer", async () => {
    await wipePostsCollection();
    await wipeFeedSeenCollection();
    const viewerId = "simple-viewer-reel-new-session";
    await seedSimplePosts({ seedKey: `simple-reel-new-session-${Date.now()}`, count: 14, reelPredicate: () => true });
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

    const first = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you/simple?viewerId=${viewerId}&limit=5`,
      headers
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      data: {
        items: Array<{ postId: string }>;
      };
    };
    const secondSession = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you/simple?viewerId=${viewerId}&limit=5`,
      headers
    });
    expect(secondSession.statusCode).toBe(200);
    const secondBody = secondSession.json() as {
      data: {
        items: Array<{ postId: string }>;
        debug: { durableSeenReadCount: number; durableSeenFilteredCount: number };
      };
    };
    expect(firstBody.data.items).toHaveLength(5);
    expect(secondBody.data.items).toHaveLength(5);
    const firstIds = new Set(firstBody.data.items.map((item) => item.postId));
    const secondIds = new Set(secondBody.data.items.map((item) => item.postId));
    expect([...secondIds].some((postId) => firstIds.has(postId))).toBe(false);
    expect(secondBody.data.debug.durableSeenReadCount).toBeGreaterThan(0);
    expect(secondBody.data.debug.durableSeenFilteredCount).toBeGreaterThanOrEqual(0);
  });

  it("different viewers may overlap on reel posts without global suppression", async () => {
    await wipePostsCollection();
    await wipeFeedSeenCollection();
    await seedSimplePosts({ seedKey: `simple-reel-overlap-${Date.now()}`, count: 12, reelPredicate: () => true });
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const viewerA = await app.inject({
      method: "GET",
      url: "/v2/feed/for-you/simple?viewerId=simple-reel-viewer-a&limit=5",
      headers
    });
    const viewerB = await app.inject({
      method: "GET",
      url: "/v2/feed/for-you/simple?viewerId=simple-reel-viewer-b&limit=5",
      headers
    });
    expect(viewerA.statusCode).toBe(200);
    expect(viewerB.statusCode).toBe(200);
    const bodyA = viewerA.json() as {
      data: {
        items: Array<{ postId: string }>;
        debug: { reelReturnedCount: number };
      };
    };
    const bodyB = viewerB.json() as {
      data: {
        items: Array<{ postId: string }>;
        debug: { reelReturnedCount: number };
      };
    };
    expect(bodyA.data.items).toHaveLength(5);
    expect(bodyB.data.items).toHaveLength(5);
    expect(bodyA.data.debug.reelReturnedCount).toBe(5);
    expect(bodyB.data.debug.reelReturnedCount).toBe(5);
    expect(await verifyDocsExist(bodyA.data.items.map((item) => item.postId))).toBe(true);
    expect(await verifyDocsExist(bodyB.data.items.map((item) => item.postId))).toBe(true);
  });

  it("anonymous users still get reel-first posts and do not write durable seen", async () => {
    await wipePostsCollection();
    await wipeFeedSeenCollection();
    await seedSimplePosts({
      seedKey: `simple-reel-anon-${Date.now()}`,
      count: 12,
      reelPredicate: (slot) => slot <= 8
    });
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const response = await app.inject({
      method: "GET",
      url: "/v2/feed/for-you/simple?limit=5",
      headers
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        items: Array<{ postId: string }>;
        debug: { seenWriteAttempted: boolean; reelReturnedCount: number };
      };
    };
    expect(body.data.items).toHaveLength(5);
    expect(body.data.debug.seenWriteAttempted).toBe(false);
    expect(body.data.debug.reelReturnedCount).toBe(5);
    const reelFlags = await getReelFlags(body.data.items.map((item) => item.postId));
    expect(body.data.items.every((item) => reelFlags.get(item.postId) === true)).toBe(true);
  });

  it("returns fewer posts with bounded exhaustion and no fake data", async () => {
    await wipePostsCollection();
    await wipeFeedSeenCollection();
    const seedKey = `simple-reel-exhaustion-${Date.now()}`;
    const viewerId = "simple-reel-viewer-exhaustion";
    const ids = await seedSimplePosts({ seedKey, count: 6, reelPredicate: (slot) => slot <= 2 });
    const db = getFirestoreSourceClient();
    if (!db) throw new Error("firestore_unavailable_for_test");
    const seenBatch = db.batch();
    for (const postId of ids.slice(0, 5)) {
      seenBatch.set(db.collection("feedSeen").doc(`${viewerId}_${postId}`), {
        viewerId,
        postId,
        surface: FOR_YOU_SIMPLE_SURFACE,
        lastServedAt: new Date(),
        servedCount: 2
      });
    }
    await seenBatch.commit();

    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const response = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you/simple?viewerId=${viewerId}&limit=5`,
      headers
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        items: Array<{ postId: string }>;
        debug: {
          exhaustedUnseenCandidates: boolean;
          recycledSeenPosts: boolean;
          boundedAttempts: number;
          reelPhaseExhausted: boolean;
        };
      };
    };
    expect(body.data.items.length).toBeLessThanOrEqual(1);
    expect(body.data.debug.exhaustedUnseenCandidates || body.data.debug.reelPhaseExhausted).toBe(true);
    expect(body.data.debug.recycledSeenPosts).toBe(false);
    expect(body.data.debug.boundedAttempts).toBeLessThanOrEqual(4);
    expect(await verifyDocsExist(body.data.items.map((item) => item.postId))).toBe(true);
  });

  it("handles seen-ledger write failures as non-fatal route responses", async () => {
    await wipePostsCollection();
    await wipeFeedSeenCollection();
    await seedSimplePosts({ seedKey: `simple-page-6-${Date.now()}`, count: 12 });
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const db = getFirestoreSourceClient();
    if (!db) throw new Error("firestore_unavailable_for_test");
    const dbNonNull = db;

    const mutableDb = dbNonNull as unknown as { batch: () => ReturnType<typeof dbNonNull.batch> };
    const originalBatch = mutableDb.batch.bind(dbNonNull);
    mutableDb.batch = () => {
      throw new Error("forced_seen_batch_failure");
    };

    try {
      const response = await app.inject({
        method: "GET",
        url: "/v2/feed/for-you/simple?viewerId=simple-viewer-write-fail&limit=5",
        headers
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        data: {
          items: Array<{ postId: string }>;
          debug: { seenWriteAttempted: boolean; seenWriteSucceeded: boolean };
        };
      };
      expect(body.data.items.length).toBeGreaterThan(0);
      expect(body.data.debug.seenWriteAttempted).toBe(true);
      expect(body.data.debug.seenWriteSucceeded).toBe(false);
    } finally {
      mutableDb.batch = originalBatch;
    }
  });

  it("returns 400 for an invalid cursor instead of crashing", async () => {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const response = await app.inject({
      method: "GET",
      url: "/v2/feed/for-you/simple?viewerId=simple-viewer-c&limit=5&cursor=not-a-real-cursor",
      headers
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("invalid_cursor");
  });

  it("returns an empty truthful payload when no eligible posts exist", async () => {
    await wipePostsCollection();
    await wipeFeedSeenCollection();
    await seedSimplePosts({
      seedKey: `simple-empty-${Date.now()}`,
      count: 6,
      hiddenEvery: 2,
      privateEvery: 3,
      omitMediaEvery: 1
    });
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

    const response = await app.inject({
      method: "GET",
      url: "/v2/feed/for-you/simple?viewerId=simple-viewer-d&limit=5",
      headers
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        items: Array<{ postId: string }>;
        nextCursor: string | null;
      };
    };
    expect(body.data.items).toEqual([]);
    expect(body.data.nextCursor).toBeNull();
  });
});
