import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import type { CollectionsListRepository } from "../../repositories/surfaces/collections-list.repository.js";

export class CollectionsListService {
  constructor(private readonly repository: CollectionsListRepository) {}

  async listCollections(input: { viewerId: string; limit: number }) {
    const dedupeKey = `surface:collections-list:${input.viewerId}:${input.limit}`;
    return dedupeInFlight(dedupeKey, () =>
      withConcurrencyLimit("surface-collections-list", 12, () => this.repository.listCollections(input)),
    );
  }
}
