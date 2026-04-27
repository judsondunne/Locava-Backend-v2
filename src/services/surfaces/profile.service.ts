import type { ProfileRepository } from "../../repositories/surfaces/profile.repository.js";
import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { entityCacheKeys, getOrSetEntityCache } from "../../cache/entity-cache.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { recordEntityConstructed } from "../../observability/request-context.js";

export class ProfileService {
  constructor(private readonly repository: ProfileRepository) {}

  private warmSharedCardCache(item: {
    postId: string;
    thumbUrl: string;
    mediaType: "image" | "video";
    aspectRatio?: number;
    updatedAtMs: number;
  }): void {
    void getOrSetEntityCache(entityCacheKeys.postCard(item.postId), 20_000, async () => {
      recordEntityConstructed("PostCardSummary");
      return this.profileGridItemToSharedCard(item);
    }).catch(() => undefined);
  }

  private profileGridItemToSharedCard(item: {
    postId: string;
    thumbUrl: string;
    mediaType: "image" | "video";
    aspectRatio?: number;
    updatedAtMs: number;
  }) {
    const inferredUserId = item.postId.split("-post-")[0] ?? "unknown-user";
    return {
      postId: item.postId,
      rankToken: `profile-rank-${item.postId}`,
      author: {
        userId: inferredUserId,
        handle: `user_${inferredUserId.slice(0, 8)}`,
        name: null,
        pic: null
      },
      captionPreview: null,
      media: {
        type: item.mediaType,
        posterUrl: item.thumbUrl,
        aspectRatio: item.aspectRatio ?? 9 / 16,
        startupHint: item.mediaType === "video" ? ("poster_then_preview" as const) : ("poster_only" as const)
      },
      social: {
        likeCount: 0,
        commentCount: 0
      },
      viewer: {
        liked: false,
        saved: false
      },
      updatedAtMs: item.updatedAtMs
    };
  }

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
      const preview = await this.repository.getGridPreview(userId, limit);
      preview.items.forEach((item) => this.warmSharedCardCache(item));
      return preview;
    });
  }

  async loadBadgeSummary(userId: string, slowMs: number) {
    return dedupeInFlight(`profile-badge:${userId}:${slowMs}`, () => this.repository.getProfileBadgeSummary(userId, slowMs));
  }

  async loadGridPage(userId: string, cursor: string | null, limit: number) {
    return dedupeInFlight(`profile-grid-page:${userId}:${cursor ?? "start"}:${limit}`, () =>
      withConcurrencyLimit("profile-grid-page-repo", 4, () =>
        this.repository.getGridPage({ userId, cursor, limit }).then(async (page) => {
          page.items.forEach((item) => this.warmSharedCardCache(item));
          return page;
        })
      )
    );
  }
}
