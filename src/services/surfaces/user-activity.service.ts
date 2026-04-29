import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import type { UserActivityRepository } from "../../repositories/surfaces/user-activity.repository.js";

export class UserActivityService {
  constructor(private readonly repository: UserActivityRepository) {}

  async getLastActiveMs(input: { userId: string }) {
    return dedupeInFlight(`users:last-active:${input.userId}`, () =>
      withConcurrencyLimit("users-last-active-repo", 10, () => this.repository.getLastActiveMs(input.userId))
    );
  }
}

