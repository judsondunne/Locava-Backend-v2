import { describe, expect, it } from "vitest";
import { extractCandidateUserIdsFromBranchData, SuggestedFriendsRepository } from "./suggested-friends.repository.js";

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

  it("continues to all-users fallback when optional group query hits FAILED_PRECONDITION", async () => {
    const viewerId = "viewer-1";
    const makeUserDoc = (id: string, postCount: number) => ({
      id,
      exists: true,
      data: () => ({
        handle: `${id}-handle`,
        name: `Name ${id}`,
        profilePic: null,
        followers: [],
        postCount,
      }),
    });
    const fallbackDocs = [makeUserDoc("user-a", 30), makeUserDoc("user-b", 20), makeUserDoc("user-c", 10)];
    const usersQuery = {
      select() {
        return this;
      },
      limit() {
        return this;
      },
      async get() {
        return {
          size: fallbackDocs.length,
          docs: fallbackDocs,
        };
      },
    };
    const db = {
      collection(name: string) {
        if (name !== "users") throw new Error(`unexpected collection ${name}`);
        return {
          doc(id: string) {
            return {
              id,
              async get() {
                return {
                  id,
                  exists: true,
                  data: () => ({
                    following: [],
                    blockedUsers: [],
                    addressBookUsers: [],
                    addressBookUserSummaries: [],
                    addressBookPhoneNumbers: [],
                  }),
                };
              },
            };
          },
          orderBy() {
            return usersQuery;
          },
        };
      },
      collectionGroup(name: string) {
        if (name !== "members") throw new Error(`unexpected collectionGroup ${name}`);
        return {
          where() {
            return {
              limit() {
                return {
                  async get() {
                    throw new Error("9 FAILED_PRECONDITION: missing collectionGroup index");
                  },
                };
              },
            };
          },
        };
      },
    };

    const repository = new SuggestedFriendsRepository(db as any);
    const result = await repository.getSuggestionsForUser(viewerId, {
      limit: 5,
      includeContacts: false,
      includeMutuals: false,
      includeGroups: true,
      includePopular: false,
      includeNearby: false,
      includeAllUsersFallback: true,
      excludeAlreadyFollowing: true,
      excludeBlocked: true,
      surface: "generic",
    });

    expect(result.users.map((user) => user.userId)).toEqual(["user-a", "user-b", "user-c"]);
    expect(result.sourceBreakdown.all_users).toBe(3);
  });
});
