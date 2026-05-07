import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { assertEmulatorOnlyDestructiveFirestoreOperation } from "../../safety/firestoreDestructiveGuard.js";

const isEmulator = process.env.FIRESTORE_TEST_MODE === "emulator";

function confirmEmulatorOnlyTestWrite(operationName: string, targetPath: string): void {
  assertEmulatorOnlyDestructiveFirestoreOperation(operationName, targetPath);
}

function nowMs(): number {
  return Date.now();
}

async function seedInventory(seedKey: string, reels: number, regular: number): Promise<{ reelIds: string[]; regularIds: string[] }> {
  confirmEmulatorOnlyTestWrite("feed-for-you.routes.test.seedInventory", "posts");
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

async function seedFeedState(input: {
  viewerId: string;
  reelQueue: string[];
  reelQueueIndex?: number;
  regularQueue: string[];
  regularQueueIndex?: number;
}) {
  confirmEmulatorOnlyTestWrite("feed-for-you.routes.test.seedFeedState", `users/${input.viewerId}/feedState`);
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

  it("paginates the global for-you pool without duplicates across cursors", async () => {
    const viewerId = `fy-pool-${Date.now()}`;
    const first = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${encodeURIComponent(viewerId)}&limit=5&debug=1`,
      headers
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      data: {
        items: Array<{ postId: string }>;
        nextCursor: string | null;
        exhausted: boolean;
        feedState: { reelQueueCount: number; regularQueueCount: number; remainingRegular: number };
        debug: {
          engineVersion: string;
          regularCount: number;
          recycledRegularCount: number;
          postIdsReturned: string[];
        };
      };
    };
    expect(firstBody.data.debug.engineVersion).toBe("queue-reels-regular-v2");
    const limit = 5;
    expect(firstBody.data.items.length).toBeGreaterThan(0);
    expect(firstBody.data.items.length).toBeLessThanOrEqual(limit);
    expect(firstBody.data.feedState.reelQueueCount).toBe(0);
    expect(firstBody.data.feedState.regularQueueCount).toBeGreaterThan(0);
    expect(firstBody.data.debug.regularCount).toBe(firstBody.data.items.length);
    expect(firstBody.data.debug.recycledRegularCount).toBe(0);
    expect(firstBody.data.debug.postIdsReturned).toEqual(firstBody.data.items.map((item) => item.postId));
    expect(firstBody.data.nextCursor).toBeTruthy();

    if (firstBody.data.feedState.remainingRegular > 0) {
      const second = await app.inject({
        method: "GET",
        url: `/v2/feed/for-you?viewerId=${encodeURIComponent(viewerId)}&limit=${limit}&cursor=${encodeURIComponent(String(firstBody.data.nextCursor))}&debug=1`,
        headers
      });
      expect(second.statusCode).toBe(200);
      const secondBody = second.json() as { data: { items: Array<{ postId: string }> } };
      expect(secondBody.data.items.length).toBeGreaterThan(0);
      expect(secondBody.data.items.length).toBeLessThanOrEqual(limit);
      expect(secondBody.data.items.some((item) => firstBody.data.items.some((prev) => prev.postId === item.postId))).toBe(
        false
      );
    }
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
    expect(warmBody.data.items.length).toBeGreaterThan(0);
    expect(warmBody.data.items.length).toBeLessThanOrEqual(5);
    expect(warmBody.data.nextCursor).toBeTruthy();
    expect(warmBody.meta.db.reads).toBeLessThanOrEqual(15);
    expect(warmBody.meta.db.writes).toBeLessThanOrEqual(1);
    expect(warmBody.meta.db.queries).toBe(0);
  });

  it("serves from the candidate pool for a viewer with no persisted home_for_you queues", async () => {
    const viewerId = `fy-no-state-${Date.now()}`;
    const res = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?viewerId=${encodeURIComponent(viewerId)}&limit=5&debug=1`,
      headers
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        items: Array<{ postId: string }>;
        nextCursor: string | null;
        exhausted: boolean;
        feedState: { regularQueueCount: number };
        debug: { regularCount: number; emptyReason: string | null; recycledRegularCount: number };
      };
    };
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.nextCursor).toBeTruthy();
    expect(body.data.debug.regularCount).toBeGreaterThan(0);
    expect(body.data.feedState.regularQueueCount).toBeGreaterThan(0);
    expect(body.data.debug.recycledRegularCount).toBe(0);
    expect(body.data.debug.emptyReason).toBeNull();
  });
});
