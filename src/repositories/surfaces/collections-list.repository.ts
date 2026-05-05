import type { FirestoreCollectionRecord } from "../source-of-truth/collections-firestore.adapter.js";
import {
  CollectionsFirestoreAdapter,
  isExcludedFromHandCuratedCollectionsList,
} from "../source-of-truth/collections-firestore.adapter.js";

export class CollectionsListRepository {
  private readonly adapter = new CollectionsFirestoreAdapter();

  async listCollections(input: {
    viewerId: string;
    limit: number;
  }): Promise<{ items: FirestoreCollectionRecord[]; hasMore: boolean; nextCursor: string | null }> {
    // "Saved" is an internal default used for save-state/membership semantics.
    // It should not appear as a user-visible default collection in list surfaces.
    const hiddenDefaultSavedId = `saved-${input.viewerId}`;
    const items = (await this.adapter.listViewerCollections(input)).filter(
      (row) => row.id !== hiddenDefaultSavedId && !isExcludedFromHandCuratedCollectionsList(row),
    );
    return {
      items,
      hasMore: items.length >= input.limit,
      nextCursor: null,
    };
  }
}
