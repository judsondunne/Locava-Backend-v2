import { describe, expect, it } from "vitest";
import { AuthBranchAttributionService } from "./auth-branch-attribution.service.js";

describe("auth branch attribution service", () => {
  it("builds legacy-compatible create-profile fields for user invites", () => {
    const service = new AuthBranchAttributionService({
      isAvailable: () => true,
    } as never);

    const fields = service.buildCreateProfileFields({
      invite_type: "user_invite",
      invite_token: "invite:user-1",
      inviter_uid: "user-1",
      inviter_handle: "@alice",
      inviter_name: "Alice",
      inviter_profile_pic: "https://example.com/alice.jpg",
      campaign: "spring_launch",
      campus_id: "campus-1",
      _capturedAtMs: 123,
    });

    expect(fields.branchData).toEqual({
      links: [
        {
          invite_type: "user_invite",
          invite_token: "invite:user-1",
          inviter_uid: "user-1",
          inviter_handle: "@alice",
          inviter_name: "Alice",
          inviter_profile_pic: "https://example.com/alice.jpg",
          campaign: "spring_launch",
          campus_id: "campus-1",
        },
      ],
    });
    expect(fields.cohortKeys).toEqual(["spring_launch:campus-1"]);
    expect(fields.referredByUserId).toBe("user-1");
    expect(fields.referredByHandle).toBe("@alice");
    expect(fields.referredByName).toBe("Alice");
    expect(fields.referralInviteType).toBe("user_invite");
    expect(fields.referralInviteToken).toBe("invite:user-1");
  });

  it("keeps deferred group invites without forcing referral fields", () => {
    const service = new AuthBranchAttributionService({
      isAvailable: () => true,
    } as never);

    const fields = service.buildCreateProfileFields({
      invite_type: "group_invite",
      invite_token: "group:g-1",
      group_id: "g-1",
      group_name: "Hikers",
      campaign: "group_invite",
      campus_id: "g-1",
    });

    expect(fields.branchData).toEqual({
      links: [
        {
          invite_type: "group_invite",
          invite_token: "group:g-1",
          group_id: "g-1",
          group_name: "Hikers",
          campaign: "group_invite",
          campus_id: "g-1",
        },
      ],
    });
    expect(fields.cohortKeys).toEqual(["group_invite:g-1"]);
    expect("referredByUserId" in fields).toBe(false);
  });

  it("merges branch data idempotently for existing users", async () => {
    const mergeCalls: Array<{ userId: string; patch: Record<string, unknown> }> = [];
    const inviterCalls: Array<{ inviterUserId: string; inviteToken?: string }> = [];
    const cohortCalls: Array<{ cohortKey: string; branchData: Record<string, unknown> }> = [];
    const service = new AuthBranchAttributionService({
      isAvailable: () => true,
      async loadUserState() {
        return {
          exists: true,
          branchData: {
            links: [
              {
                invite_type: "user_invite",
                invite_token: "invite:user-1",
                inviter_uid: "user-1",
                campaign: "spring_launch",
                campus_id: "campus-1",
              },
            ],
          },
          cohortKeys: ["spring_launch:campus-1"],
          referredByUserId: "user-1",
          name: "Bob",
          handle: "bob",
        };
      },
      async mergeUserPatch(userId: string, patch: Record<string, unknown>) {
        mergeCalls.push({ userId, patch });
      },
      async incrementCohortCount(cohortKey: string, branchData: Record<string, unknown>) {
        cohortCalls.push({ cohortKey, branchData });
      },
      async incrementInviterReferralSignup(inviterUserId: string, inviteToken?: string) {
        inviterCalls.push({ inviterUserId, inviteToken });
      },
    } as never);

    const same = await service.mergeBranchDataIntoExistingUser("viewer-1", {
      invite_type: "user_invite",
      invite_token: "invite:user-1",
      inviter_uid: "user-1",
      campaign: "spring_launch",
      campus_id: "campus-1",
    });
    expect(same.merged).toBe(false);
    expect(mergeCalls).toHaveLength(1);
    const samePatch = mergeCalls[0]!;
    expect(((samePatch.patch.branchData as { links: unknown[] }).links)).toHaveLength(1);
    expect(cohortCalls).toHaveLength(0);
    expect(inviterCalls).toHaveLength(0);

    mergeCalls.length = 0;
    const next = await service.mergeBranchDataIntoExistingUser("viewer-1", {
      invite_type: "user_invite",
      invite_token: "invite:user-2",
      inviter_uid: "user-2",
      inviter_name: "Casey",
      campaign: "summer_launch",
      campus_id: "campus-2",
    });
    expect(next.merged).toBe(true);
    expect(mergeCalls).toHaveLength(1);
    const nextPatch = mergeCalls[0]!;
    expect(((nextPatch.patch.branchData as { links: unknown[] }).links)).toHaveLength(2);
    expect(nextPatch.patch.referredByUserId).toBe("user-2");
    expect(nextPatch.patch.cohortKeys).toEqual(["spring_launch:campus-1", "summer_launch:campus-2"]);
    expect(cohortCalls).toEqual([
      {
        cohortKey: "summer_launch:campus-2",
        branchData: {
          invite_type: "user_invite",
          invite_token: "invite:user-2",
          inviter_uid: "user-2",
          inviter_name: "Casey",
          campaign: "summer_launch",
          campus_id: "campus-2",
        },
      },
    ]);
    expect(inviterCalls).toEqual([{ inviterUserId: "user-2", inviteToken: "invite:user-2" }]);
  });
});
