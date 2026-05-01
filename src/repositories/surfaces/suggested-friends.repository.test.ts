import { describe, expect, it } from "vitest";
import { extractCandidateUserIdsFromBranchData } from "./suggested-friends.repository.js";

describe("suggested friends branch candidate extraction", () => {
  it("ingests suggested-user candidates from invite context", () => {
    const ids = extractCandidateUserIdsFromBranchData(
      {
        invite_type: "user_invite",
        inviter_uid: "user-12345678",
        branchData: {
          links: [
            {
              senderUserId: "user-87654321",
            },
          ],
        },
      },
      { viewerId: "viewer-1" },
    );

    expect(ids).toEqual(["user-12345678", "user-87654321"]);
  });
});
