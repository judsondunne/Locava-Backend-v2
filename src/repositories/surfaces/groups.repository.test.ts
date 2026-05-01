import { describe, expect, it } from "vitest";

type DocMap = Map<string, Record<string, unknown>>;

class FakeDocSnapshot {
  constructor(
    public readonly id: string,
    private readonly value: Record<string, unknown> | undefined,
    public readonly ref: { parent: { parent: { id: string } | null } } | null = null,
  ) {}

  get exists(): boolean {
    return this.value !== undefined;
  }

  data(): Record<string, unknown> | undefined {
    return this.value ? { ...this.value } : undefined;
  }
}

class FakeDocRef {
  constructor(
    public readonly id: string,
    private readonly docs: DocMap,
    private readonly parentGroupId: string | null = null,
  ) {}

  async get(): Promise<FakeDocSnapshot> {
    return new FakeDocSnapshot(
      this.id,
      this.docs.get(this.id),
      this.parentGroupId ? { parent: { parent: { id: this.parentGroupId } } } : null,
    );
  }

  async set(value: Record<string, unknown>, options?: { merge?: boolean }): Promise<void> {
    const current = this.docs.get(this.id) ?? {};
    this.docs.set(this.id, options?.merge ? { ...current, ...value } : { ...value });
  }
}

class FakeCollectionRef {
  constructor(
    private readonly docs: DocMap,
    private readonly parentGroupId: string | null = null,
  ) {}

  doc(id: string): FakeDocRef {
    return new FakeDocRef(id, this.docs, this.parentGroupId);
  }

  limit(_count: number): FakeCollectionRef {
    return this;
  }

  async get(): Promise<{ docs: FakeDocSnapshot[]; size: number }> {
    const docs = [...this.docs.entries()].map(
      ([id, value]) =>
        new FakeDocSnapshot(
          id,
          value,
          this.parentGroupId ? { parent: { parent: { id: this.parentGroupId } } } : null,
        ),
    );
    return { docs, size: docs.length };
  }
}

class FakeBatch {
  private readonly ops: Array<() => void> = [];

  set(ref: FakeDocRef, value: Record<string, unknown>, options?: { merge?: boolean }): void {
    this.ops.push(() => {
      const current = (ref as unknown as { docs: DocMap }).docs.get(ref.id) ?? {};
      (ref as unknown as { docs: DocMap }).docs.set(ref.id, options?.merge ? { ...current, ...value } : { ...value });
    });
  }

  delete(ref: FakeDocRef): void {
    this.ops.push(() => {
      (ref as unknown as { docs: DocMap }).docs.delete(ref.id);
    });
  }

  async commit(): Promise<void> {
    this.ops.forEach((op) => op());
  }
}

async function makeGroupsRepositoryFixture() {
  process.env.FIRESTORE_TEST_MODE = "disabled";
  const { GroupsRepository } = await import("./groups.repository.js");
  const users: DocMap = new Map();
  const groups: DocMap = new Map();
  const chats: DocMap = new Map();
  const membersByGroup = new Map<string, DocMap>();
  const invitationsByGroup = new Map<string, DocMap>();
  const verificationsByGroup = new Map<string, DocMap>();

  const ensure = (bucket: Map<string, DocMap>, key: string): DocMap => {
    let map = bucket.get(key);
    if (!map) {
      map = new Map();
      bucket.set(key, map);
    }
    return map;
  };

  const adapter = {
    requireDb() {
      return {
        batch() {
          return new FakeBatch();
        },
      };
    },
    user(userId: string) {
      return new FakeDocRef(userId, users);
    },
    group(groupId: string) {
      return new FakeDocRef(groupId, groups);
    },
    groupMembers(groupId: string) {
      return new FakeCollectionRef(ensure(membersByGroup, groupId), groupId);
    },
    groupInvitations(groupId: string) {
      return new FakeCollectionRef(ensure(invitationsByGroup, groupId), groupId);
    },
    groupVerifications(groupId: string) {
      return new FakeCollectionRef(ensure(verificationsByGroup, groupId), groupId);
    },
    chat(chatId: string) {
      return new FakeDocRef(chatId, chats);
    },
    membersCollectionGroup() {
      const all = new Map<string, Record<string, unknown>>();
      for (const [groupId, docs] of membersByGroup.entries()) {
        for (const [userId, data] of docs.entries()) {
          all.set(`${groupId}:${userId}`, { ...data, __groupId: groupId, __userId: userId });
        }
      }
      return {
        where(_field: unknown, _op: unknown, value: string) {
          const matching = [...all.entries()]
            .filter(([, row]) => row.__userId === value)
            .map(([key, row]) => {
              const groupId = String(row.__groupId);
              const userId = String(row.__userId);
              return new FakeDocSnapshot(key, row, { parent: { parent: { id: groupId } } });
            });
          return {
            async get() {
              return { docs: matching, size: matching.length };
            },
          };
        },
      };
    },
    groups() {
      return {
        orderBy() {
          return {
            limit() {
              return {
                async get() {
                  const docs = [...groups.entries()].map(([id, value]) => new FakeDocSnapshot(id, value));
                  return { docs, size: docs.length };
                },
              };
            },
          };
        },
        where(_field: string, _op: string, value: string) {
          return {
            limit() {
              return {
                async get() {
                  const docs = [...groups.entries()]
                    .filter(([, row]) => Array.isArray(row.searchPrefixes) && row.searchPrefixes.includes(value))
                    .map(([id, row]) => new FakeDocSnapshot(id, row));
                  return { docs, size: docs.length, empty: docs.length === 0 };
                },
              };
            },
          };
        },
        doc(id?: string) {
          return new FakeDocRef(id ?? "generated-group", groups);
        },
      };
    },
  };

  return {
    repo: new GroupsRepository(adapter as never),
    users,
    groups,
    chats,
    membersByGroup,
    invitationsByGroup,
    verificationsByGroup,
  };
}

