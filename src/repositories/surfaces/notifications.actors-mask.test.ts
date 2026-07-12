import { describe, expect, it, vi } from "vitest";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { NotificationsRepository } from "./notifications.repository.js";

describe("NotificationsRepository.loadUsersById field-masked getAll", () => {
  it("uses getAll fieldMask in one chunk for 12 actors (was 2x where-in of 10)", async () => {
    const getAll = vi.fn(async (...args: unknown[]) => {
      const maybeOpts = args[args.length - 1] as { fieldMask?: string[] };
      expect(maybeOpts.fieldMask).toEqual(expect.arrayContaining(["name", "handle", "profilePic"]));
      const refs = args.slice(0, -1) as Array<{ id: string }>;
      return refs.map((ref) => ({
        id: ref.id,
        exists: true,
        data: () => ({ name: `User ${ref.id}`, handle: ref.id, profilePic: null }),
      }));
    });
    const where = vi.fn();

    const repo = new NotificationsRepository();
    const db = {
      collection: () => ({
        doc: (id: string) => ({ id, path: `users/${id}` }),
        where,
      }),
      getAll,
    };
    (repo as unknown as { ensureDb: () => unknown }).ensureDb = () => db;

    const ids = Array.from({ length: 12 }, (_, i) => `actor_${i}`);
    await Promise.all(
      ids.flatMap((id) => [
        globalCache.del(entityCacheKeys.userFirestoreDoc(id)),
        globalCache.del(entityCacheKeys.userSenderFields(id)),
      ]),
    );

    const map = await (repo as unknown as { loadUsersById: (ids: string[]) => Promise<Map<string, unknown>> }).loadUsersById(
      ids,
    );

    expect(getAll).toHaveBeenCalledTimes(1);
    expect(where).not.toHaveBeenCalled();
    expect(map.size).toBe(12);
    // Must not poison full-doc cache with field-masked payloads.
    const poisoned = await globalCache.get(entityCacheKeys.userFirestoreDoc("actor_0"));
    expect(poisoned).toBeUndefined();
    const lean = await globalCache.get(entityCacheKeys.userSenderFields("actor_0"));
    expect(lean).toBeTruthy();
  });
});
