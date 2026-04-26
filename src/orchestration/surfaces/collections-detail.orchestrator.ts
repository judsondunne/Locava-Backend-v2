import type { CollectionsDetailService } from "../../services/surfaces/collections-detail.service.js";

export class CollectionsDetailOrchestrator {
  constructor(private readonly service: CollectionsDetailService) {}

  async run(input: { viewerId: string; collectionId: string }) {
    const item = await this.service.getCollectionById(input);
    if (!item) return null;
    return {
      routeName: "collections.detail.get" as const,
      item,
    };
  }
}