describe("groups repository", () => {
  it("joins an open group and persists membership truthfully", async () => {
    const fx = await makeGroupsRepositoryFixture();
    fx.users.set("viewer-1", { name: "Viewer", handle: "viewer", profilePic: "" });
    fx.groups.set("group-1", {
      name: "Hikers",
      slug: "hikers",
      photoUrl: "",
      chatId: "chat-1",
      joinMode: "open",
      isPublic: true,
      memberCount: 1,
      membersPreview: [],
    });

    const result = await fx.repo.join({ viewerId: "viewer-1", groupId: "group-1" });

    expect(result.alreadyJoined).toBe(false);
    expect(result.group.groupId).toBe("group-1");
    expect(fx.membersByGroup.get("group-1")?.has("viewer-1")).toBe(true);
    expect((fx.users.get("viewer-1")?.primaryGroup as { groupId?: string } | undefined)?.groupId).toBe("group-1");
  });

  it("treats already-joined groups idempotently", async () => {
    const fx = await makeGroupsRepositoryFixture();
    fx.users.set("viewer-1", { name: "Viewer", handle: "viewer", profilePic: "" });
    fx.groups.set("group-1", {
      name: "Hikers",
      slug: "hikers",
      photoUrl: "",
      chatId: null,
      joinMode: "open",
      isPublic: true,
      memberCount: 1,
    });
    fx.membersByGroup.set("group-1", new Map([
      ["viewer-1", { userId: "viewer-1", role: "member", joinedAt: 123 }],
    ]));

    const result = await fx.repo.join({ viewerId: "viewer-1", groupId: "group-1" });

    expect(result.alreadyJoined).toBe(true);
    expect(result.group.role).toBe("member");
  });

  it("fails cleanly for invalid private invites", async () => {
    const fx = await makeGroupsRepositoryFixture();
    fx.users.set("viewer-1", { name: "Viewer", handle: "viewer", profilePic: "" });
    fx.groups.set("group-1", {
      name: "Private Crew",
      slug: "private-crew",
      photoUrl: "",
      chatId: null,
      joinMode: "private",
      isPublic: false,
      memberCount: 1,
    });

    await expect(fx.repo.join({ viewerId: "viewer-1", groupId: "group-1" })).rejects.toThrow(
      "invalid_or_expired_group_invite",
    );
  });

  it("verifies college email then joins successfully", async () => {
    const fx = await makeGroupsRepositoryFixture();
    fx.users.set("viewer-1", { name: "Viewer", handle: "viewer", profilePic: "" });
    fx.groups.set("group-1", {
      name: "Campus Crew",
      slug: "campus-crew",
      photoUrl: "",
      chatId: null,
      joinMode: "open",
      isPublic: true,
      memberCount: 1,
      college: {
        enabled: true,
        eduEmailDomain: "school.edu",
      },
    });

    const result = await fx.repo.verifyCollegeEmail({
      viewerId: "viewer-1",
      groupId: "group-1",
      email: "student@school.edu",
      method: "email_entry",
    });

    expect(result.verifiedEmail).toBe("student@school.edu");
    expect(result.group.groupId).toBe("group-1");
    expect(fx.verificationsByGroup.get("group-1")?.has("viewer-1")).toBe(true);
    expect(fx.membersByGroup.get("group-1")?.has("viewer-1")).toBe(true);
  });
});
