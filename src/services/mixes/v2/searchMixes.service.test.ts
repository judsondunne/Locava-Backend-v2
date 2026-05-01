import { describe, expect, it, vi } from "vitest";
import { SearchMixesServiceV2 } from "./searchMixes.service.js";
import type { MixSourcePost } from "../../../repositories/mixes/mixes.repository.js";

function makeRecentPoolPost(input: {
  postId: string;
  userId: string;
  activity: string;
  time?: number;
}): MixSourcePost {
  return {
    postId: input.postId,
    id: input.postId,
    userId: input.userId,
    userHandle: input.userId,
    userName: input.userId,
    activities: [input.activity],
    displayPhotoLink: `https://cdn.locava.test/${input.postId}.jpg`,
    thumbUrl: `https://cdn.locava.test/${input.postId}-thumb.jpg`,
    time: input.time ?? Date.now(),
  } as MixSourcePost;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SearchMixesServiceV2 bootstrap", () => {
  it("serves snapshot-backed shelves without waiting on slow viewer personalization", async () => {
    const activityProfile = deferred<string[]>();
    const followingIds = deferred<string[]>();
    const postsRepo = {
      pageByAuthorIdsMerged: vi.fn(async () => {
        throw new Error("friends bootstrap should not query posts");
      }),
    } as any;
    const service = new SearchMixesServiceV2({
      mixesRepo: {
        loadViewerActivityProfile: vi.fn(() => activityProfile.promise),
        loadViewerFollowingUserIds: vi.fn(() => followingIds.promise),
      },
      mixPoolRepo: {
        listFromPool: vi.fn(async () => ({
          posts: [
            makeRecentPoolPost({ postId: "p1", userId: "u1", activity: "hiking", time: 200 }),
            makeRecentPoolPost({ postId: "p2", userId: "u2", activity: "coffee", time: 100 }),
          ],
          readCount: 0,
          source: "memory_pool_stale",
          poolLimit: 120,
          poolState: "stale" as const,
          poolBuiltAt: new Date().toISOString(),
          poolBuildLatencyMs: 12,
          poolBuildReadCount: 120,
          servedStale: true,
          servedEmptyWarming: false,
        })),
      },
      postsRepo,
      nearbyRepo: {} as any,
      searchRepo: {} as any,
      viewerHintsWaitMs: 5,
    });

    const bootstrap = service.bootstrap({
      viewerId: "viewer-1",
      viewerCoords: null,
      limitGeneral: 4,
      includeDebug: true,
    });

    const raced = await Promise.race([
      bootstrap.then((value) => ({ kind: "resolved" as const, value })),
      new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), 60)),
    ]);

    expect(raced.kind).toBe("resolved");
    if (raced.kind !== "resolved") return;
    expect(raced.value.mixes.length).toBeGreaterThan(0);
    expect(raced.value.debug?.poolState).toBe("stale");
    expect(raced.value.debug?.personalizationDeferred).toBe(true);
    expect(postsRepo.pageByAuthorIdsMerged).not.toHaveBeenCalled();

    activityProfile.resolve(["hiking"]);
    followingIds.resolve(["friend-1", "friend-2"]);
    await Promise.resolve();
  });

  it("uses cached viewer hints on later requests without requerying personalization", async () => {
    const loadViewerActivityProfile = vi.fn(async () => ["hiking", "coffee"]);
    const loadViewerFollowingUserIds = vi.fn(async () => ["friend-1"]);
    const service = new SearchMixesServiceV2({
      mixesRepo: {
        loadViewerActivityProfile,
        loadViewerFollowingUserIds,
      },
      mixPoolRepo: {
        listFromPool: vi.fn(async () => ({
          posts: [
            makeRecentPoolPost({ postId: "p1", userId: "friend-1", activity: "hiking", time: 200 }),
            makeRecentPoolPost({ postId: "p2", userId: "u2", activity: "coffee", time: 100 }),
          ],
          readCount: 0,
          source: "memory_pool",
          poolLimit: 120,
          poolState: "warm" as const,
          poolBuiltAt: new Date().toISOString(),
          poolBuildLatencyMs: 8,
          poolBuildReadCount: 120,
          servedStale: false,
          servedEmptyWarming: false,
        })),
      },
      postsRepo: {} as any,
      nearbyRepo: {} as any,
      searchRepo: {} as any,
      viewerHintsWaitMs: 30,
      viewerHintsTtlMs: 60_000,
    });

    const first = await service.bootstrap({
      viewerId: "viewer-1",
      viewerCoords: null,
      limitGeneral: 4,
      includeDebug: true,
    });
    const second = await service.bootstrap({
      viewerId: "viewer-1",
      viewerCoords: null,
      limitGeneral: 4,
      includeDebug: true,
    });

    expect(loadViewerActivityProfile).toHaveBeenCalledTimes(1);
    expect(loadViewerFollowingUserIds).toHaveBeenCalledTimes(1);
    expect(first.debug?.personalizationDeferred).toBe(false);
    expect(second.debug?.personalizationDeferred).toBe(false);
    expect(second.mixes.some((mix) => mix.mixId === "friends:from_people_you_follow")).toBe(true);
  });
});
