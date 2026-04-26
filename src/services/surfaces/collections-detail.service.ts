import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import type { CollectionsDetailRepository } from "../../repositories/surfaces/collections-detail.repository.js";

export class CollectionsDetailService {
  constructor(private readonly repository: CollectionsDetailRepository) {}

  async getCollectionById(input: { viewerId: string; collectionId: string }) {
    const dedupeKey = `surface:collections-detail:${input.viewerId}:${input.collectionId}`;
    return dedupeInFlight(dedupeKey, () =>
      withConcurrencyLimit("surface-collections-detail", 12, () =>
        this.repository.getCollectionById(input),
      ),
    );
  }
}
