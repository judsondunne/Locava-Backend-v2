import { recordIdempotencyMiss } from "../../observability/request-context.js";
import type { CollectionPrivacy } from "../../repositories/mutations/collection-mutation.repository.js";
import type { CollectionMutationService } from "../../services/mutations/collection-mutation.service.js";

export class CollectionsUpdateOrchestrator {
  constructor(private readonly service: CollectionMutationService) {}

  async run(input: {
    viewerId: string;
    collectionId: string;
    updates: {
      name?: string;
      description?: string;
      privacy?: CollectionPrivacy;
    };
  }) {
    const result = await this.service.updateCollection(input);
    if (result.changed) {
      recordIdempotencyMiss();
    }
    return {
      routeName: "collections.update.post" as const,
      collectionId: result.collection.id,
      updatedFields: result.updatedFields,
      updatedCollection: result.collection
    };
  }
}
