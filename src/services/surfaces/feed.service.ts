import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { entityCacheKeys, getOrSetEntityCache } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { getFollowingFeedCacheGeneration } from "../../lib/feed/following-feed-cache-generation.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { recordEntityCacheHit, recordEntityCacheMiss, recordEntityConstructed } from "../../observability/request-context.js";
import type { FeedRepository } from "../../repositories/surfaces/feed.repository.js";
import type { FeedBootstrapCandidateRecord } from "../../repositories/surfaces/feed.repository.js";
import type { FeedDetailRecord } from "../../repositories/surfaces/feed.repository.js";
import type { FeedQueryContext } from "../../repositories/surfaces/feed.repository.js";

export class FeedService {
  constructor(private readonly repository: FeedRepository) {}

  async primePostCardSummaryCache(cards: FeedBootstrapCandidateRecord[], ttlMs = 20_000): Promise<void> {
    const unique = new Map<string, FeedBootstrapCandidateRecord>();
    for (const card of cards) {
      const postId = card.postId.trim();
      if (!postId || unique.has(postId)) continue;
      unique.set(postId, card);
    }
    await Promise.all(
      [...unique.values()].map((card) => globalCache.set(entityCacheKeys.postCard(card.postId), card, ttlMs))
    );
  }

  async loadBootstrapCandidates(viewerId: string, limit: number, context?: FeedQueryContext) {
    const tab = context?.tab ?? "explore";
    const geo = `${context?.lat ?? "_"}:${context?.lng ?? "_"}:${context?.radiusKm ?? "_"}`;
    const followingGen = tab === "following" ? await getFollowingFeedCacheGeneration(viewerId) : 0;
    return dedupeInFlight(`feed-bootstrap-candidates:${viewerId}:${limit}:${tab}:${geo}:g${followingGen}`, async () => {
      const candidates = await withConcurrencyLimit("feed-bootstrap-candidates-repo", 4, () =>
        this.repository.getBootstrapCandidates(viewerId, limit, context)
      );
      return candidates;
    });
  }

  async loadSessionHints(viewerId: string, slowMs: number) {
    return dedupeInFlight(`feed-bootstrap-session-hints:${viewerId}:${slowMs}`, () =>
      withConcurrencyLimit("feed-bootstrap-session-hints-repo", 2, () =>
        this.repository.getSessionHints(viewerId, slowMs)
      )
    );
  }

  async loadFeedPage(viewerId: string, cursor: string | null, limit: number, context?: FeedQueryContext) {
    const cursorPart = cursor ?? "start";
    const tab = context?.tab ?? "explore";
    const geo = `${context?.lat ?? "_"}:${context?.lng ?? "_"}:${context?.radiusKm ?? "_"}`;
    const followingGen = tab === "following" ? await getFollowingFeedCacheGeneration(viewerId) : 0;
    return dedupeInFlight(`feed-page:${viewerId}:${cursorPart}:${limit}:${tab}:${geo}:g${followingGen}`, () =>
      withConcurrencyLimit("feed-page-repo", 4, async () => {
        return this.repository.getFeedPage(viewerId, cursor, limit, context);
      })
    );
  }

  async loadPostCardSummary(viewerId: string, postId: string) {
    return dedupeInFlight(`feed-post-card-summary:${viewerId}:${postId}`, () =>
      getOrSetEntityCache(
        entityCacheKeys.postCard(postId),
        20_000,
        () =>
          withConcurrencyLimit("feed-post-card-summary-repo", 4, async () => {
            const summary = await this.repository.getPostCardSummary(viewerId, postId);
            recordEntityConstructed("PostCardSummary");
            return summary;
          })
      )
    );
  }

  async loadPostCardSummaryBatch(viewerId: string, postIds: string[]) {
    const ordered = postIds.map((id) => id.trim()).filter(Boolean);
    const unique = [...new Set(ordered)];
    return dedupeInFlight(`feed-post-card-summary-batch:${viewerId}:${unique.join(",")}`, () =>
      withConcurrencyLimit("feed-post-card-summary-batch-repo", 4, async () => {
        const cachedPairs = await Promise.all(
          unique.map(async (postId) => ({
            postId,
            row: await globalCache.get<Awaited<ReturnType<FeedRepository["getPostCardSummary"]>>>(entityCacheKeys.postCard(postId))
          }))
        );
        const cachedById = new Map<string, Awaited<ReturnType<FeedRepository["getPostCardSummary"]>>>();
        const missing: string[] = [];
        for (const { postId, row } of cachedPairs) {
          if (row !== undefined) {
            recordEntityCacheHit();
            cachedById.set(postId, row);
          } else {
            missing.push(postId);
          }
        }
        const loaded = missing.length > 0 ? await this.repository.getPostCardSummariesByPostIds(viewerId, missing) : [];
        const byId = new Map(loaded.map((item) => [item.postId, item] as const));
        const hydratedMissing = await Promise.all(
          missing.map((postId) =>
            getOrSetEntityCache(entityCacheKeys.postCard(postId), 20_000, async () => {
              const summary = byId.get(postId);
              if (!summary) {
                throw new Error("feed_post_not_found");
              }
              recordEntityConstructed("PostCardSummary");
              return summary;
            })
          )
        );
        hydratedMissing.forEach((item) => cachedById.set(item.postId, item));
        return ordered
          .map((postId) => cachedById.get(postId))
          .filter((item): item is NonNullable<typeof item> => item !== undefined);
      })
    );
  }

