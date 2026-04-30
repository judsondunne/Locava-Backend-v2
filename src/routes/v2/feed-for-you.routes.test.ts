import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

const isEmulator = process.env.FIRESTORE_TEST_MODE === "emulator";

function nowMs(): number {
  return Date.now();
}

async function seedInventory(seedKey: string, reels: number, regular: number): Promise<{ reelIds: string[]; regularIds: string[] }> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable_for_test");
  const batch = db.batch();
  const reelIds: string[] = [];
  const regularIds: string[] = [];
  const base = nowMs() + 1_000_000;

  for (let i = 0; i < reels; i += 1) {
    const postId = `${seedKey}-reel-${String(i + 1).padStart(2, "0")}`;
    reelIds.push(postId);
    batch.set(
      db.collection("posts").doc(postId),
      {
        userId: `reel-author-${(i % 3) + 1}`,
        userHandle: `reel.author.${(i % 3) + 1}`,
        userName: `Reel Author ${(i % 3) + 1}`,
        userPic: `https://cdn.locava.test/users/reel-${(i % 3) + 1}.jpg`,
        reel: true,
        mediaType: "video",
        title: `Reel ${i + 1}`,
        caption: `Caption ${i + 1}`,
        displayPhotoLink: `https://cdn.locava.test/posts/${postId}/display.jpg`,
        thumbUrl: `https://cdn.locava.test/posts/${postId}/thumb.jpg`,
        assets: [
          {
            id: `${postId}-asset`,
            type: "video",
            url: `https://cdn.locava.test/posts/${postId}/main.mp4`,
            poster: `https://cdn.locava.test/posts/${postId}/poster.jpg`,
            thumbnail: `https://cdn.locava.test/posts/${postId}/thumb.jpg`
          }
        ],
        time: base - i * 1_000,
        createdAtMs: base - i * 1_000,
        updatedAtMs: base - i * 1_000,
        privacy: "public",
        status: "active"
      },
      { merge: true }
    );
  }

  for (let i = 0; i < regular; i += 1) {
    const postId = `${seedKey}-regular-${String(i + 1).padStart(2, "0")}`;
    regularIds.push(postId);
    batch.set(
      db.collection("posts").doc(postId),
      {
        userId: `regular-author-${(i % 3) + 1}`,
        userHandle: `regular.author.${(i % 3) + 1}`,
        userName: `Regular Author ${(i % 3) + 1}`,
        userPic: `https://cdn.locava.test/users/regular-${(i % 3) + 1}.jpg`,
        reel: false,
        mediaType: "image",
        title: `Regular ${i + 1}`,
        caption: `Regular caption ${i + 1}`,
        displayPhotoLink: `https://cdn.locava.test/posts/${postId}/display.jpg`,
        thumbUrl: `https://cdn.locava.test/posts/${postId}/thumb.jpg`,
        assets: [
          {
            id: `${postId}-asset`,
            type: "image",
            url: `https://cdn.locava.test/posts/${postId}/main.jpg`,
            poster: `https://cdn.locava.test/posts/${postId}/poster.jpg`,
            thumbnail: `https://cdn.locava.test/posts/${postId}/thumb.jpg`
          }
        ],
        time: base - 50_000 - i * 1_000,
        createdAtMs: base - 50_000 - i * 1_000,
        updatedAtMs: base - 50_000 - i * 1_000,
        privacy: "public",
        status: "active"
      },
      { merge: true }
    );
  }

  await batch.commit();
  return { reelIds, regularIds };
}

async function getFeedState(viewerId: string) {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable_for_test");
  return db.collection("users").doc(viewerId).collection("feedState").doc("home_for_you").get();
}

async function seedFeedState(viewerId: string, input: { reelQueue: string[]; reelQueueIndex?: number; regularServedRecent?: string[] }) {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable_for_test");
  const now = nowMs();
  await db
    .collection("users")
    .doc(viewerId)
    .collection("feedState")
    .doc("home_for_you")
    .set(
      {
        viewerId,
        surface: "home_for_you",
        reelQueue: input.reelQueue,
        reelQueueGeneratedAt: new Date(now),
        reelQueueSourceVersion: "queue-reels-v1",
        reelQueueCount: input.reelQueue.length,
        reelQueueIndex: input.reelQueueIndex ?? 0,
        regularCursorTime: null,
        regularCursorPostId: null,
        randomSeed: `${viewerId}:queue-reels-v1`,
        regularServedRecent: input.regularServedRecent ?? [],
        createdAt: new Date(now),
        updatedAt: new Date(now)
      },
      { merge: true }
    );
}

async function listServed(viewerId: string): Promise<string[]> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable_for_test");
  const snap = await db.collection("users").doc(viewerId).collection("feedServed").get();
  return snap.docs.map((doc) => doc.id);
}

