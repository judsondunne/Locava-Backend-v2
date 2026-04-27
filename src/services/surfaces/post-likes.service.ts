import type { PostLikesRepository } from "../../repositories/surfaces/post-likes.repository.js";

export class PostLikesService {
  constructor(private readonly repository: PostLikesRepository) {}

  async listPostLikes(postId: string, limit: number) {
    return this.repository.listLikesByPostId({ postId, limit });
  }
}

