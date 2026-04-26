import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { withMutationLock } from "../../lib/mutation-lock.js";
import type { CollectionMutationRepository } from "../../repositories/mutations/collection-mutation.repository.js";
import type { CollectionPrivacy } from "../../repositories/mutations/collection-mutation.repository.js";

export class CollectionMutationService {
  constructor(private readonly repository: CollectionMutationRepository) {}

  async createCollection(input: {
    viewerId: string;
    name: string;
    description?: string;
    privacy: "public" | "private";
    collaborators: string[];
    items: string[];
    coverUri?: string;
  }) {
    const dedupeKey = `mutation:collection-create:${input.viewerId}:${input.name.toLowerCase()}:${input.privacy}`;
    return dedupeInFlight(dedupeKey, () =>
      withConcurrencyLimit("mutation-collection-create", 6, () =>
        withMutationLock(`collection-create:${input.viewerId}`, () => this.repository.createCollection(input))
      )
    );
  }

  async updateCollection(input: {
    viewerId: string;
    collectionId: string;
    updates: {
      name?: string;
      description?: string;
      privacy?: CollectionPrivacy;
    };
  }) {
    const dedupeKey = [
      "mutation:collection-update",
      input.viewerId,
      input.collectionId,
      input.updates.name ?? "",
      input.updates.description ?? "",
      input.updates.privacy ?? ""
    ].join(":");
    return dedupeInFlight(dedupeKey, () =>
      withConcurrencyLimit("mutation-collection-update", 6, () =>
        withMutationLock(`collection-update:${input.collectionId}`, () => this.repository.updateCollection(input))
      )
    );
  }

  async leaveCollection(input: { viewerId: string; collectionId: string }) {
    const dedupeKey = `mutation:collection-leave:${input.viewerId}:${input.collectionId}`;
    return dedupeInFlight(dedupeKey, () =>
      withConcurrencyLimit("mutation-collection-leave", 6, () =>
        withMutationLock(`collection-leave:${input.collectionId}:${input.viewerId}`, () => this.repository.leaveCollection(input))
      )
    );
  }

  async deleteCollection(input: { viewerId: string; collectionId: string }) {
    const dedupeKey = `mutation:collection-delete:${input.viewerId}:${input.collectionId}`;
    return dedupeInFlight(dedupeKey, () =>
      withConcurrencyLimit("mutation-collection-delete", 6, () =>
        withMutationLock(`collection-delete:${input.collectionId}:${input.viewerId}`, () => this.repository.deleteCollection(input))
      )
    );
  }
}
