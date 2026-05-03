import { describe, expect, it, vi } from "vitest";
import { ProfileBootstrapOrchestrator } from "./profile-bootstrap.orchestrator.js";

describe("profile bootstrap orchestrator", () => {
  it("populates native aliases and carries staged preview slices without fake deferred data", async () => {
    const orchestrator = new ProfileBootstrapOrchestrator({
      loadHeader: async () => ({
        userId: "u-1",
        handle: "user_1",
        name: "User One",
        profilePic: "https://cdn.example.com/u-1.jpg",
        bio: "bio",
        counts: { posts: 2, followers: 13, following: 9 },
        profilePicSource: "profilePicLargePath",
        profilePicSmallPath: "small/u-1.jpg",
        profilePicLargePath: "large/u-1.jpg",
        updatedAtMs: 1234,
        profileVersion: "v3",
      }),
      loadRelationship: async () => ({
        isSelf: false,
        following: true,
        followedBy: false,
        canMessage: true,
      }),
      loadGridPreview: async () => ({
        items: [
          {
            postId: "p1",
            thumbUrl: "https://cdn.example.com/p1.jpg",
            mediaType: "image",
            aspectRatio: 1,
            updatedAtMs: 100,
          },
        ],
        nextCursor: "grid-next",
      }),
      loadCollections: async () => ({
        items: [
          {
            collectionId: "c1",
            ownerId: "u-1",
            name: "Favorites",
            privacy: "public",
            itemCount: 3,
            coverUri: "https://cdn.example.com/c1.jpg",
            updatedAtMs: 101,
          },
        ],
        nextCursor: "collections-next",
        emptyReason: null,
      }),
      loadAchievements: async () => ({
        items: [
          {
            achievementId: "a1",
            title: "Early Bird",
            description: "First post",
            badgeSource: "static",
            badgeType: "activity",
            earnedAtMs: 102,
            progressCurrent: 1,
            progressTarget: 1,
            visibility: "public",
          },
        ],
        nextCursor: "achievements-next",
        emptyReason: null,
      }),
      loadBadgeSummary: async () => null,
    } as never);

    const payload = await orchestrator.run({
      viewer: { viewerId: "viewer-1", roles: ["internal"] } as never,
      userId: "u-1",
      gridLimit: 12,
      debugSlowDeferredMs: 0,
    });

    expect(payload.firstRender.stats.followersCount).toBe(13);
    expect(payload.firstRender.stats.followingCount).toBe(9);
    expect(payload.firstRender.stats.numFollowers).toBe(13);
    expect(payload.firstRender.stats.numFollowing).toBe(9);
    expect(payload.firstRender.profile.followersCount).toBe(13);
    expect(payload.firstRender.profile.followingCount).toBe(9);
    expect(payload.firstRender.counts.followersCount).toBe(13);
    expect(payload.firstRender.counts.followingCount).toBe(9);
    expect(payload.summary.profilePic).toBe("https://cdn.example.com/u-1.jpg");
    expect(payload.firstRender.gridPreview.items).toHaveLength(1);
    expect(payload.firstRender.collectionsPreview.items).toHaveLength(1);
    expect(payload.firstRender.achievementsPreview.items).toHaveLength(1);
    expect(payload.firstRender.collectionsPreview.nextCursor).toBe("collections-next");
    expect(payload.firstRender.achievementsPreview.nextCursor).toBe("achievements-next");
    expect(payload.deferred.profileBadgeSummary).toBeNull();
    expect(payload.debug?.profileHeaderRepair?.gridVsPostsInvariantViolated).toBe(false);
  });

  it("raises posts count to at least grid preview size when header posts were wrongly zero", async () => {
    const orchestrator = new ProfileBootstrapOrchestrator({
      loadHeader: async () => ({
        userId: "u-grid",
        handle: "grid_user",
        name: "Grid User",
        profilePic: "https://cdn.example.com/u.jpg",
        counts: { posts: 0, followers: 4, following: 2 },
      }),
      loadRelationship: async () => ({
        isSelf: false,
        following: false,
        followedBy: false,
        canMessage: true,
      }),
      loadGridPreview: async () => ({
        items: Array.from({ length: 12 }, (_, i) => ({
          postId: `p${i}`,
          thumbUrl: `https://cdn.example.com/t${i}.jpg`,
          mediaType: "image" as const,
          updatedAtMs: 100 + i,
        })),
        nextCursor: null,
      }),
      loadCollections: async () => ({ items: [], nextCursor: null, emptyReason: null }),
      loadAchievements: async () => ({ items: [], nextCursor: null, emptyReason: null }),
      loadBadgeSummary: async () => null,
    } as never);

    const payload = await orchestrator.run({
      viewer: { viewerId: "viewer-z", roles: ["internal"] } as never,
      userId: "u-grid",
      gridLimit: 12,
      debugSlowDeferredMs: 500,
    });

    expect(payload.firstRender.counts.posts).toBe(12);
    expect(payload.summary.postCount).toBe(12);
    expect(payload.debug?.profileHeaderRepair?.gridVsPostsInvariantViolated).toBe(true);
    expect(payload.debug?.profileHeaderRepair?.postCountLowerBoundUsed).toBe(true);
  });

  it("uses safe defaults and degrades instead of throwing when profile social stats are missing", async () => {
    const orchestrator = new ProfileBootstrapOrchestrator({
      loadHeader: async () => ({
        userId: "u-2",
        handle: null,
        name: null,
        profilePic: undefined,
        bio: undefined,
        counts: undefined,
      }),
      loadRelationship: async () => {
        throw new TypeError("followers missing");
      },
      loadGridPreview: async () => ({ items: [], nextCursor: null }),
      loadCollections: async () => ({ items: [], nextCursor: null, emptyReason: null }),
      loadAchievements: async () => ({ items: [], nextCursor: null, emptyReason: null }),
      loadBadgeSummary: async () => null,
    } as never);

    const payload = await orchestrator.run({
      viewer: { viewerId: "viewer-2", roles: ["internal"] } as never,
      userId: "u-2",
      gridLimit: 12,
      debugSlowDeferredMs: 0,
    });

    expect(payload.profileUserId).toBe("u-2");
    expect(payload.firstRender.profile.profilePic).toBeNull();
    expect(payload.firstRender.counts.followers).toBe(0);
    expect(payload.firstRender.counts.following).toBe(0);
    expect(payload.firstRender.relationship.following).toBe(false);
    expect(payload.degraded).toBe(true);
    expect(payload.fallbacks).toContain("profile_relationship_unavailable");
  });

  it("computes self vs other-user relationship safely", async () => {
    const loadHeader = async (userId: string) => ({
      userId,
      handle: `@${userId}`,
      name: userId === "self" ? "Self User" : "Other User",
      profilePic: "",
      counts: { posts: 0, followers: 0, following: 0 },
    });
    const loadRelationship = async (viewerId: string, userId: string) => ({
      isSelf: viewerId === userId,
      following: viewerId !== userId,
      followedBy: false,
      canMessage: viewerId !== userId,
    });
    const service = {
      loadHeader,
      loadRelationship,
      loadGridPreview: async () => ({ items: [], nextCursor: null }),
      loadCollections: async () => ({ items: [], nextCursor: null, emptyReason: null }),
      loadAchievements: async () => ({ items: [], nextCursor: null, emptyReason: null }),
      loadBadgeSummary: async () => null,
    } as never;
    const orchestrator = new ProfileBootstrapOrchestrator(service);

    const self = await orchestrator.run({
      viewer: { viewerId: "self", roles: ["internal"] } as never,
      userId: "self",
      gridLimit: 12,
      debugSlowDeferredMs: 100,
    });
    const other = await orchestrator.run({
      viewer: { viewerId: "self", roles: ["internal"] } as never,
      userId: "other",
      gridLimit: 12,
      debugSlowDeferredMs: 100,
    });

    expect(self.firstRender.profile.isOwnProfile).toBe(true);
    expect(other.firstRender.profile.isOwnProfile).toBe(false);
    expect(other.firstRender.relationship.following).toBe(true);
  });

  it("reuses cached bootstrap loaders for repeated opens", async () => {
    const loadHeader = vi.fn(async () => ({
      userId: "repeat-user",
      handle: "repeat-user",
      name: "Repeat User",
      profilePic: "",
      counts: { posts: 1, followers: 2, following: 3 },
    }));
    const loadRelationship = vi.fn(async () => ({
      isSelf: false,
      following: false,
      followedBy: false,
      canMessage: false,
    }));
    const orchestrator = new ProfileBootstrapOrchestrator({
      loadHeader,
      loadRelationship,
      loadGridPreview: async () => ({ items: [], nextCursor: null }),
      loadCollections: async () => ({ items: [], nextCursor: null, emptyReason: null }),
      loadAchievements: async () => ({ items: [], nextCursor: null, emptyReason: null }),
      loadBadgeSummary: async () => null,
    } as never);

    await orchestrator.run({
      viewer: { viewerId: "viewer-repeat", roles: ["internal"] } as never,
      userId: "repeat-user",
      gridLimit: 12,
      debugSlowDeferredMs: 0,
    });
    await orchestrator.run({
      viewer: { viewerId: "viewer-repeat", roles: ["internal"] } as never,
      userId: "repeat-user",
      gridLimit: 12,
      debugSlowDeferredMs: 0,
    });

    expect(loadHeader).toHaveBeenCalledTimes(1);
    expect(loadRelationship).toHaveBeenCalledTimes(1);
  });
});
