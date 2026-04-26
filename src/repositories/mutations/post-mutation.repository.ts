import { incrementDbOps } from "../../observability/request-context.js";
import { mutationStateRepository } from "./mutation-state.repository.js";
import { CollectionsFirestoreAdapter } from "../source-of-truth/collections-firestore.adapter.js";

export class PostMutationRepository {
  private readonly collectionsAdapter = new CollectionsFirestoreAdapter();

  async likePost(
    viewerId: string,
    postId: string
  ): Promise<{ postId: string; liked: boolean; changed: boolean }> {
    incrementDbOps("queries", 1);
    const result = mutationStateRepository.likePost(viewerId, postId);
    if (result.changed) {
      incrementDbOps("writes", 1);
    }
    return { postId, liked: result.liked, changed: result.changed };
  }

  async unlikePost(
    viewerId: string,
    postId: string
  ): Promise<{ postId: string; liked: boolean; changed: boolean }> {
    incrementDbOps("queries", 1);
    const result = mutationStateRepository.unlikePost(viewerId, postId);
    if (result.changed) {
      incrementDbOps("writes", 1);
    }
    return { postId, liked: result.liked, changed: result.changed };
  }

  async savePost(viewerId: string, postId: string): Promise<{ postId: string; saved: boolean; changed: boolean }> {
    const result = await this.collectionsAdapter.savePostToDefaultCollection({ viewerId, postId });
    return { postId, saved: true, changed: result.changed };
  }

  async unsavePost(viewerId: string, postId: string): Promise<{ postId: string; saved: boolean; changed: boolean }> {
    const result = await this.collectionsAdapter.unsavePostFromDefaultCollection({ viewerId, postId });
    return { postId, saved: false, changed: result.changed };
  }
}
