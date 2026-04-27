import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { entityCacheKeys, getOrSetEntityCache } from "../../cache/entity-cache.js";
import type { ProfilePostDetailRepository } from "../../repositories/surfaces/profile-post-detail.repository.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { recordEntityConstructed } from "../../observability/request-context.js";

export class ProfilePostDetailService {
  constructor(private readonly repository: ProfilePostDetailRepository) {}

  async loadPostDetail(userId: string, postId: string, viewerId: string) {
    return dedupeInFlight(`profile-post-detail:${userId}:${postId}:${viewerId}`, () =>
      getOrSetEntityCache(
        entityCacheKeys.postDetail(postId),
        12_000,
        () =>
          withConcurrencyLimit("profile-post-detail-repo", 6, async () => {
            const detail = await this.repository.getPostDetail(userId, postId, viewerId);
            recordEntityConstructed("PostDetail");
            void Promise.all([
              getOrSetEntityCache(entityCacheKeys.userSummary(detail.author.userId), 25_000, async () => {
                recordEntityConstructed("AuthorSummary");
                return {
                  userId: detail.author.userId,
                  handle: detail.author.handle,
                  name: detail.author.name,
                  pic: detail.author.profilePic
                };
              }),
              getOrSetEntityCache(entityCacheKeys.postSocial(detail.postId), 15_000, async () => {
                recordEntityConstructed("SocialSummary");
                return {
                  likeCount: detail.social.likeCount,
                  commentCount: detail.social.commentCount
                };
              }),
              getOrSetEntityCache(entityCacheKeys.viewerPostState(viewerId, detail.postId), 10_000, async () => {
                recordEntityConstructed("ViewerPostState");
                return {
                  liked: detail.social.viewerHasLiked,
                  saved: false
                };
              })
            ]).catch(() => undefined);
            return detail;
          })
      )
    );
  }

  async loadCommentsPreview(postId: string, slowMs: number) {
    return dedupeInFlight(`profile-post-comments-preview:${postId}:${slowMs}`, () =>
      withConcurrencyLimit("profile-post-comments-repo", 3, () =>
        this.repository.getCommentsPreview(postId, slowMs)
      )
    );
  }
}
