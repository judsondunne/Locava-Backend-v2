import { describe, expect, it } from "vitest";
import { ProfileFirestoreAdapter } from "./profile-firestore.adapter.js";

function makeUserDoc(data: Record<string, unknown>) {
  return {
    exists: true,
    data: () => data
  };
}

function makeDb(opts: {
  userData?: Record<string, unknown>;
  followersCount?: number;
  followingCount?: number;
  postsCount?: number;
  followersGetThrows?: boolean;
  followingGetThrows?: boolean;
  postsGetThrows?: boolean;
  followersCountThrows?: boolean;
  followingCountThrows?: boolean;
  postsCountThrows?: boolean;
}) {
  const {
    userData = { handle: "user_1", name: "User One" },
    followersCount = 0,
    followingCount = 0,
    postsCount = 0,
    followersGetThrows = false,
    followingGetThrows = false,
    postsGetThrows = false,
    followersCountThrows = false,
    followingCountThrows = false,
    postsCountThrows = false
  } = opts;

  const followersRef = {
    count: () => ({
      get: async () => {
        if (followersCountThrows) throw new Error("followers_count_failed");
        return { data: () => ({ count: followersCount }) };
      }
    }),
    get: async () => {
      if (followersGetThrows) throw new Error("followers_get_failed");
      return { size: followersCount };
    }
  };
  const followingRef = {
    count: () => ({
      get: async () => {
        if (followingCountThrows) throw new Error("following_count_failed");
        return { data: () => ({ count: followingCount }) };
      }
    }),
    get: async () => {
      if (followingGetThrows) throw new Error("following_get_failed");
      return { size: followingCount };
    }
  };
  const postsQuery = {
    count: () => ({
      get: async () => {
        if (postsCountThrows) throw new Error("posts_count_failed");
        return { data: () => ({ count: postsCount }) };
      }
    }),
    get: async () => {
      if (postsGetThrows) throw new Error("posts_get_failed");
      return { size: postsCount };
    }
  };

  return {
    collection: (name: string) => {
      if (name === "posts") {
        return {
          where: (_field: string, _op: string, _value: string) => postsQuery
        };
      }
      if (name !== "users") throw new Error("unexpected_collection");
      return {
        doc: (_userId: string) => ({
          get: async () => makeUserDoc(userData),
          set: async () => undefined,
          collection: (sub: string) => {
            if (sub === "followers") return followersRef;
            if (sub === "following") return followingRef;
            throw new Error("unexpected_subcollection");
          }
        })
      };
    }
  };
}

describe("profile firestore adapter follow counts", () => {
  it("prefers canonical post counts over stale embedded totals", async () => {
    const db = makeDb({
      userData: {
        handle: "user_1",
        name: "User One",
        postCount: 12
      },
      postsCount: 11,
      followersCount: 2,
      followingCount: 1
    });
    const adapter = new ProfileFirestoreAdapter(db as never);
    const header = await adapter.getProfileHeader("u-post-count");
    expect(header.data.counts.posts).toBe(11);
  });

  it("falls back to embedded post counts when canonical queries are unavailable", async () => {
    const db = makeDb({
      userData: {
        handle: "user_1",
        name: "User One",
        postCount: 12
      },
      postsCountThrows: true,
      postsGetThrows: true
    });
    const adapter = new ProfileFirestoreAdapter(db as never);
    const header = await adapter.getProfileHeader("u-post-count-fallback");
    expect(header.data.counts.posts).toBe(12);
  });

  it("uses a freshly verified embedded post count without re-querying posts", async () => {
    const db = makeDb({
      userData: {
        handle: "user_1",
        name: "User One",
        postCount: 12,
        postCountVerifiedAtMs: Date.now()
      },
      postsCountThrows: true,
      postsGetThrows: true
    });
    const adapter = new ProfileFirestoreAdapter(db as never);
    const header = await adapter.getProfileHeader("u-post-count-verified");
    expect(header.data.counts.posts).toBe(12);
  });

  it("uses arrays when subcollections unavailable", async () => {
    const db = makeDb({
      userData: {
        handle: "user_1",
        name: "User One",
        followers: ["a", "a", "b", { userId: "c" }],
        following: ["x", { id: "y" }, { uid: "z" }, "x"]
      },
      followersCountThrows: true,
      followingCountThrows: true,
      followersGetThrows: true,
      followingGetThrows: true
    });
    const adapter = new ProfileFirestoreAdapter(db as never);
    const header = await adapter.getProfileHeader("u-arrays");
    expect(header.data.counts.followers).toBe(3);
    expect(header.data.counts.following).toBe(3);
  });

  it("prefers subcollection counts when available", async () => {
    const db = makeDb({
      userData: {
        handle: "user_1",
        name: "User One"
      },
      followersCount: 11,
      followingCount: 7
    });
    const adapter = new ProfileFirestoreAdapter(db as never);
    const header = await adapter.getProfileHeader("u-subcollections");
    expect(header.data.counts.followers).toBe(11);
    expect(header.data.counts.following).toBe(7);
  });

  it("returns zero for empty graph", async () => {
    const db = makeDb({
      userData: {
        handle: "user_1",
        name: "User One"
      },
      followersCount: 0,
      followingCount: 0
    });
    const adapter = new ProfileFirestoreAdapter(db as never);
    const header = await adapter.getProfileHeader("u-empty");
    expect(header.data.counts.followers).toBe(0);
    expect(header.data.counts.following).toBe(0);
  });
});
