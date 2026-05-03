import { describe, expect, it } from "vitest";
import { MixesService } from "./mixes.service.js";

const rows = [
  {
    postId: "p4",
    time: 4000,
    userId: "u4",
    userHandle: "eve",
    activities: ["hiking"],
    state: "Vermont",
    city: "Burlington",
    lat: 44.4759,
    lng: -73.2121,
    thumbUrl: "https://cdn/p4.jpg",
  },
  {
    postId: "p3",
    time: 3000,
    userId: "u3",
    userHandle: "cara",
    selectedActivities: ["hiking"],
    state: "Vermont",
    city: "Stowe",
    lat: 44.4654,
    lng: -72.6874,
    thumbUrl: "https://cdn/p3.jpg",
  },
  {
    postId: "p2",
    time: 2000,
    userId: "u2",
    userHandle: "bob",
    activity: "coffee",
    state: "New York",
    city: "New York",
    lat: 40.7128,
    lng: -74.006,
    thumbUrl: "https://cdn/p2.jpg",
  },
  {
    postId: "p1",
    time: 1000,
    userId: "u1",
    userHandle: "alice",
    activityTypes: ["hiking"],
    state: "Vermont",
    city: "Burlington",
    lat: 44.476,
    lng: -73.213,
    thumbUrl: "https://cdn/p1.jpg",
  },
];

function poolMeta(overrides: Record<string, unknown> = {}) {
  return {
    readCount: 4,
    source: "test_pool",
    poolLimit: 1000,
    poolBuiltAt: "2026-01-01T00:00:00.000Z",
    poolBuildLatencyMs: 0,
    poolBuildReadCount: 4,
    poolState: "warm",
    servedStale: false,
    servedEmptyWarming: false,
    ...overrides,
  };
}

const repo = {
  async listFromPool() {
    return { posts: rows as any[], ...poolMeta() };
  },
  async listFromPoolWithWarmWait() {
    return this.listFromPool();
  },
};

