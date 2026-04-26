import { incrementDbOps } from "../../observability/request-context.js";
import { mutationStateRepository } from "./mutation-state.repository.js";
import { SuggestedFriendsService } from "../../services/surfaces/suggested-friends.service.js";

export class UserMutationRepository {
  private readonly suggestedFriendsService = new SuggestedFriendsService();

  async followUser(
    viewerId: string,
    userId: string
  ): Promise<{ userId: string; following: boolean; changed: boolean }> {
    incrementDbOps("queries", 1);
    const result = mutationStateRepository.followUser(viewerId, userId);
    if (result.changed) {
      incrementDbOps("writes", 1);
      await this.suggestedFriendsService.invalidateViewerCaches(viewerId);
    }
    return { userId, following: result.following, changed: result.changed };
  }

  async unfollowUser(
    viewerId: string,
    userId: string
  ): Promise<{ userId: string; following: boolean; changed: boolean }> {
    incrementDbOps("queries", 1);
    const result = mutationStateRepository.unfollowUser(viewerId, userId);
    if (result.changed) {
      incrementDbOps("writes", 1);
      await this.suggestedFriendsService.invalidateViewerCaches(viewerId);
    }
    return { userId, following: result.following, changed: result.changed };
  }
}
