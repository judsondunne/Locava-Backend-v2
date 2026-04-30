import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

const isEmulator = process.env.FIRESTORE_TEST_MODE === "emulator";

function nowMs(): number {
  return Date.now();
}

async function seedForYouInventory(seedKey: string): Promise<{ reelIds: string[]; regularIds: string[] }> {
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("firestore_unavailable_for_test");
  const batch = db.batch();
  const reels: string[] = [];
  const regular: string[] = [];
  const base = nowMs();
  for (let i = 0; i < 14; i += 1) {
    const postId = `${seedKey}-reel-${String(i + 1).padStart(2, "0")}`;
    reels.push(postId);
    batch.set(
      db.collection("posts").doc(postId),
      {
        userId: `seed-author-${(i % 4) + 1}`,
        userHandle: `seed.author.${(i % 4) + 1}`,
        userName: `Seed Author ${(i % 4) + 1}`,
        userPic: `https://cdn.locava.test/users/${(i % 4) + 1}.jpg`,
        reel: true,
        mediaType: "video",
        title: `Seed reel ${i + 1}`,
        caption: `Seed reel caption ${i + 1}`,
        description: `Seed reel description ${i + 1}`,
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
        likesCount: i % 3,
        commentsCount: i % 2,
        privacy: "public",
        status: "active"
      },
      { merge: true }
    );
  }
  for (let i = 0; i < 8; i += 1) {
    const postId = `${seedKey}-regular-${String(i + 1).padStart(2, "0")}`;
    regular.push(postId);
    batch.set(
      db.collection("posts").doc(postId),
      {
        userId: `seed-regular-author-${(i % 3) + 1}`,
        userHandle: `seed.regular.author.${(i % 3) + 1}`,
        userName: `Seed Regular Author ${(i % 3) + 1}`,
        userPic: `https://cdn.locava.test/users/r${(i % 3) + 1}.jpg`,
        reel: false,
        mediaType: "image",
        title: `Seed regular ${i + 1}`,
        caption: `Seed regular caption ${i + 1}`,
        description: `Seed regular description ${i + 1}`,
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
        time: base - 20_000 - i * 1_000,
        createdAtMs: base - 20_000 - i * 1_000,
        updatedAtMs: base - 20_000 - i * 1_000,
        likesCount: i % 2,
        commentsCount: i % 2,
        privacy: "public",
        status: "active"
      },
      { merge: true }
    );
  }
  await batch.commit();
  return { reelIds: reels, regularIds: regular };
}

async function listServed(viewerId: string): Promise<string[]> {
  const db = getFirestoreSourceClient();
  if (!db) return [];
  const snap = await db.collection("users").doc(viewerId).collection("feedServed").get();
  return snap.docs.map((doc) => doc.id);
}

async function markAllReelsServed(viewerId: string): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) return;
  const reelsSnap = await db.collection("posts").where("reel", "==", true).limit(500).get();
  const batch = db.batch();
  const servedAt = Date.now();
  for (const doc of reelsSnap.docs) {
    batch.set(
      db.collection("users").doc(viewerId).collection("feedServed").doc(doc.id),
      {
        postId: doc.id,
        servedAt,
        feedSurface: "home_for_you",
        feedRequestId: "seed-reels-exhausted",
        rank: 1,
        sourceBucket: "reel",
        authorId: String(doc.get("userId") ?? "seed"),
        reel: true
      },
      { merge: true }
    );
  }
  await batch.commit();
}

async function markTopPostsServed(viewerId: string, limit = 240): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) return;
  const snap = await db.collection("posts").orderBy("time", "desc").limit(limit).get();
  const batch = db.batch();
  const servedAt = Date.now();
  for (const doc of snap.docs) {
    batch.set(
      db.collection("users").doc(viewerId).collection("feedServed").doc(doc.id),
      {
        postId: doc.id,
        servedAt,
        feedSurface: "home_for_you",
        feedRequestId: "seed-top-exhausted",
        rank: 1,
        sourceBucket: doc.get("reel") === true ? "reel" : "regular",
        authorId: String(doc.get("userId") ?? "seed"),
        reel: doc.get("reel") === true
      },
      { merge: true }
    );
  }
  await batch.commit();
}

