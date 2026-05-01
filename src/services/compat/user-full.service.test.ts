import { describe, expect, it } from "vitest";

describe("compat user full service", () => {
  it("includes joined groups for profile hydration", async () => {
    process.env.FIRESTORE_TEST_MODE = "disabled";
    const { CompatUserFullService } = await import("./user-full.service.js");
    const service = new CompatUserFullService(
      {
        async loadUserSocialEdges() {
          return {
            followers: ["user-2"],
            following: ["user-3"],
            followersCount: 1,
            followingCount: 1,
            lastLoginAt: 123,
            primaryGroup: {
              groupId: "group-1",
              name: "Hikers",
              slug: "hikers",
              photoUrl: "",
              role: "member",
              joinedAt: 999,
            },
          };
        },
      } as never,
      {
        async listMembershipsForProfile() {
          return [
            {
              groupId: "group-1",
              name: "Hikers",
              slug: "hikers",
              photoUrl: "",
              role: "member" as const,
              joinedAt: 999,
            },
          ];
        },
      } as never,
    );

    const result = await service.buildUserData({
      viewerId: "viewer-1",
      targetUserId: "viewer-1",
      profileBootstrap: {
        firstRender: {
          profile: { name: "Viewer", handle: "viewer", profilePic: "" },
          relationship: { following: false },
        },
      },
    });

    expect(result.primaryGroup).toEqual({
      groupId: "group-1",
      name: "Hikers",
      slug: "hikers",
      photoUrl: "",
      role: "member",
      joinedAt: 999,
    });
    expect(result.groupMemberships).toEqual([
      {
        groupId: "group-1",
        name: "Hikers",
        slug: "hikers",
        photoUrl: "",
        role: "member",
        joinedAt: 999,
      },
    ]);
  });
});
