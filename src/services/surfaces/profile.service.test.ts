import { describe, expect, it, beforeEach, vi } from "vitest";
import { ProfileService } from "./profile.service.js";
import type { ProfileConnectionsPage, ProfileRepository } from "../../repositories/surfaces/profile.repository.js";
import { resetInFlightDedupeForTests } from "../../cache/in-flight-dedupe.js";
import { clearProcessLocalCacheForTests } from "../../runtime/coherence-provider.js";

const emptyPage: ProfileConnectionsPage = { items: [], totalCount: 0, nextCursor: null };

function repoWithFollowersStubs(): ProfileRepository {
  return {
    getFollowers: vi.fn(async () => ({ ...emptyPage })),
    getFollowing: vi.fn(async () => ({ ...emptyPage })),
  } as unknown as ProfileRepository;
}

describe("ProfileService followers/following cache + in-flight dedupe", () => {
  beforeEach(async () => {
    resetInFlightDedupeForTests();
    await clearProcessLocalCacheForTests();
  });

  it("dedupes concurrent identical follower loads into one repository call", async () => {
    const repo = repoWithFollowersStubs();
    let finish!: (v: typeof emptyPage) => void;
    const barrier = new Promise<typeof emptyPage>((resolve) => {
      finish = resolve;
    });
    vi.mocked(repo.getFollowers).mockReturnValue(barrier as Promise<typeof emptyPage>);

    const svc = new ProfileService(repo);
    const input = { viewerId: "v1", userId: "u1", cursor: null as string | null, limit: 200 };
    const a = svc.loadFollowers(input);
    const b = svc.loadFollowers(input);
    finish({ ...emptyPage });
    await Promise.all([a, b]);
    expect(repo.getFollowers).toHaveBeenCalledTimes(1);
  });

  it("returns cached follower page without a second repository call", async () => {
    const repo = repoWithFollowersStubs();
    const svc = new ProfileService(repo);
    const input = { viewerId: "v1", userId: "u1", cursor: null as string | null, limit: 200 };
    await svc.loadFollowers(input);
    await svc.loadFollowers(input);
    expect(repo.getFollowers).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent identical following loads into one repository call", async () => {
    const repo = repoWithFollowersStubs();
    let finish!: (v: typeof emptyPage) => void;
    const barrier = new Promise<typeof emptyPage>((resolve) => {
      finish = resolve;
    });
    vi.mocked(repo.getFollowing).mockReturnValue(barrier as Promise<typeof emptyPage>);

    const svc = new ProfileService(repo);
    const input = { viewerId: "v1", userId: "u1", cursor: null as string | null, limit: 200 };
    const a = svc.loadFollowing(input);
    const b = svc.loadFollowing(input);
    finish({ ...emptyPage });
    await Promise.all([a, b]);
    expect(repo.getFollowing).toHaveBeenCalledTimes(1);
  });
});
