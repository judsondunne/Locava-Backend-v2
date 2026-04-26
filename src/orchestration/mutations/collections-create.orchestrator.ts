import { recordIdempotencyMiss } from "../../observability/request-context.js";
import type { CollectionMutationService } from "../../services/mutations/collection-mutation.service.js";

export class CollectionsCreateOrchestrator {
  constructor(private readonly service: CollectionMutationService) {}

  async run(input: {
    viewerId: string;
    name: string;
    description?: string;
    privacy: "public" | "private";
    collaborators: string[];
    items: string[];
    coverUri?: string;
  }) {
    const result = await this.service.createCollection(input);
    if (result.changed) {
      recordIdempotencyMiss();
    }
    return {
      routeName: "collections.create.post" as const,
      collectionId: result.collection.id,
      collection: result.collection
    };
  }
}