  async loadPostCardSummaryBatchLightweight(viewerId: string, postIds: string[]) {
    const ordered = postIds.map((id) => id.trim()).filter(Boolean);
    const unique = [...new Set(ordered)];
    return dedupeInFlight(`feed-post-card-summary-batch-light:${viewerId}:${unique.join(",")}`, () =>
      withConcurrencyLimit("feed-post-card-summary-batch-light-repo", 4, async () => {
        const cachedPairs = await Promise.all(
          unique.map(async (postId) => ({
            postId,
            row: await globalCache.get<Awaited<ReturnType<FeedRepository["getPostCardSummary"]>>>(entityCacheKeys.postCard(postId))
          }))
        );
        const cachedById = new Map<string, Awaited<ReturnType<FeedRepository["getPostCardSummary"]>>>();
        const missing: string[] = [];
        for (const { postId, row } of cachedPairs) {
          if (row !== undefined) {
            recordEntityCacheHit();
            cachedById.set(postId, row);
          } else {
            missing.push(postId);
          }
        }
        const loaded =
          missing.length > 0
            ? await this.repository.getPostCardSummariesByPostIds(viewerId, missing, {
                hydrateAuthors: false,
                allowPerIdFallback: false,
              })
            : [];
        for (const item of loaded) {
          void globalCache.set(entityCacheKeys.postCard(item.postId), item, 20_000).catch(() => undefined);
          cachedById.set(item.postId, item);
        }
        return ordered
          .map((postId) => cachedById.get(postId))
          .filter((item): item is NonNullable<typeof item> => item !== undefined);
      })
    );
  }

  async loadAuthorSummary(authorUserId: string, sourcePostId?: string) {
    return dedupeInFlight(`feed-author-summary:${authorUserId}:${sourcePostId ?? "_"}`, () =>
      getOrSetEntityCache(
        entityCacheKeys.userSummary(authorUserId),
        25_000,
        () =>
          withConcurrencyLimit("feed-author-summary-repo", 6, async () => {
            const summary = await this.repository.getAuthorSummary(authorUserId, sourcePostId);
            recordEntityConstructed("AuthorSummary");
            return summary;
          })
      )
    );
  }

  async loadAuthorSummaryBatch(authorUserIds: string[]) {
    const ordered = authorUserIds.map((id) => id.trim()).filter(Boolean);
    const unique = [...new Set(ordered)];
    return dedupeInFlight(`feed-author-summary-batch:${unique.join(",")}`, () =>
      withConcurrencyLimit("feed-author-summary-batch-repo", 6, async () => {
        const loaded = await this.repository.getAuthorSummariesByUserIds(unique);
        const byId = new Map(loaded.map((item) => [item.userId, item] as const));
        const cached = await Promise.all(
          unique.map((userId) =>
            getOrSetEntityCache(entityCacheKeys.userSummary(userId), 25_000, async () => {
              const summary = byId.get(userId);
              if (!summary) {
                throw new Error("author_not_found");
              }
              recordEntityConstructed("AuthorSummary");
              return summary;
            })
          )
        );
        const cachedById = new Map(cached.map((item) => [item.userId, item] as const));
        return ordered
          .map((userId) => cachedById.get(userId))
          .filter((item): item is NonNullable<typeof item> => item !== undefined);
      })
    );
  }

  async loadSocialSummary(postId: string) {
    return dedupeInFlight(`feed-social-summary:${postId}`, () =>
      getOrSetEntityCache(
        entityCacheKeys.postSocial(postId),
        15_000,
        () =>
          withConcurrencyLimit("feed-social-summary-repo", 6, async () => {
            const summary = await this.repository.getSocialSummary(postId);
            recordEntityConstructed("SocialSummary");
            return summary;
          })
      )
    );
  }

  async loadViewerPostState(viewerId: string, postId: string) {
    return dedupeInFlight(`feed-viewer-post-state:${viewerId}:${postId}`, () =>
      getOrSetEntityCache(
        entityCacheKeys.viewerPostState(viewerId, postId),
        10_000,
        () =>
          withConcurrencyLimit("feed-viewer-post-state-repo", 6, async () => {
            const state = await this.repository.getViewerPostState(viewerId, postId);
            recordEntityConstructed("ViewerPostState");
            return state;
          })
      )
    );
  }

  async loadPostDetail(postId: string, viewerId: string) {
    return dedupeInFlight(`feed-post-detail:${viewerId}:${postId}`, () =>
      getOrSetEntityCache(
        entityCacheKeys.postDetailViewer(postId, viewerId),
        12_000,
        () =>
          withConcurrencyLimit("feed-post-detail-repo", 4, async () => {
            const detail = await this.repository.getPostDetail(postId, viewerId);
            recordEntityConstructed("PostDetail");
            return detail;
          })
      )
    );
  }

  async loadPostDetailCachedProjection(
    postId: string,
  ): Promise<
    | {
        source: "post_detail_cache";
        detail: FeedDetailRecord;
      }
    | {
        source: "post_card_cache";
        card: FeedBootstrapCandidateRecord;
      }
    | null
  > {
    const cachedDetail = await globalCache.get<FeedDetailRecord>(entityCacheKeys.postDetail(postId));
    if (cachedDetail) {
      recordEntityCacheHit();
      return { source: "post_detail_cache", detail: cachedDetail };
    }
    const cachedCard = await globalCache.get<FeedBootstrapCandidateRecord>(entityCacheKeys.postCard(postId));
    if (cachedCard) {
      recordEntityCacheHit();
      return { source: "post_card_cache", card: cachedCard };
    }
    recordEntityCacheMiss();
    return null;
  }

  async loadCommentsPreview(postId: string, slowMs: number) {
    return dedupeInFlight(`feed-comments-preview:${postId}:${slowMs}`, () =>
      withConcurrencyLimit("feed-comments-preview-repo", 3, () =>
        this.repository.getCommentsPreview(postId, slowMs)
      )
    );
  }
}
