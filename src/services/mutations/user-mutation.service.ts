import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { withMutationLock } from "../../lib/mutation-lock.js";
import type { UserMutationRepository } from "../../repositories/mutations/user-mutation.repository.js";

export class UserMutationService {
  constructor(private readonly repository: UserMutationRepository) {}

  async followUser(viewerId: string, userId: string) {
    return dedupeInFlight(`mutation:user-follow:${viewerId}:${userId}`, () =>
      withConcurrencyLimit("mutation-user-follow", 8, () =>
        withMutationLock(`user-mutation:${viewerId}:${userId}`, () => this.repository.followUser(viewerId, userId))
      )
    );
  }

  async unfollowUser(viewerId: string, userId: string) {
    return dedupeInFlight(`mutation:user-unfollow:${viewerId}:${userId}`, () =>
      withConcurrencyLimit("mutation-user-unfollow", 8, () =>
        withMutationLock(`user-mutation:${viewerId}:${userId}`, () => this.repository.unfollowUser(viewerId, userId))
      )
    );
  }
}