describe.runIf(isEmulator)("v2 feed for-you route (emulator)", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = { "x-viewer-roles": "internal" };

  it("creates feedState, paginates without first-page repeats, and resumes from saved index", async () => {
    const seedKey = `queue-${Date.now()}`;
    const inventory = await seedInventory(seedKey, 12, 4);
    const viewerId = `${seedKey}-viewer`;

    const first = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${viewerId}&limit=5&debug=1`,
      headers
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      data: {
        items: Array<{ postId: string }>;
        nextCursor: string | null;
        exhausted: boolean;
        feedState: { reelQueueIndex: number; reelQueueCount: number; remainingReels: number };
        debug: { engineVersion: string; feedStateCreated: boolean; feedStateWriteOk: boolean; servedWriteCount: number };
      };
      meta: { db: { reads: number; writes: number; queries: number } };
    };
    expect(firstBody.data.items.length).toBe(5);
    expect(firstBody.data.exhausted).toBe(false);
    expect(firstBody.data.debug.engineVersion).toBe("queue-reels-v1");
    expect(firstBody.data.debug.feedStateCreated).toBe(true);
    expect(firstBody.data.debug.feedStateWriteOk).toBe(true);
    expect(firstBody.data.debug.servedWriteCount).toBe(5);
    expect(firstBody.data.nextCursor).toBeTruthy();
    expect(firstBody.data.feedState.reelQueueCount).toBeGreaterThanOrEqual(inventory.reelIds.length);
    expect(firstBody.meta.db.reads).toBeLessThanOrEqual(80);
    expect(firstBody.meta.db.queries).toBeLessThanOrEqual(6);

    const stateAfterFirst = await getFeedState(viewerId);
    expect(stateAfterFirst.exists).toBe(true);
    expect(Number(stateAfterFirst.get("reelQueueIndex") ?? 0)).toBe(5);

    const second = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${viewerId}&limit=5&cursor=${encodeURIComponent(String(firstBody.data.nextCursor))}&debug=1`,
      headers
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as {
      data: { items: Array<{ postId: string }>; exhausted: boolean };
    };
    expect(secondBody.data.items.length).toBeGreaterThan(0);
    expect(secondBody.data.items.some((item) => firstBody.data.items.some((prev) => prev.postId === item.postId))).toBe(false);
    expect(secondBody.data.exhausted).toBe(false);

    const restart = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${viewerId}&limit=5&debug=1`,
      headers
    });
    expect(restart.statusCode).toBe(200);
    const restartBody = restart.json() as {
      data: { items: Array<{ postId: string }> };
    };
    expect(restartBody.data.items.some((item) => firstBody.data.items.some((prev) => prev.postId === item.postId))).toBe(false);
  });

  it("fills remaining slots with regular posts after reels", async () => {
    const seedKey = `queue-mixed-${Date.now()}`;
    const inventory = await seedInventory(seedKey, 2, 4);
    const viewerId = `${seedKey}-viewer`;
    await seedFeedState(viewerId, { reelQueue: inventory.reelIds });

    const res = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${viewerId}&limit=5&debug=1`,
      headers
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        items: Array<{ postId: string; media: { type: string } }>;
        feedState: { mode: string };
        debug: { regularCount: number; recycledRegularCount: number };
      };
    };
    expect(body.data.items.length).toBe(5);
    expect(body.data.feedState.mode).toBe("mixed");
    expect(body.data.debug.regularCount + body.data.debug.recycledRegularCount).toBe(3);
    expect(body.data.items.some((item) => inventory.regularIds.includes(item.postId))).toBe(true);
  });

  it("returns regular posts instead of empty when no reels exist", async () => {
    const seedKey = `queue-regular-${Date.now()}`;
    const inventory = await seedInventory(seedKey, 0, 3);
    const viewerId = `${seedKey}-viewer`;
    await seedFeedState(viewerId, { reelQueue: [] });

    const res = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${viewerId}&limit=3&debug=1`,
      headers
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        items: Array<{ postId: string; media: { type: string } }>;
        exhausted: boolean;
        feedState: { mode: string; reelQueueCount: number };
        debug: { engineVersion: string };
      };
    };
    expect(body.data.items.length).toBe(3);
    expect(body.data.items.every((item) => item.media.type !== "video")).toBe(true);
    expect(body.data.items.some((item) => inventory.regularIds.includes(item.postId))).toBe(true);
    expect(body.data.exhausted).toBe(false);
    expect(body.data.feedState.mode).toBe("regular");
    expect(body.data.feedState.reelQueueCount).toBe(0);
    expect(body.data.debug.engineVersion).toBe("queue-reels-v1");
  });

  it("writes served docs for returned items", async () => {
    const seedKey = `queue-served-${Date.now()}`;
    await seedInventory(seedKey, 5, 2);
    const viewerId = `${seedKey}-viewer`;

    const res = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${viewerId}&limit=5&debug=1`,
      headers
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { items: Array<{ postId: string }>; debug: { servedWriteCount: number; servedWriteOk: boolean } };
    };
    const served = await listServed(viewerId);

    expect(body.data.debug.servedWriteOk).toBe(true);
    expect(body.data.debug.servedWriteCount).toBe(5);
    expect(new Set(served)).toEqual(new Set(body.data.items.map((item) => item.postId)));
  });
});
