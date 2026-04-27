import { z } from "zod";
import { PostLikesListResponseSchema } from "../../contracts/surfaces/post-likes-list.contract.js";
import type { PostLikesService } from "../../services/surfaces/post-likes.service.js";

type PostLikesListResponse = z.infer<typeof PostLikesListResponseSchema>;

export class PostLikesOrchestrator {
  constructor(private readonly service: PostLikesService) {}

  async run(input: { postId: string; limit: number }): Promise<PostLikesListResponse> {
    const { likes, hasMore } = await this.service.listPostLikes(input.postId, input.limit);
    return {
      routeName: "posts.likes.list" as const,
      postId: input.postId,
      likes,
      hasMore
    };
  }
}

