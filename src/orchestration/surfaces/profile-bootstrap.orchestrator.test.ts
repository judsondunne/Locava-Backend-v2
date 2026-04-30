import { describe, expect, it } from "vitest";
import { ProfileBootstrapOrchestrator } from "./profile-bootstrap.orchestrator.js";

describe("profile bootstrap orchestrator aliases", () => {
  it("populates native count aliases from resolved follow counts", async () => {
    const loadBadgeSummary = async () => ({ badge: "rising", score: 62 });
    const orchestrator = new ProfileBootstrapOrchestrator({
      loadHeader: async () => ({
        userId: "u-1",
        handle: "user_1",
        name: "User One",
        profilePic: null,
        bio: "bio",
        counts: { posts: 2, followers: 13, following: 9 }
      }),
      loadRelationship: async () => ({
        isSelf: false,
        following: false,
        followedBy: false,
        canMessage: true
      }),
      loadGridPreview: async () => ({
        items: [],
        nextCursor: null
      }),
      loadBadgeSummary
    } as never);

    const payload = await orchestrator.run({
      viewer: { viewerId: "viewer-1", roles: ["internal"] } as never,
      userId: "u-1",
      gridLimit: 12,
      debugSlowDeferredMs: 0
    });

    expect(payload.firstRender.stats.followersCount).toBe(13);
    expect(payload.firstRender.stats.followingCount).toBe(9);
    expect(payload.firstRender.stats.numFollowers).toBe(13);
    expect(payload.firstRender.stats.numFollowing).toBe(9);
    expect(payload.firstRender.profile.followersCount).toBe(13);
    expect(payload.firstRender.profile.followingCount).toBe(9);
    expect(payload.firstRender.counts.followersCount).toBe(13);
    expect(payload.firstRender.counts.followingCount).toBe(9);
    expect(payload.deferred.profileBadgeSummary).toEqual({ badge: "rising", score: 62 });
  });
});