describe.runIf(isEmulator)("v2 feed for-you route (emulator)", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const headers = { "x-viewer-roles": "internal" };

  it("writes served records for returned page and paginates without duplicates", async () => {
    const seedKey = `feedforyou-${Date.now()}`;
    const inventory = await seedForYouInventory(seedKey);
    const viewerId = `${seedKey}-viewer-a`;

    const page1 = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?limit=12&debug=1`,
      headers: { ...headers, "x-viewer-id": viewerId }
    });
    expect(page1.statusCode).toBe(200);
    const p1 = page1.json().data as {
      items: Array<{ postId: string; media: { type: string } }>;
      nextCursor: string | null;
      exhausted: boolean;
      debug: { servedWriteCount: number; servedWriteOk: boolean };
    };
    expect(p1.items.length).toBeGreaterThan(0);
    expect(p1.debug.servedWriteOk).toBe(true);
    expect(p1.debug.servedWriteCount).toBe(p1.items.length);
    const servedAfterPage1 = await listServed(viewerId);
    expect(new Set(servedAfterPage1)).toEqual(new Set(p1.items.map((item) => item.postId)));

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=30" });
    expect(diagnostics.statusCode).toBe(200);
    const rows = (diagnostics.json().data?.recentRequests ?? []) as Array<{
      routeName?: string;
      dbOps?: { writes?: number };
    }>;
    const forYouRow = rows.find((row) => row.routeName === "feed.for_you.get");
    expect((forYouRow?.dbOps?.writes ?? 0) > 0).toBe(true);

    if (p1.nextCursor) {
      const page2 = await app.inject({
        method: "GET",
        url: `/v2/feed/for-you?limit=12&cursor=${encodeURIComponent(p1.nextCursor)}&debug=1`,
        headers: { ...headers, "x-viewer-id": viewerId }
      });
      expect(page2.statusCode).toBe(200);
      const p2 = page2.json().data as { items: Array<{ postId: string }> };
      const overlap = p2.items.filter((item) => p1.items.some((other) => other.postId === item.postId));
      expect(overlap.length).toBe(0);
    }

    const repeat = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?limit=12&debug=1`,
      headers: { ...headers, "x-viewer-id": viewerId }
    });
    expect(repeat.statusCode).toBe(200);
    const repeatData = repeat.json().data as { items: Array<{ postId: string }> };
    const repeatOverlap = repeatData.items.filter((item) => p1.items.some((first) => first.postId === item.postId));
    expect(repeatOverlap.length).toBe(0);

    const viewerB = `${seedKey}-viewer-b`;
    const otherViewer = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?limit=12&debug=1`,
      headers: { ...headers, "x-viewer-id": viewerB }
    });
    expect(otherViewer.statusCode).toBe(200);
    const bData = otherViewer.json().data as { items: Array<{ postId: string; media: { type: string } }> };
    const shared = bData.items.filter((item) => p1.items.some((first) => first.postId === item.postId));
    expect(shared.length).toBeGreaterThan(0);

    const reelCount = p1.items.filter((item) => item.media.type === "video").length;
    const regularCount = p1.items.length - reelCount;
    expect(reelCount).toBeGreaterThanOrEqual(8);
    expect(regularCount).toBeGreaterThanOrEqual(1);

    expect(p1.items.every((item) => [...inventory.reelIds, ...inventory.regularIds].includes(item.postId))).toBe(true);
  });

  it("falls back to regular and recycles real posts when exhausted", async () => {
    const seedKey = `feedforyou-exhaust-${Date.now()}`;
    await seedForYouInventory(seedKey);
    const db = getFirestoreSourceClient();
    if (!db) throw new Error("firestore_unavailable_for_test");

    const viewerId = `${seedKey}-viewer-c`;
    await markAllReelsServed(viewerId);

    const regularFallback = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?limit=12&debug=1`,
      headers: { ...headers, "x-viewer-id": viewerId }
    });
    expect(regularFallback.statusCode).toBe(200);
    const fallbackData = regularFallback.json().data as {
      items: Array<{ postId: string; media: { type: string } }>;
      exhausted: boolean;
      nextCursor: string | null;
    };
    expect(fallbackData.items.length).toBeGreaterThan(0);

    const returnedDocs = await db.getAll(...fallbackData.items.map((item) => db.collection("posts").doc(item.postId)));
    expect(returnedDocs.every((doc) => doc.get("reel") !== true)).toBe(true);

    const exhaustedViewer = `${seedKey}-viewer-exhausted`;
    await markTopPostsServed(exhaustedViewer, 260);

    const recycled = await app.inject({
      method: "GET",
      url: `/v2/feed/for-you?limit=12&debug=1`,
      headers: { ...headers, "x-viewer-id": exhaustedViewer }
    });
    expect(recycled.statusCode).toBe(200);
    const recycledData = recycled.json().data as {
      items: Array<{ postId: string }>;
      debug?: { recycledCount?: number; rankingVersion?: string };
    };
    expect(recycledData.items.length).toBeGreaterThan(0);
    expect(Number(recycledData.debug?.recycledCount ?? 0)).toBeGreaterThan(0);
    expect(String(recycledData.debug?.rankingVersion ?? "")).toBe("fast-reel-first-v2");
  });

  it("returns clean 400 for malformed and unsupported cursors", async () => {
    const viewerId = `cursor-viewer-${Date.now()}`;
    const cases = [
      { cursor: "not-a-cursor", expectedCode: "invalid_cursor" },
      { cursor: "fy:v1:not_base64%%", expectedCode: "invalid_cursor" },
      { cursor: "fy:v9:eyJwYWdlIjoxfQ", expectedCode: "unsupported_cursor_version" },
      { cursor: "cursor:legacy", expectedCode: "invalid_cursor" }
    ];

    for (const row of cases) {
      const res = await app.inject({
        method: "GET",
        url: `/v2/feed/for-you?limit=12&cursor=${encodeURIComponent(row.cursor)}`,
        headers: { ...headers, "x-viewer-id": viewerId }
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error?: { code?: string } };
      expect(body.error?.code).toBe(row.expectedCode);
    }
  });
});
