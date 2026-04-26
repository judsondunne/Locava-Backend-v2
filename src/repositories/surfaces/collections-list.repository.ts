import type { FirestoreCollectionRecord } from "../source-of-truth/collections-firestore.adapter.js";
import { CollectionsFirestoreAdapter } from "../source-of-truth/collections-firestore.adapter.js";

export class CollectionsListRepository {
  private readonly adapter = new CollectionsFirestoreAdapter();

  async listCollections(input: {
    viewerId: string;
    limit: number;
  }): Promise<{ items: FirestoreCollectionRecord[]; hasMore: boolean; nextCursor: string | null }> {
    const items = await this.adapter.listViewerCollections(input);
    return {
      items,
      hasMore: items.length >= input.limit,
      nextCursor: null,
    };
  }
}
