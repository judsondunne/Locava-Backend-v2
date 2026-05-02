import { globalCache } from "../../cache/global-cache.js";
import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { recordCacheHit, recordCacheMiss } from "../../observability/request-context.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import type { ProfileRepository } from "../../repositories/surfaces/profile.repository.js";

export class ProfileService {
  constructor(private readonly repository: ProfileRepository) {}

  async loadHeader(userId: string) {
    return dedupeInFlight(`profile-header:${userId}`, () => this.repository.getProfileHeader(userId));
  }

  async loadRelationship(viewerId: string, userId: string) {
    return dedupeInFlight(`profile-relationship:${viewerId}:${userId}`, () =>
      this.repository.getRelationship(viewerId, userId)
    );
  }

  async loadGridPreview(userId: string, limit: number) {
    return dedupeInFlight(`profile-grid-preview:${userId}:${limit}`, async () => {
      return this.repository.getGridPreview(userId, limit);
    });
  }

  async loadBadgeSummary(userId: string, slowMs: number) {
    return dedupeInFlight(`profile-badge:${userId}:${slowMs}`, () => this.repository.getProfileBadgeSummary(userId, slowMs));
  }

  async loadCollections(input: { viewerId: string; userId: string; cursor: string | null; limit: number }) {
    return dedupeInFlight(
      `profile-collections:${input.viewerId}:${input.userId}:${input.cursor ?? "start"}:${input.limit}`,
      () => withConcurrencyLimit("profile-collections-repo", 3, () => this.repository.getProfileCollections(input))
    );
  }

  async loadAchievements(input: { userId: string; cursor: string | null; limit: number }) {
    return dedupeInFlight(
      `profile-achievements:${input.userId}:${input.cursor ?? "start"}:${input.limit}`,
      () => withConcurrencyLimit("profile-achievements-repo", 3, () => this.repository.getProfileAchievements(input))
    );
  }

  async loadGridPage(userId: string, cursor: string | null, limit: number) {
    return dedupeInFlight(`profile-grid-page:${userId}:${cursor ?? "start"}:${limit}`, () =>
      withConcurrencyLimit("profile-grid-page-repo", 4, () =>
        this.repository.getGridPage({ userId, cursor, limit })
      )
    );
  }

  async loadFollowers(input: { viewerId: string; userId: string; cursor: string | null; limit: number }) {
    const key = `profile-followers:v1:${input.viewerId}:${input.userId}:${input.cursor ?? "start"}:${input.limit}`;
    const cached = await globalCache.get<Awaited<ReturnType<ProfileRepository["getFollowers"]>>>(key);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    return dedupeInFlight(key, () =>
      withConcurrencyLimit("profile-followers-repo", 4, async () => {
        const page = await this.repository.getFollowers(input);
        await globalCache.set(key, page, 20_000);
        return page;
      })
    );
  }

  async loadFollowing(input: { viewerId: string; userId: string; cursor: string | null; limit: number }) {
    const key = `profile-following:v1:${input.viewerId}:${input.userId}:${input.cursor ?? "start"}:${input.limit}`;
    const cached = await globalCache.get<Awaited<ReturnType<ProfileRepository["getFollowing"]>>>(key);
    if (cached) {
      recordCacheHit();
      return cached;
    }
    recordCacheMiss();
    return dedupeInFlight(key, () =>
      withConcurrencyLimit("profile-following-repo", 4, async () => {
        const page = await this.repository.getFollowing(input);
        await globalCache.set(key, page, 20_000);
        return page;
      })
    );
  }

  async loadMyLikedPosts(input: { viewerId: string; cursor: string | null; limit: number }) {
    return dedupeInFlight(
      `profile-liked-posts:${input.viewerId}:${input.cursor ?? "start"}:${input.limit}`,
      () => withConcurrencyLimit("profile-liked-posts-repo", 4, () => this.repository.getMyLikedPosts(input))
    );
  }
}
