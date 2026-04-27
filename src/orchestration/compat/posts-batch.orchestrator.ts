import { CompatPostsBatchService } from "../../services/compat/posts-batch.service.js";

export class CompatPostsBatchOrchestrator {
  constructor(private readonly service = new CompatPostsBatchService()) {}

  async run(input: { postIds: string[] }): Promise<{ success: true; posts: Array<Record<string, unknown>> }> {
    const posts = await this.service.getPostsByIds({ postIds: input.postIds });
    return { success: true, posts };
  }
}

