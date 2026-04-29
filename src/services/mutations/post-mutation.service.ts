import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { withMutationLock } from "../../lib/mutation-lock.js";
import type { PostMutationRepository } from "../../repositories/mutations/post-mutation.repository.js";

export class PostMutationService {
  constructor(private readonly repository: PostMutationRepository) {}

  async likePost(viewerId: string, postId: string) {
    return dedupeInFlight(`mutation:post-like:${viewerId}:${postId}`, () =>
      withConcurrencyLimit("mutation-post-like", 8, () =>
        withMutationLock(`post-mutation:${viewerId}:${postId}`, () => this.repository.likePost(viewerId, postId))
      )
    );
  }

  async unlikePost(viewerId: string, postId: string) {
    return dedupeInFlight(`mutation:post-unlike:${viewerId}:${postId}`, () =>
      withConcurrencyLimit("mutation-post-unlike", 8, () =>
        withMutationLock(`post-mutation:${viewerId}:${postId}`, () => this.repository.unlikePost(viewerId, postId))
      )
    );
  }

  async savePost(viewerId: string, postId: string) {
    return dedupeInFlight(`mutation:post-save:${viewerId}:${postId}`, () =>
      withConcurrencyLimit("mutation-post-save", 8, () =>
        withMutationLock(`post-mutation:${viewerId}:${postId}`, () => this.repository.savePost(viewerId, postId))
      )
    );
  }

  async unsavePost(viewerId: string, postId: string) {
    return dedupeInFlight(`mutation:post-unsave:${viewerId}:${postId}`, () =>
      withConcurrencyLimit("mutation-post-unsave", 8, () =>
        withMutationLock(`post-mutation:${viewerId}:${postId}`, () => this.repository.unsavePost(viewerId, postId))
      )
    );
  }

  async deletePost(viewerId: string, postId: string) {
    return dedupeInFlight(`mutation:post-delete:${viewerId}:${postId}`, () =>
      withConcurrencyLimit("mutation-post-delete", 6, () =>
        withMutationLock(`post-mutation:${viewerId}:${postId}`, () => this.repository.deletePost(viewerId, postId))
      )
    );
  }
}
