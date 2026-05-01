import { describe, expect, it } from "vitest";
import { MixesRepository } from "./mixes.repository.js";

type FakeDoc = { id: string; data: () => Record<string, unknown> };

function buildRows(count: number): Array<Record<string, unknown> & { postId: string }> {
  return Array.from({ length: count }, (_, index) => ({
    postId: `post-${index + 1}`,
    id: `post-${index + 1}`,
    userId: `user-${index + 1}`,
    displayPhotoLink: `https://cdn.locava.test/post-${index + 1}.jpg`,
    time: Date.now() - index * 1_000,
    privacy: "public",
    status: "active",
    assetsReady: true,
  }));
}

function buildFakeDb(input: {
  rows: Array<Record<string, unknown> & { postId: string }>;
  delayMs?: number;
  fail?: boolean;
}): { db: Record<string, unknown>; getCalls: () => number } {
  const docs: FakeDoc[] = input.rows.map((row) => ({
    id: row.postId,
    data: () => row,
  }));
  let calls = 0;

  class FakeQuery {
    constructor(
      private readonly startIndex: number = 0,
      private readonly take: number = docs.length,
    ) {}

    orderBy(): FakeQuery {
      return this;
    }

    limit(nextTake: number): FakeQuery {
      return new FakeQuery(this.startIndex, nextTake);
    }

    startAfter(doc: FakeDoc): FakeQuery {
      const idx = docs.findIndex((entry) => entry.id === doc.id);
      return new FakeQuery(idx >= 0 ? idx + 1 : this.startIndex, this.take);
    }

    async get(): Promise<{ docs: FakeDoc[]; empty: boolean; size: number }> {
      calls += 1;
      if (input.fail) {
        throw new Error("synthetic_refresh_failure");
      }
      await new Promise((resolve) => setTimeout(resolve, input.delayMs ?? 5));
      const slice = docs.slice(this.startIndex, this.startIndex + this.take);
      return {
        docs: slice,
        empty: slice.length === 0,
        size: slice.length,
      };
    }
  }

  return {
    db: {
      collection: () => new FakeQuery(),
    },
    getCalls: () => calls,
  };
}

function buildRepo(db: Record<string, unknown>): MixesRepository {
  const repo = new MixesRepository();
  (repo as any).dbClient = db;
  return repo;
}

describe("mixes repository production pool manager", () => {
  it("collapses parallel cold callers into a single refresh and returns warming JSON-safe snapshots", async () => {
    const fake = buildFakeDb({ rows: buildRows(6), delayMs: 20 });
    const repo = buildRepo(fake.db);

    const responses = await Promise.all([
      repo.listFromPool(),
      repo.listFromPool(),
      repo.listFromPool(),
      repo.listFromPool(),
    ]);

    expect(fake.getCalls()).toBe(1);
    for (const res of responses) {
      expect(Array.isArray(res.posts)).toBe(true);
      expect(res.poolState === "warming" || res.poolState === "failed").toBe(true);
      expect(res.servedEmptyWarming).toBe(true);
    }

    await new Promise((resolve) => setTimeout(resolve, 30));
    const warm = await repo.listFromPool();
    expect(warm.poolState).toBe("warm");
    expect(warm.posts.length).toBe(6);
  });

  it("keeps returning valid empty snapshots after a refresh failure", async () => {
    const fake = buildFakeDb({ rows: [], fail: true });
    const repo = buildRepo(fake.db);

    const cold = await repo.listFromPool();
    expect(Array.isArray(cold.posts)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const failed = await repo.listFromPool();
    expect(Array.isArray(failed.posts)).toBe(true);
    expect(failed.poolState === "failed" || failed.poolState === "warming").toBe(true);
  });
});
