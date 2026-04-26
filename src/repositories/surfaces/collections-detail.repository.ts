import type { FirestoreCollectionRecord } from "../source-of-truth/collections-firestore.adapter.js";
import { CollectionsFirestoreAdapter } from "../source-of-truth/collections-firestore.adapter.js";

export class CollectionsDetailRepository {
  private readonly adapter = new CollectionsFirestoreAdapter();

  async getCollectionById(input: {
    viewerId: string;
    collectionId: string;
  }): Promise<FirestoreCollectionRecord | null> {
    return this.adapter.getCollection(input);
  }
}
