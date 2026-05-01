import { describe, expect, it } from "vitest";
import { InvitesService } from "./invites.service.js";

describe("invites service", () => {
  it("resolves a normal user invite payload", async () => {
    const service = new InvitesService({
      async loadInviter(_branchData: Record<string, unknown>, inviterUserId: string) {
        return {
          userId: inviterUserId,
          name: "Alice",
          handle: "alice",
          profilePic: "https://example.com/alice.jpg",
          resolvedUserExists: true,
        };
      },
    } as never);

    const result = await service.resolve({
      invite_type: "user_invite",
      invite_token: "invite:user-1",
      inviter_uid: "user-1",
    });

    expect(result).toEqual({
      inviteType: "user_invite",
      inviteToken: "invite:user-1",
      inviter: {
        userId: "user-1",
        name: "Alice",
        handle: "alice",
        profilePic: "https://example.com/alice.jpg",
        resolvedUserExists: true,
      },
      group: null,
    });
  });

  it("resolves a deferred group invite from the legacy invite token", async () => {
    const service = new InvitesService({
      async loadGroup(groupId: string) {
        return {
          groupId,
          name: "Hikers",
          slug: "hikers",
          bio: "Trail crew",
          photoUrl: "",
          memberCount: 12,
          chatId: "chat-1",
          joinMode: "open" as const,
          isPublic: true,
          college: {
            enabled: false,
            eduEmailDomain: "",
            requiresVerification: false,
          },
        };
      },
    } as never);

    const result = await service.resolve({
      invite_type: "group_invite",
      invite_token: "group:g-1",
    });

    expect(result.inviteType).toBe("group_invite");
    expect(result.group?.groupId).toBe("g-1");
    expect(result.inviter).toBeNull();
  });

  it("fails cleanly for malformed payloads", async () => {
    const service = new InvitesService({} as never);
    await expect(service.resolve({ invite_type: "user_invite" })).rejects.toThrow("malformed_branch_params");
    await expect(service.resolve({ invite_type: "unknown" })).rejects.toThrow("malformed_branch_params");
  });

  it("fails cleanly for expired or missing groups", async () => {
    const service = new InvitesService({
      async loadGroup() {
        return null;
      },
    } as never);

    await expect(
      service.resolve({
        invite_type: "group_invite",
        invite_token: "group:missing-group",
      }),
    ).rejects.toThrow("invalid_or_expired_group_invite");
  });
});
