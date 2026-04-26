import type { CollectionsListService } from "../../services/surfaces/collections-list.service.js";

export class CollectionsListOrchestrator {
  constructor(private readonly service: CollectionsListService) {}

  async run(input: { viewerId: string; limit: number }) {
    const result = await this.service.listCollections(input);
    return {
      routeName: "collections.list.get" as const,
      page: {
        limit: input.limit,
        count: result.items.length,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      },
      items: result.items,
    };
  }
}
