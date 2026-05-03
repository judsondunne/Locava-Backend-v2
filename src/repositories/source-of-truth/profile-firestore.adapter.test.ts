import { afterEach, describe, expect, it } from "vitest";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { clearProcessLocalCacheForTests } from "../../runtime/coherence-provider.js";
import { ProfileFirestoreAdapter, resolveProfilePicture } from "./profile-firestore.adapter.js";

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

afterEach(async () => {
  await clearProcessLocalCacheForTests();
});

describe("profile firestore adapter follow counts", () => {
  it("selects the first non-empty profile picture field deterministically", () => {
    const resolved = resolveProfilePicture({
      profilePicLargePath: "",
      profilePic: "https://cdn.example.com/profile.jpg",
      profilePicSmallPath: "https://cdn.example.com/profile-small.jpg",
      photoURL: "https://cdn.example.com/photo-url.jpg",
    });
    expect(resolved.url).toBe("https://cdn.example.com/profile.jpg");
    expect(resolved.source).toBe("profilePic");
  });

  it("prefers canonical post counts immediately over stale embedded totals", async () => {
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
        postCountVerifiedAtMs: Date.now(),
        postCountVerifiedValue: 12
      },
      postsCountThrows: true,
      postsGetThrows: true
    });
    const adapter = new ProfileFirestoreAdapter(db as never);
    const header = await adapter.getProfileHeader("u-post-count-verified");
    expect(header.data.counts.posts).toBe(12);
  });

  it("prefers verified flat post counts over stale nested stats totals", async () => {
    const db = makeDb({
      userData: {
        handle: "user_1",
        name: "User One",
        postCount: 12,
        postCountVerifiedAtMs: Date.now(),
        postCountVerifiedValue: 12,
        stats: {
          posts: 99
        }
      },
      postsCountThrows: true,
      postsGetThrows: true
    });
    const adapter = new ProfileFirestoreAdapter(db as never);
    const header = await adapter.getProfileHeader("u-post-count-stale-stats");
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

  it("prefers subcollection count aggregation for follow counts", async () => {
    const db = makeDb({
      userData: {
        handle: "user_1",
        name: "User One",
        followerCount: 233,
        followingCount: 77
      },
      followersCount: 11,
      followingCount: 7
    });
    const adapter = new ProfileFirestoreAdapter(db as never);
    const header = await adapter.getProfileHeader("u-embedded-counts");
    expect(header.data.counts.followers).toBe(11);
    expect(header.data.counts.following).toBe(7);
  });

  it("uses subcollection count aggregation when only subcollection counts exist", async () => {
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

  it("getProfileSocialCounts matches subcollection aggregates when denormalized fields are zero", async () => {
    const db = makeDb({
      userData: {
        handle: "user_1",
        name: "User One",
        followersCount: 0,
        followingCount: 0,
      },
      followersCount: 0,
      followingCount: 1,
    });
    const adapter = new ProfileFirestoreAdapter(db as never);
    const counts = await adapter.getProfileSocialCounts("u-social-parity", {
      followersCount: 0,
      followingCount: 0,
    });
    expect(counts.followingCount).toBe(1);
    expect(counts.followerCount).toBe(0);
    expect(counts.exact).toBe(true);
    expect(counts.source).toBe("subcollection_count_agg");
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

  it("does not treat legacy userSummary chat preview cache as a canonical profile header", async () => {
    await globalCache.set(
      entityCacheKeys.userSummary("u-chat-poison"),
      {
        userId: "u-chat-poison",
        handle: "from_chat",
        name: "Chat Preview",
        pic: "https://cdn.example.com/chat-only.jpg",
      },
      25_000
    );
    const db = makeDb({
      userData: {
        handle: "real_handle",
        name: "Real Name",
        profilePic: "https://cdn.example.com/real.jpg",
      },
      followersCount: 9,
      followingCount: 4,
      postsCount: 14,
    });
    const adapter = new ProfileFirestoreAdapter(db as never);
    const header = await adapter.getProfileHeader("u-chat-poison");
    expect(header.data.counts.followers).toBe(9);
    expect(header.data.counts.following).toBe(4);
    expect(header.data.counts.posts).toBe(14);
    expect(header.data.profilePic).toContain("real.jpg");
  });
});
