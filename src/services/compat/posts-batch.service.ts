import { CompatPostsBatchRepository } from "../../repositories/compat/posts-batch.repository.js";

export class CompatPostsBatchService {
  constructor(private readonly repo = new CompatPostsBatchRepository()) {}

  async getPostsByIds(input: { postIds: string[] }): Promise<Array<Record<string, unknown>>> {
    const rows = await this.repo.loadPostsByIds({ postIds: input.postIds, limit: 60 });
    return rows.map((row) => ({ ...row }));
  }
}

