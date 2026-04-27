import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { entityCacheKeys, getOrSetEntityCache } from "../../cache/entity-cache.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { withMutationLock } from "../../lib/mutation-lock.js";
import { recordEntityConstructed } from "../../observability/request-context.js";
import type { CommentsRepository } from "../../repositories/surfaces/comments.repository.js";

export class CommentsService {
  constructor(private readonly repository: CommentsRepository) {}

  async loadCommentsPage(input: { viewerId: string; postId: string; cursor: string | null; limit: number }) {
    const cursorPart = input.cursor ?? "start";
    return dedupeInFlight(`comments:list:${input.viewerId}:${input.postId}:${cursorPart}:${input.limit}`, () =>
      withConcurrencyLimit("comments-list-repo", 8, async () => {
        const page = await this.repository.listTopLevelComments(input);
        const cachedItems = await Promise.all(
          page.items.map((item) =>
            getOrSetEntityCache(`comment:${item.commentId}:summary`, 20_000, async () => {
              recordEntityConstructed("CommentSummary");
              return item;
            })
          )
        );
        await Promise.all(
          cachedItems.map((item) =>
            getOrSetEntityCache(entityCacheKeys.userSummary(item.author.userId), 30_000, async () => {
              recordEntityConstructed("AuthorSummary");
              return item.author;
            })
          )
        );
        return {
          ...page,
          items: cachedItems
        };
      })
    );
  }

  async createComment(input: {
    viewerId: string;
    postId: string;
    text: string;
    replyingTo: string | null;
    clientMutationKey: string | null;
  }) {
    return withConcurrencyLimit("comments-create-repo", 8, () =>
      withMutationLock(`comments-create:${input.viewerId}:${input.postId}`, () => this.repository.createComment(input))
    );
  }

  async deleteComment(input: { viewerId: string; commentId: string }) {
    return dedupeInFlight(`comments:delete:${input.viewerId}:${input.commentId}`, () =>
      withConcurrencyLimit("comments-delete-repo", 8, () =>
        withMutationLock(`comments-delete:${input.viewerId}:${input.commentId}`, () =>
          this.repository.deleteComment(input)
        )
      )
    );
  }

  async likeComment(input: { viewerId: string; commentId: string }) {
    return dedupeInFlight(`comments:like:${input.viewerId}:${input.commentId}`, () =>
      withConcurrencyLimit("comments-like-repo", 8, () =>
        withMutationLock(`comments-like:${input.viewerId}:${input.commentId}`, () =>
          this.repository.likeComment(input)
        )
      )
    );
  }

  async unlikeComment(input: { viewerId: string; commentId: string }) {
    return dedupeInFlight(`comments:unlike:${input.viewerId}:${input.commentId}`, () =>
      withConcurrencyLimit("comments-unlike-repo", 8, () =>
        withMutationLock(`comments-unlike:${input.viewerId}:${input.commentId}`, () =>
          this.repository.unlikeComment(input)
        )
      )
    );
  }
}