describe("mixes service", () => {
  const service = new MixesService(repo as any);

  it("filters activity preview deterministically", async () => {
    const out = await service.preview({
      mixKey: "hiking",
      filter: { activity: "Hiking " },
      limit: 3,
      viewerId: null,
    });
    expect(out.ok).toBe(true);
    expect(out.posts.length).toBe(3);
    expect(out.posts.every((p: any) => p.activities.includes("hiking"))).toBe(true);
    expect(out.posts.map((p: any) => p.postId)).toEqual(["p4", "p3", "p1"]);
  });

  it("filters by radius + activity", async () => {
    const out = await service.preview({
      mixKey: "hiking-nearby",
      filter: { activity: "hiking", lat: 44.476, lng: -73.212, radiusKm: 4 },
      limit: 3,
      viewerId: null,
    });
    expect(out.posts.length).toBeGreaterThan(0);
    expect(out.posts.every((p: any) => p.postId !== "p2")).toBe(true);
    // 4 km radius around Burlington includes p4/p1 but not Stowe (p3).
    expect(out.posts.map((p: any) => p.postId)).toEqual(["p4", "p1"]);
  });

  it("clamps radius beyond server max while staying 200-safe for clients", async () => {
    const out = await service.preview({
      mixKey: "nearby",
      filter: { activity: "hiking", lat: 44.476, lng: -73.212, radiusKm: 650 },
      limit: 3,
      viewerId: null,
    });
    expect(out.ok).toBe(true);
    expect(out.filters.radiusKm).toBe(500);
  });

  it("preview skips leading candidates with no usable cover when later rows are valid", async () => {
    const beachRows = [
      {
        postId: "no-cover",
        time: 9000,
        userId: "u0",
        userHandle: "a",
        activities: ["beach"],
        thumbUrl: "",
        displayPhotoLink: "",
        assets: [],
      },
      {
        postId: "has-cover",
        time: 8000,
        userId: "u9",
        userHandle: "b",
        activities: ["beach"],
        thumbUrl: "https://cdn/beach.jpg",
      },
    ];
    const beachRepo = {
      async listFromPool() {
        return { posts: beachRows as any[], ...poolMeta({ readCount: 2 }) };
      },
      async listFromPoolWithWarmWait() {
        return this.listFromPool();
      },
    };
    const beachService = new MixesService(beachRepo as any);
    const out = await beachService.preview({
      mixKey: "beach",
      filter: { activity: "beach" },
      limit: 1,
      viewerId: null,
    });
    expect(out.posts.map((p: any) => p.postId)).toEqual(["has-cover"]);
    expect(out.diagnostics.droppedForMissingMediaCount).toBe(1);
  });

  it("paginates stably with cursor and no duplicates", async () => {
    const first = await service.page({
      mixKey: "hiking",
      filter: { activity: "hiking" },
      limit: 2,
      cursor: null,
      viewerId: null,
    });
    expect(first.posts.map((p: any) => p.postId)).toEqual(["p4", "p3"]);
    const second = await service.page({
      mixKey: "hiking",
      filter: { activity: "hiking" },
      limit: 2,
      cursor: first.nextCursor,
      viewerId: null,
    });
    const ids1 = new Set(first.posts.map((p: any) => p.postId));
    expect(second.posts.some((p: any) => ids1.has(p.postId))).toBe(false);
    expect(second.posts.map((p: any) => p.postId)).toEqual(["p1"]);
  });

  it("returns empty mix with ok true and hasMore false", async () => {
    const out = await service.page({
      mixKey: "none",
      filter: { activity: "does-not-exist" },
      limit: 5,
      cursor: null,
      viewerId: null,
    });
    expect(out.ok).toBe(true);
    expect(out.posts).toEqual([]);
    expect(out.hasMore).toBe(false);
    expect(out.nextCursor).toBeNull();
  });

  it("normalizes activity casing, spacing, and plural basics", async () => {
    const spaced = await service.preview({
      mixKey: "hiking",
      filter: { activity: "   HIKINGS   " },
      limit: 3,
      viewerId: null,
    });
    const singular = await service.preview({
      mixKey: "hiking",
      filter: { activity: "hiking" },
      limit: 3,
      viewerId: "v2",
    });
    expect(spaced.posts.map((p: any) => p.postId)).toEqual(singular.posts.map((p: any) => p.postId));
  });

  it("matches activity across activityIds/tags/category field shapes", async () => {
    const shapeRows = [
      {
        postId: "a1",
        time: 4100,
        userId: "ua1",
        userHandle: "shape-a1",
        activityIds: ["hiking"],
        thumbUrl: "https://cdn/a1.jpg",
      },
      {
        postId: "a2",
        time: 4090,
        userId: "ua2",
        userHandle: "shape-a2",
        tags: ["hiking"],
        thumbUrl: "https://cdn/a2.jpg",
      },
      {
        postId: "a3",
        time: 4080,
        userId: "ua3",
        userHandle: "shape-a3",
        category: "hiking",
        thumbUrl: "https://cdn/a3.jpg",
      },
    ];
    const shapeRepo = {
      async listFromPool() {
        return { posts: shapeRows as any[], ...poolMeta({ readCount: 3 }) };
      },
      async listFromPoolWithWarmWait() {
        return this.listFromPool();
      },
    };
    const shapeService = new MixesService(shapeRepo as any);
    const out = await shapeService.preview({
      mixKey: "hiking",
      filter: { activity: "hiking" },
      limit: 6,
      viewerId: "shape-activity-viewer",
    });
    expect(out.posts.map((p: any) => p.postId)).toEqual(["a1", "a2", "a3"]);
  });

  it("nearby pagination keeps distance-first ordering across pages", async () => {
    const geoRows = [
      {
        postId: "g1",
        time: 9000,
        userId: "ug1",
        userHandle: "g1",
        activities: ["hiking"],
        lat: 44.476,
        lng: -73.212,
        thumbUrl: "https://cdn/g1.jpg",
      },
      {
        postId: "g2",
        time: 8000,
        userId: "ug2",
        userHandle: "g2",
        activities: ["hiking"],
        lat: 44.49,
        lng: -73.22,
        thumbUrl: "https://cdn/g2.jpg",
      },
      {
        postId: "g3",
        time: 7000,
        userId: "ug3",
        userHandle: "g3",
        activities: ["hiking"],
        lat: 44.7,
        lng: -73.35,
        thumbUrl: "https://cdn/g3.jpg",
      },
    ];
    const geoRepo = {
      async listFromPool() {
        return { posts: geoRows as any[], ...poolMeta({ readCount: 3 }) };
      },
      async listFromPoolWithWarmWait() {
        return this.listFromPool();
      },
    };
    const geoService = new MixesService(geoRepo as any);
    const first = await geoService.page({
      mixKey: "nearby",
      filter: { lat: 44.476, lng: -73.212, radiusKm: 200 },
      limit: 2,
      cursor: null,
      viewerId: null,
    });
    const second = await geoService.page({
      mixKey: "nearby",
      filter: { lat: 44.476, lng: -73.212, radiusKm: 200 },
      limit: 2,
      cursor: first.nextCursor,
      viewerId: null,
    });
    expect(first.posts.map((p: any) => p.postId)).toEqual(["g1", "g2"]);
    expect(second.posts.map((p: any) => p.postId)).toEqual(["g3"]);
  });

  it("activity + location pagination includes alternate activity fields with no duplicate ids across pages", async () => {
    const altRows = [
      {
        postId: "al1",
        time: 5000,
        userId: "u1",
        userHandle: "al1",
        tags: ["kayak"],
        lat: 44.476,
        lng: -73.212,
        thumbUrl: "https://cdn/al1.jpg",
      },
      {
        postId: "al2",
        time: 4900,
        userId: "u2",
        userHandle: "al2",
        category: "kayak",
        lat: 44.48,
        lng: -73.215,
        thumbUrl: "https://cdn/al2.jpg",
      },
      {
        postId: "al3",
        time: 4800,
        userId: "u3",
        userHandle: "al3",
        activityIds: ["kayak"],
        lat: 44.5,
        lng: -73.23,
        thumbUrl: "https://cdn/al3.jpg",
      },
      {
        postId: "other",
        time: 4700,
        userId: "u4",
        userHandle: "other",
        activities: ["hiking"],
        lat: 44.476,
        lng: -73.212,
        thumbUrl: "https://cdn/other.jpg",
      },
    ];
    const altRepo = {
      async listFromPool() {
        return { posts: altRows as any[], ...poolMeta({ readCount: 4 }) };
      },
      async listFromPoolWithWarmWait() {
        return this.listFromPool();
      },
    };
    const altService = new MixesService(altRepo as any);
    const first = await altService.page({
      mixKey: "kayak-near",
      filter: { activity: "kayak", lat: 44.476, lng: -73.212, radiusKm: 50 },
      limit: 2,
      cursor: null,
      viewerId: "alt-activity-geo-viewer",
    });
    const second = await altService.page({
      mixKey: "kayak-near",
      filter: { activity: "kayak", lat: 44.476, lng: -73.212, radiusKm: 50 },
      limit: 2,
      cursor: first.nextCursor,
      viewerId: "alt-activity-geo-viewer",
    });
    const allIds = [...first.posts.map((p: any) => p.postId), ...second.posts.map((p: any) => p.postId)];
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds.sort()).toEqual(["al1", "al2", "al3"].sort());
    expect(allIds.includes("other")).toBe(false);
  });

  it("keeps first page ordering and cursor stable across pool reorder", async () => {
    const mutable = [...rows];
    const unstableRepo = {
      async listFromPool() {
        return {
          posts: [...mutable] as any[],
          readCount: 0,
          source: "test_pool",
          poolLimit: 1000,
          poolBuiltAt: "2026-01-01T00:00:00.000Z",
          poolBuildLatencyMs: 10,
          poolBuildReadCount: 4,
          poolState: "warm",
          servedStale: false,
          servedEmptyWarming: false,
        };
      },
      async listFromPoolWithWarmWait() {
        return this.listFromPool();
      },
    };
    const unstableService = new MixesService(unstableRepo as any);
    const pageA = await unstableService.page({
      mixKey: "hiking",
      filter: { activity: "hiking" },
      limit: 2,
      cursor: null,
      viewerId: "a",
    });
    mutable.reverse();
    const pageB = await unstableService.page({
      mixKey: "hiking",
      filter: { activity: "hiking" },
      limit: 2,
      cursor: null,
      viewerId: "b",
    });
    expect(pageA.posts.map((p: any) => p.postId)).toEqual(pageB.posts.map((p: any) => p.postId));
    expect(pageA.nextCursor).toEqual(pageB.nextCursor);
  });

  it("ignores polluted oversized activities arrays for matching", async () => {
    const polluted = [
      {
        postId: "px",
        time: 5000,
        userId: "ux",
        userHandle: "polluted",
        activities: Array.from({ length: 40 }).map((_, idx) => `tag-${idx}`),
        state: "Vermont",
        city: "Burlington",
        thumbUrl: "https://cdn/px.jpg",
      },
      ...rows,
    ];
    const pollutedRepo = {
      async listFromPool() {
        return {
          posts: polluted as any[],
          readCount: 0,
          source: "test_pool",
          poolLimit: 1000,
          poolBuiltAt: "2026-01-01T00:00:00.000Z",
          poolBuildLatencyMs: 10,
          poolBuildReadCount: 4,
          poolState: "warm",
          servedStale: false,
          servedEmptyWarming: false,
        };
      },
      async listFromPoolWithWarmWait() {
        return this.listFromPool();
      },
    };
    const pollutedService = new MixesService(pollutedRepo as any);
    const out = await pollutedService.preview({
      mixKey: "tag9",
      filter: { activity: "tag-9" },
      limit: 3,
      viewerId: null,
    });
    expect(out.posts.some((p: any) => p.postId === "px")).toBe(false);
  });

  it("emits normalized media readiness for ready and processing video mix cards", async () => {
    const mediaRepo = {
      async listFromPool() {
        return {
          posts: [
            {
              postId: "ready-video",
              time: 7000,
              userId: "u-ready",
              userHandle: "ready",
              mediaType: "video",
              mediaStatus: "ready",
              assetsReady: true,
              playbackReady: true,
              playbackUrl: "https://cdn/ready_720_hevc.mp4",
              fallbackVideoUrl: "https://cdn/ready_original.mp4",
              thumbUrl: "https://cdn/ready_poster.jpg",
              assets: [{ type: "video", variants: { main720Avc: "https://cdn/ready_720_hevc.mp4" } }],
              activities: ["hiking"],
            },
            {
              postId: "processing-video",
              time: 6000,
              userId: "u-processing",
              userHandle: "processing",
              mediaType: "video",
              mediaStatus: "processing",
              assetsReady: false,
              playbackReady: false,
              fallbackVideoUrl: "https://cdn/processing_original.mp4",
              thumbUrl: "https://cdn/processing_poster.jpg",
              assets: [{ type: "video", variants: {} }],
              activities: ["hiking"],
            },
          ] as any[],
          readCount: 2,
          source: "test_pool",
          poolState: "warm",
          servedStale: false,
          servedEmptyWarming: false,
          poolLimit: 1000,
          poolBuiltAt: "2026-01-01T00:00:00.000Z",
          poolBuildLatencyMs: 0,
          poolBuildReadCount: 2,
        };
      },
      async listFromPoolWithWarmWait() {
        return this.listFromPool();
      },
    };
    const mediaService = new MixesService(mediaRepo as any);
    const out = await mediaService.page({
      mixKey: "hiking",
      filter: { activity: "hiking" },
      limit: 6,
      cursor: null,
      viewerId: null,
    });
    const ready = out.posts.find((p: any) => p.postId === "ready-video");
    const processing = out.posts.find((p: any) => p.postId === "processing-video");
    expect(ready.playbackReady).toBe(true);
    expect(Boolean(ready.playbackUrl || ready.fallbackVideoUrl)).toBe(true);
    expect(processing.mediaStatus).toBe("processing");
    expect(processing.playbackReady).toBe(false);
    expect(processing.playbackUrl ?? null).toBeNull();
    expect(typeof processing.fallbackVideoUrl).toBe("string");
  });
});
