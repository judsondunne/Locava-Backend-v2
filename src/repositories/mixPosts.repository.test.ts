import { describe, expect, it } from "vitest";
import { ACTIVITY_MIX_POOL_CAP, RECENT_POSTS_PAGE_OVERFETCH_CAP, RECENT_POSTS_PAGE_OVERFETCH_CHAINS } from "../constants/firestore-read-budgets.js";
import { MixPostsRepository } from "./mixPosts.repository.js";

type FakeDoc = { id: string; data: () => Record<string, unknown> };

function buildVisibleRow(index: number, overrides: Record<string, unknown> = {}) {
  return {
    postId: `post-${index}`,
    id: `post-${index}`,
    userId: `user-${index}`,
    time: Date.now() - index * 1_000,
    privacy: "public",
    assetsReady: true,
    ...overrides,
  };
}

function buildFakeDb(rows: Array<Record<string, unknown> & { postId: string }>) {
  const docs: FakeDoc[] = rows.map((row) => ({
    id: row.postId,
    data: () => row,
  }));
  let getCalls = 0;

  class FakeQuery {
    constructor(
      private readonly startIndex = 0,
      private readonly take = docs.length,
      private readonly startAfterKey: string | null = null,
    ) {}

    orderBy(field: string): FakeQuery {
      void field;
      return this;
    }

    limit(nextTake: number): FakeQuery {
      return new FakeQuery(this.startIndex, nextTake, this.startAfterKey);
    }

    startAfter(...values: unknown[]): FakeQuery {
      const id = String(values[1] ?? "");
      const idx = docs.findIndex((entry) => entry.id === id);
      return new FakeQuery(idx >= 0 ? idx + 1 : this.startIndex, this.take, id);
    }

    select(): FakeQuery {
      return this;
    }

    async get(): Promise<{ docs: FakeDoc[]; empty: boolean; size: number }> {
      getCalls += 1;
      let start = this.startIndex;
      if (this.startAfterKey) {
        const idx = docs.findIndex((entry) => entry.id === this.startAfterKey);
        start = idx >= 0 ? idx + 1 : start;
      }
      const slice = docs.slice(start, start + this.take);
      return { docs: slice, empty: slice.length === 0, size: slice.length };
    }
  }

  return {
    db: { collection: () => new FakeQuery() },
    getCalls: () => getCalls,
  };
}

function buildRepo(db: Record<string, unknown>): MixPostsRepository {
  const repo = new MixPostsRepository();
  (repo as any).db = db;
  return repo;
}

describe("MixPostsRepository.pageRecent", () => {
  it("uses Firestore cursors instead of re-fetching a 600-doc pool each page", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => buildVisibleRow(i + 1));
    const fake = buildFakeDb(rows);
    const repo = buildRepo(fake.db);

    const first = await repo.pageRecent({ limit: 6, cursor: null });
    expect(first.items).toHaveLength(6);
    expect(first.hasMore).toBe(true);
    expect(first.reads).toBeGreaterThan(0);
    expect(fake.getCalls()).toBe(1);

    const second = await repo.pageRecent({
      limit: 6,
      cursor: first.nextCursor,
    });
    expect(second.items).toHaveLength(6);
    expect(fake.getCalls()).toBe(2);
    expect(second.items[0]?.postId).not.toBe(first.items[0]?.postId);
  });

  it("caps chained overfetch queries", async () => {
    const rows = Array.from({ length: 200 }, (_, i) =>
      buildVisibleRow(i + 1, { privacy: i % 3 === 0 ? "private" : "public" }),
    );
    const fake = buildFakeDb(rows);
    const repo = buildRepo(fake.db);

    const page = await repo.pageRecent({ limit: 12, cursor: null });
    expect(page.items.length).toBeLessThanOrEqual(12);
    expect(fake.getCalls()).toBeLessThanOrEqual(3);
    expect(page.reads).toBeLessThanOrEqual(RECENT_POSTS_PAGE_OVERFETCH_CAP * RECENT_POSTS_PAGE_OVERFETCH_CHAINS);
  });
});

describe("MixPostsRepository.pageByActivityAliases", () => {
  it("requests at most the activity pool cap from Firestore", async () => {
    let requestedLimit = 0;
    const rows = Array.from({ length: 90 }, (_, i) => ({
      ...buildVisibleRow(i + 1),
      activities: ["hiking"],
    }));
    const docs: FakeDoc[] = rows.map((row) => ({ id: row.postId, data: () => row }));

    class LimitCapturingQuery {
      limit(n: number) {
        requestedLimit = n;
        return this;
      }
      orderBy() {
        return this;
      }
      where() {
        return this;
      }
      select() {
        return this;
      }
      async get() {
        return { docs: docs.slice(0, requestedLimit), empty: false, size: requestedLimit };
      }
    }

    const repo = buildRepo({ collection: () => new LimitCapturingQuery() });
    await repo.pageByActivityAliases({ aliases: ["hiking"], limit: 12, cursor: null });
    expect(requestedLimit).toBeLessThanOrEqual(ACTIVITY_MIX_POOL_CAP);
  });
});
