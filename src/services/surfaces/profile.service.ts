import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
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

  async loadGridPage(userId: string, cursor: string | null, limit: number) {
    return dedupeInFlight(`profile-grid-page:${userId}:${cursor ?? "start"}:${limit}`, () =>
      withConcurrencyLimit("profile-grid-page-repo", 4, () =>
        this.repository.getGridPage({ userId, cursor, limit })
      )
    );
  }

  async loadFollowers(input: { viewerId: string; userId: string; cursor: string | null; limit: number }) {
    return dedupeInFlight(
      `profile-followers:${input.viewerId}:${input.userId}:${input.cursor ?? "start"}:${input.limit}`,
      () => withConcurrencyLimit("profile-followers-repo", 4, () => this.repository.getFollowers(input))
    );
  }

  async loadFollowing(input: { viewerId: string; userId: string; cursor: string | null; limit: number }) {
    return dedupeInFlight(
      `profile-following:${input.viewerId}:${input.userId}:${input.cursor ?? "start"}:${input.limit}`,
      () => withConcurrencyLimit("profile-following-repo", 4, () => this.repository.getFollowing(input))
    );
  }

  async loadMyLikedPosts(input: { viewerId: string; cursor: string | null; limit: number }) {
    return dedupeInFlight(
      `profile-liked-posts:${input.viewerId}:${input.cursor ?? "start"}:${input.limit}`,
      () => withConcurrencyLimit("profile-liked-posts-repo", 4, () => this.repository.getMyLikedPosts(input))
    );
  }
}
