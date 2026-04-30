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

async function seedFeedState(input: {
  viewerId: string;
  reelQueue: string[];
  reelQueueIndex?: number;
  regularQueue: string[];
  regularQueueIndex?: number;
}) {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable_for_test");
  const now = nowMs();
  await db
    .collection("users")
    .doc(input.viewerId)
    .collection("feedState")
    .doc("home_for_you")
    .set(
      {
        viewerId: input.viewerId,
        surface: "home_for_you",
        reelQueue: input.reelQueue,
        reelQueueGeneratedAt: new Date(now),
        reelQueueSourceVersion: "queue-reels-regular-v2",
        reelQueueCount: input.reelQueue.length,
        reelQueueIndex: input.reelQueueIndex ?? 0,
        regularQueue: input.regularQueue,
        regularQueueGeneratedAt: new Date(now),
        regularQueueSourceVersion: "queue-reels-regular-v2",
        regularQueueCount: input.regularQueue.length,
        regularQueueIndex: input.regularQueueIndex ?? 0,
        randomSeed: `${input.viewerId}:queue-reels-regular-v2`,
        createdAt: new Date(now),
        updatedAt: new Date(now)
      },
      { merge: true }
    );
}

describe.runIf(isEmulator)("v2 feed for-you route (emulator)", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = { "x-viewer-roles": "internal" };

  it("creates both queues, paginates reels, and resumes from saved indexes", async () => {
    const seedKey = `queue-v2-${Date.now()}`;
    await seedInventory(seedKey, 12, 8);
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
        feedState: {
          reelQueueIndex: number;
          reelQueueCount: number;
          regularQueueIndex: number;
          regularQueueCount: number;
          remainingReels: number;
          remainingRegular: number;
        };
        debug: {
          engineVersion: string;
          feedStateCreated: boolean;
          recycledRegularCount: number;
          postIdsReturned: string[];
        };
      };
    };
    expect(firstBody.data.items.length).toBe(5);
    expect(firstBody.data.debug.engineVersion).toBe("queue-reels-regular-v2");
    expect(firstBody.data.debug.feedStateCreated).toBe(true);
    expect(firstBody.data.debug.recycledRegularCount).toBe(0);
    expect(firstBody.data.feedState.reelQueueCount).toBeGreaterThan(0);
    expect(firstBody.data.feedState.regularQueueCount).toBeGreaterThan(0);
    expect(firstBody.data.nextCursor).toBeTruthy();
    expect(firstBody.data.debug.postIdsReturned).toEqual(firstBody.data.items.map((item) => item.postId));

    const second = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${viewerId}&limit=5&cursor=${encodeURIComponent(String(firstBody.data.nextCursor))}&debug=1`,
      headers
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as {
      data: {
        items: Array<{ postId: string }>;
      };
    };
    expect(secondBody.data.items.some((item) => firstBody.data.items.some((prev) => prev.postId === item.postId))).toBe(false);

    const restart = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${viewerId}&limit=5&debug=1`,
      headers
    });
    expect(restart.statusCode).toBe(200);
    const restartBody = restart.json() as {
      data: {
        items: Array<{ postId: string }>;
      };
    };
    expect(restartBody.data.items.some((item) => firstBody.data.items.some((prev) => prev.postId === item.postId))).toBe(false);

    const state = await getFeedState(viewerId);
    expect(Number(state.get("reelQueueIndex") ?? 0)).toBeGreaterThan(0);
    expect(Number(state.get("regularQueueCount") ?? 0)).toBeGreaterThan(0);
  });

  it("serves regularQueue after reels are exhausted and advances regularQueueIndex across pages", async () => {
    const seedKey = `queue-v2-regular-${Date.now()}`;
    const inventory = await seedInventory(seedKey, 0, 12);
    const viewerId = `${seedKey}-viewer`;
    await seedFeedState({
      viewerId,
      reelQueue: [],
      reelQueueIndex: 0,
      regularQueue: inventory.regularIds,
      regularQueueIndex: 0
    });

    const first = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${viewerId}&limit=5&debug=1`,
      headers
    });
    const firstBody = first.json() as {
      data: {
        items: Array<{ postId: string }>;
        nextCursor: string | null;
        exhausted: boolean;
        debug: {
          regularCount: number;
          recycledRegularCount: number;
          regularQueueIndexBefore: number;
          regularQueueIndexAfter: number;
        };
      };
    };
    expect(first.statusCode).toBe(200);
    expect(firstBody.data.items.length).toBe(5);
    expect(firstBody.data.debug.regularCount).toBe(5);
    expect(firstBody.data.debug.recycledRegularCount).toBe(0);
    expect(firstBody.data.debug.regularQueueIndexAfter).toBeGreaterThan(firstBody.data.debug.regularQueueIndexBefore);
    expect(firstBody.data.exhausted).toBe(false);

    const second = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${viewerId}&limit=5&cursor=${encodeURIComponent(String(firstBody.data.nextCursor))}&debug=1`,
      headers
    });
    const secondBody = second.json() as {
      data: {
        items: Array<{ postId: string }>;
        nextCursor: string | null;
        debug: {
          regularCount: number;
          recycledRegularCount: number;
          regularQueueIndexBefore: number;
          regularQueueIndexAfter: number;
        };
      };
    };
    expect(second.statusCode).toBe(200);
    expect(secondBody.data.debug.regularCount).toBe(5);
    expect(secondBody.data.debug.recycledRegularCount).toBe(0);
    expect(secondBody.data.items.some((item) => firstBody.data.items.some((prev) => prev.postId === item.postId))).toBe(false);
    expect(secondBody.data.debug.regularQueueIndexAfter).toBeGreaterThan(secondBody.data.debug.regularQueueIndexBefore);

    const third = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${viewerId}&limit=5&cursor=${encodeURIComponent(String(secondBody.data.nextCursor))}&debug=1`,
      headers
    });
    const thirdBody = third.json() as {
      data: {
        items: Array<{ postId: string }>;
      };
    };
    expect(third.statusCode).toBe(200);
    expect(thirdBody.data.items.some((item) => firstBody.data.items.some((prev) => prev.postId === item.postId))).toBe(false);
  });

  it("keeps warm regular pages under the read/write budget with no query rebuild path", async () => {
    const seedKey = `queue-v2-warm-${Date.now()}`;
    const inventory = await seedInventory(seedKey, 0, 20);
    const viewerId = `${seedKey}-viewer`;
    await seedFeedState({
      viewerId,
      reelQueue: [],
      regularQueue: inventory.regularIds
    });

    await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${viewerId}&limit=5&debug=1`,
      headers
    });

    const warm = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${viewerId}&limit=5&debug=1`,
      headers
    });
    expect(warm.statusCode).toBe(200);
    const warmBody = warm.json() as {
      data: {
        items: Array<{ postId: string }>;
        nextCursor: string | null;
        debug: {
          engineVersion: string;
          regularCount: number;
          recycledRegularCount: number;
        };
      };
      meta: { db: { reads: number; writes: number; queries: number } };
    };
    expect(warmBody.data.debug.engineVersion).toBe("queue-reels-regular-v2");
    expect(warmBody.data.debug.regularCount).toBeGreaterThan(0);
    expect(warmBody.data.debug.recycledRegularCount).toBe(0);
    expect(warmBody.data.items.length).toBe(5);
    expect(warmBody.data.nextCursor).toBeTruthy();
    expect(warmBody.meta.db.reads).toBeLessThanOrEqual(15);
    expect(warmBody.meta.db.writes).toBeLessThanOrEqual(1);
    expect(warmBody.meta.db.queries).toBe(0);
  });

  it("rebuilds the regular queue when both local queues are empty instead of returning empty immediately", async () => {
    const viewerId = `queue-v2-empty-${Date.now()}`;
    await seedFeedState({
      viewerId,
      reelQueue: [],
      regularQueue: []
    });

    const res = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${viewerId}&limit=5&debug=1`,
      headers
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        items: Array<{ postId: string }>;
        nextCursor: string | null;
        exhausted: boolean;
        feedState: { remainingReels: number; remainingRegular: number; regularQueueCount: number };
        debug: { emptyReason: string | null; recycledRegularCount: number; queueRebuilt: boolean; regularCount: number };
      };
    };
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.exhausted).toBe(false);
    expect(body.data.nextCursor).toBeTruthy();
    expect(body.data.debug.queueRebuilt).toBe(true);
    expect(body.data.debug.regularCount).toBeGreaterThan(0);
    expect(body.data.feedState.regularQueueCount).toBeGreaterThan(0);
    expect(body.data.debug.recycledRegularCount).toBe(0);
  });
});
