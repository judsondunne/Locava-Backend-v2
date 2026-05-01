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

describe("contacts sync parity matching", () => {
  it("matches legacy `number` users even when canonical fields are missing", async () => {
    const docs = new Map<string, Record<string, unknown>>([
      [
        "viewer-1",
        {
          following: [],
          blockedUsers: [],
          addressBookUsers: [],
          addressBookUserSummaries: [],
          addressBookPhoneNumbers: [],
        },
      ],
      ["u1", { handle: "u1", name: "User One", number: "(650) 704-6433", phoneLast10: null, phoneSearchKeys: null }],
      ["u2", { handle: "u2", name: "User Two", number: "+16102338257", phoneLast10: null, phoneSearchKeys: null }],
      ["u3", { handle: "u3", name: "User Three", number: "6107161794", phoneLast10: null, phoneSearchKeys: null }],
      ["seed-email", { handle: "mail", name: "Email User", email: "friend@example.com" }],
    ]);

    const writes: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const queryByWhere = (field: string, op: string, values: string[]) => {
      const rows = [...docs.entries()]
        .filter(([id]) => id !== "viewer-1")
        .filter(([, data]) => {
          if (op === "in") {
            const fieldValue = data[field];
            return typeof fieldValue === "string" && values.includes(fieldValue);
          }
          if (op === "array-contains-any") {
            const fieldValue = data[field];
            if (!Array.isArray(fieldValue)) return false;
            return fieldValue.some((value) => typeof value === "string" && values.includes(value));
          }
          return false;
        })
        .map(([id, data]) => ({ id, exists: true, data: () => data }));
      return {
        size: rows.length,
        docs: rows,
      };
    };

    const db = {
      collection(name: string) {
        if (name !== "users") throw new Error(`unexpected collection ${name}`);
        return {
          doc(id: string) {
            return {
              id,
              async get() {
                const data = docs.get(id);
                return {
                  id,
                  exists: Boolean(data),
                  data: () => data ?? {},
                };
              },
              async set(patch: Record<string, unknown>) {
                writes.push({ id, patch });
                const prev = docs.get(id) ?? {};
                docs.set(id, { ...prev, ...patch });
              },
            };
          },
          where(field: string, op: string, values: string[]) {
            return {
              select() {
                return this;
              },
              async get() {
                return queryByWhere(field, op, values);
              },
            };
          },
        };
      },
    };

    const repository = new SuggestedFriendsRepository(db as any);
    const result = await repository.syncContacts({
      viewerId: "viewer-1",
      contacts: [
        { phoneNumbers: ["6507046433", "6102338257"], emails: [] },
        { phoneNumbers: ["(610) 716-1794"], emails: ["Friend@Example.com"] },
      ],
    });

    expect(result.matchedUsers.map((u) => u.userId)).toEqual(["seed-email", "u1", "u2", "u3"]);
    expect(result.matchedCount).toBe(4);
    expect(result.matchedUsers.some((u) => u.userId === "viewer-1")).toBe(false);
    expect(new Set(result.matchedUsers.map((u) => u.userId)).size).toBe(result.matchedUsers.length);
    expect(result.diagnostics.matchedByLegacyNumberCount).toBeGreaterThanOrEqual(3);
    expect(result.diagnostics.lazyPhoneRepairsQueued).toBeGreaterThanOrEqual(3);
    expect(result.diagnostics.lazyPhoneRepairsSucceeded).toBeGreaterThanOrEqual(3);
    expect(result.diagnostics.matchedByEmailCount).toBeGreaterThanOrEqual(1);
    expect(writes.some((write) => write.id === "viewer-1")).toBe(true);
  });
});
