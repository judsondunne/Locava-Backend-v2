import { describe, expect, it, vi } from "vitest";

type PostSeed = { id: string; data: Record<string, unknown> };

const firestoreMockState = vi.hoisted(() => ({ db: null as any }));

function buildPostsDb(posts: PostSeed[]) {
  const byId = new Map(posts.map((post) => [post.id, post.data]));
  return {
    collection(name: string) {
      if (name !== "posts") throw new Error("unexpected_collection_" + name);
      return {
        orderBy(field: string, direction: string) {
          if (field !== "time" || direction !== "desc") {
            throw new Error("unexpected_order_" + field + "_" + direction);
          }
          return {
            offset(skip: number) {
              return {
                limit(limit: number) {
                  return {
                    async get() {
                      const selected = posts.slice(skip, skip + limit);
                      return {
                        size: selected.length,
                        docs: selected.map((post) => ({
                          id: post.id,
                          data: () => post.data
                        }))
                      };
                    }
                  };
                }
              };
            },
            limit(limit: number) {
              return {
                async get() {
                  const selected = posts.slice(0, limit);
                  return {
                    size: selected.length,
                    docs: selected.map((post) => ({
                      id: post.id,
                      data: () => post.data
                    }))
                  };
                }
              };
            }
          };
        },
        doc(id: string) {
          return {
            async get() {
              const value = byId.get(id) ?? null;
              return {
                exists: value != null,
                data: () => value
              };
            }
          };
        }
      };
    }
  };
}

vi.mock("../../repositories/source-of-truth/firestore-client.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getFirestoreSourceClient: vi.fn(() => firestoreMockState.db)
  };
});

import { createApp } from "../../app/createApp.js";

describe("debug post rebuilder", () => {
  it("serves the multi-post queue UI", async () => {
    const app = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ENABLE_POST_REBUILDER_DEBUG_ROUTES: true
    });
    try {
      const res = await app.inject({ method: "GET", url: "/debug/post-rebuilder" });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("Post Rebuilder Queue");
      expect(res.body).toContain("Manual Mode");
      expect(res.body).toContain("Auto Preview + Write Queue");
      expect(res.body).toContain("Generate Missing Fast Starts");
      expect(res.body).toContain("Optimize + Write Selected");
      expect(res.body).toContain("Also generate missing fast starts before preview/write");
      expect(res.body).toContain("Build Queue From IDs");
      expect(res.body).toContain("Load by rank");
      expect(res.body).toContain("Firestore rank");
      expect(res.body).toContain("compactCheck");
      expect(res.body).toContain("Already compact · skipped");
      expect(res.body).toContain("Video faststart pending");
      expect(res.body).toContain("LIVE OK");
    } finally {
      await app.close();
    }
  });

  it("lists newest posts for queue building", async () => {
    firestoreMockState.db = buildPostsDb([
      {
        id: "post-newest-1",
        data: {
          time: "2026-05-05T14:00:00.000Z",
          userId: "user-1",
          title: "Sunrise Run",
          classification: { mediaKind: "video" },
          location: { display: { name: "Montauk" } }
        }
      },
      {
        id: "post-newest-2",
        data: {
          time: "2026-05-05T13:55:00.000Z",
          text: { title: "Cliff Jump" },
          author: { userId: "user-2" },
          classification: { mediaKind: "image" },
          location: { display: { name: "Malibu" } },
          schema: { version: "master-post-v2" }
        }
      }
    ]);

    const app = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ENABLE_POST_REBUILDER_DEBUG_ROUTES: true
    });
    try {
      const res = await app.inject({ method: "GET", url: "/debug/post-rebuilder/posts?limit=2" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.order).toBe("time_desc");
      expect(body.count).toBe(2);
      expect(body.offset).toBe(0);
      expect(body.limit).toBe(2);
      expect(body.posts.map((post: { postId: string }) => post.postId)).toEqual(["post-newest-1", "post-newest-2"]);
      expect(body.posts[0]).toMatchObject({
        postId: "post-newest-1",
        title: "Sunrise Run",
        mediaKind: "video",
        userId: "user-1",
        locationName: "Montauk",
        hasCanonicalSchema: false
      });
      expect(body.posts[1]).toMatchObject({
        postId: "post-newest-2",
        title: "Cliff Jump",
        mediaKind: "image",
        userId: "user-2",
        locationName: "Malibu",
        hasCanonicalSchema: true,
        schemaVersion: "master-post-v2"
      });
    } finally {
      await app.close();
    }
  });

  it("lists posts with offset (rank window) for queue building", async () => {
    firestoreMockState.db = buildPostsDb([
      {
        id: "post-a",
        data: { time: "2026-05-05T15:00:00.000Z", userId: "u1", title: "A" }
      },
      {
        id: "post-b",
        data: { time: "2026-05-05T14:00:00.000Z", userId: "u2", title: "B" }
      },
      {
        id: "post-c",
        data: { time: "2026-05-05T13:00:00.000Z", userId: "u3", title: "C" }
      }
    ]);

    const app = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ENABLE_POST_REBUILDER_DEBUG_ROUTES: true
    });
    try {
      const res = await app.inject({ method: "GET", url: "/debug/post-rebuilder/posts?offset=1&limit=1" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.offset).toBe(1);
      expect(body.limit).toBe(1);
      expect(body.count).toBe(1);
      expect(body.posts.map((post: { postId: string }) => post.postId)).toEqual(["post-b"]);
    } finally {
      await app.close();
    }
  });

  it("returns firestore_unavailable when newest queue loading has no source client", async () => {
    firestoreMockState.db = null;
    const app = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ENABLE_POST_REBUILDER_DEBUG_ROUTES: true
    });
    try {
      const res = await app.inject({ method: "GET", url: "/debug/post-rebuilder/posts?limit=3" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: "firestore_unavailable", posts: [] });
    } finally {
      await app.close();
    }
  });

  it("returns post_not_found for analyze-fast-start on missing post", async () => {
    firestoreMockState.db = buildPostsDb([]);
    const app = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ENABLE_POST_REBUILDER_DEBUG_ROUTES: true
    });
    try {
      const res = await app.inject({ method: "POST", url: "/debug/post-rebuilder/missing/analyze-fast-start" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "post_not_found" });
    } finally {
      await app.close();
    }
  });

  it("returns post_not_found for optimize-and-write on missing post", async () => {
    firestoreMockState.db = buildPostsDb([]);
    const app = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ENABLE_POST_REBUILDER_DEBUG_ROUTES: true
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/debug/post-rebuilder/missing/optimize-and-write",
        payload: { strict: true }
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().status).toBe("post_not_found");
    } finally {
      await app.close();
    }
  });
});
