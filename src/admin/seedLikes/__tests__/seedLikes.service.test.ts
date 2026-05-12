import { describe, expect, it, vi } from "vitest";
import { planSeedLikesForPost, SEED_LIKES_SOURCE } from "../seedLikes.service.js";
import type { SeedLikesConfig } from "../seedLikesConfig.js";
import type { SeedLikerProfile } from "../loadSeedLikers.js";

const config: SeedLikesConfig = {
  allowWrites: false,
  allowTargetBelowMin: true,
  minExistingLikes: 10,
  targetMin: 18,
  targetMax: 24,
  batchSize: 50,
  maxPostsPerRun: 0,
  useOldWebLikers: true,
  runIdPrefix: "seed-likes-test"
};

const seedLikerPool = {
  ids: ["u1", "u2", "u3", "u4"],
  source: "snapshot" as const,
  firestoreCount: 0,
  snapshotCount: 4
};

function profile(userId: string): SeedLikerProfile {
  return {
    userId,
    userHandle: `@${userId}`,
    userName: userId,
    userPic: "https://example.com/pic.jpg"
  };
}

function mockDb(existing: Set<string>) {
  return {
    collection: (collectionName: string) => ({
      doc: (docId: string) => ({
        collection: (subcollectionName: string) => ({
          doc: (userId: string) => ({
            path: `${collectionName}/${docId}/${subcollectionName}/${userId}`
          })
        })
      })
    }),
    getAll: vi.fn(async (...refs: Array<{ path: string }>) =>
      refs.map((ref) => ({ exists: existing.has(ref.path.split("/").pop() ?? "") }))
    )
  } as unknown as import("firebase-admin/firestore").Firestore;
}

describe("seedLikes.service planning", () => {
  it("produces canonical like paths and payloads without writing", async () => {
    const db = mockDb(new Set());

    const profileMap = new Map(seedLikerPool.ids.map((id) => [id, profile(id)]));
    const plan = await planSeedLikesForPost({
      db,
      postId: "post-1",
      postData: { likesCount: 3, title: "Test post", userId: "author-1" },
      config,
      seedLikerPool,
      profileMap,
      runId: "seed-likes-test-run",
      rng: () => 0
    });

    expect(plan).not.toBeNull();
    expect(plan!.currentLikeCount).toBe(3);
    expect(plan!.likeDocs.length).toBeGreaterThan(0);
    expect(plan!.likeDocs[0]!.path).toBe(`posts/post-1/likes/${plan!.likeDocs[0]!.payload.userId}`);
    expect(plan!.likeDocs[0]!.payload).toMatchObject({
      seeded: true,
      seedSource: SEED_LIKES_SOURCE,
      suppressNotification: true,
      suppressAnalytics: true
    });
    expect(plan!.postCounterUpdate).toEqual({
      path: "posts/post-1",
      likeCountIncrement: plan!.likeDocs.length,
      likesCountIncrement: plan!.likeDocs.length
    });
  });

  it("is idempotent when existing like docs are present", async () => {
    const existing = new Set(["u1", "u2"]);
    const db = mockDb(existing);

    const profileMap = new Map(seedLikerPool.ids.map((id) => [id, profile(id)]));
    const first = await planSeedLikesForPost({
      db,
      postId: "post-2",
      postData: { likesCount: 2 },
      config,
      seedLikerPool,
      profileMap,
      runId: "seed-likes-test-run",
      rng: () => 0
    });
    const afterFirst = new Set([
      ...existing,
      ...(first?.likeDocs ?? []).map((row) => String(row.payload.userId))
    ]);
    const second = await planSeedLikesForPost({
      db: mockDb(afterFirst),
      postId: "post-2",
      postData: { likesCount: 2 + (first?.likeDocs.length ?? 0) },
      config,
      seedLikerPool,
      profileMap,
      runId: "seed-likes-test-run-2",
      rng: () => 0
    });

    for (const row of second?.likeDocs ?? []) {
      expect(afterFirst.has(String(row.payload.userId))).toBe(false);
    }
  });
});
