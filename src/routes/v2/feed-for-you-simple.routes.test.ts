import { describe, expect, it } from "vitest";
import { FieldPath } from "firebase-admin/firestore";
import { createApp } from "../../app/createApp.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

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

async function seedSimplePosts(input: {
  seedKey: string;
  count: number;
  hiddenEvery?: number;
  privateEvery?: number;
  omitMediaEvery?: number;
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

describe.runIf(isEmulator)("v2 feed for-you simple route (emulator)", () => {
  it("returns a real first page with cursor, debug timing, and a lean payload", async () => {
    await wipePostsCollection();
    const seededIds = await seedSimplePosts({ seedKey: `simple-page-1-${Date.now()}`, count: 12 });
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

    const response = await app.inject({
      method: "GET",
      url: "/v2/feed/for-you/simple?viewerId=simple-viewer-a&limit=5",
      headers
    });

    expect(response.statusCode).toBe(200);
    expect(Buffer.byteLength(response.payload, "utf8")).toBeLessThan(25_000);
    const body = response.json() as {
      data: {
        items: Array<{ postId: string }>;
        nextCursor: string | null;
        debug: {
          source: string;
          requestedLimit: number;
          returnedCount: number;
          cursorUsed: boolean;
          elapsedMs?: number;
          dbReads?: number;
        };
      };
    };
    expect(body.data.items.length).toBeLessThanOrEqual(5);
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.debug.source).toBe("firestore_random_simple");
    expect(body.data.debug.requestedLimit).toBe(5);
    expect(body.data.debug.returnedCount).toBe(body.data.items.length);
    expect(body.data.debug.cursorUsed).toBe(false);
    expect(typeof body.data.debug.elapsedMs).toBe("number");
    expect(typeof body.data.debug.dbReads).toBe("number");
    expect(body.data.nextCursor).toBeTruthy();
    expect(body.data.items.every((item) => seededIds.includes(item.postId))).toBe(true);
    expect(await verifyDocsExist(body.data.items.map((item) => item.postId))).toBe(true);
  });

  it("paginates to a second real page without duplicate ids when enough posts exist", async () => {
    await wipePostsCollection();
    await seedSimplePosts({ seedKey: `simple-page-2-${Date.now()}`, count: 14 });
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

    const first = await app.inject({
      method: "GET",
      url: "/v2/feed/for-you/simple?viewerId=simple-viewer-b&limit=5",
      headers
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      data: {
        items: Array<{ postId: string }>;
        nextCursor: string | null;
      };
    };
    expect(firstBody.data.items).toHaveLength(5);
    expect(firstBody.data.nextCursor).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you/simple?viewerId=simple-viewer-b&limit=5&cursor=${encodeURIComponent(String(firstBody.data.nextCursor))}`,
      headers
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as {
      data: {
        items: Array<{ postId: string }>;
        debug: { cursorUsed: boolean };
      };
    };
    expect(secondBody.data.items).toHaveLength(5);
    expect(secondBody.data.debug.cursorUsed).toBe(true);
    const firstIds = new Set(firstBody.data.items.map((item) => item.postId));
    const secondIds = new Set(secondBody.data.items.map((item) => item.postId));
    expect([...secondIds].some((postId) => firstIds.has(postId))).toBe(false);
    expect(await verifyDocsExist([...firstIds, ...secondIds])).toBe(true);
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
