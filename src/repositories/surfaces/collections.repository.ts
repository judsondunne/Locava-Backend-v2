import { CollectionsFirestoreAdapter } from "../source-of-truth/collections-firestore.adapter.js";

type SavedPostRow = {
  postId: string;
  savedAtMs: number;
};

export class CollectionsRepositoryError extends Error {
  constructor(public readonly code: "invalid_cursor", message: string) {
    super(message);
  }
}

export class CollectionsRepository {
  private readonly adapter = new CollectionsFirestoreAdapter();

  async listSavedPosts(input: { viewerId: string; cursor: string | null; limit: number }): Promise<{
    cursorIn: string | null;
    items: SavedPostRow[];
    hasMore: boolean;
    nextCursor: string | null;
  }> {
    try {
      await this.adapter.ensureDefaultSavedCollection(input.viewerId);
      const page = await this.adapter.listCollectionPostIds({
        viewerId: input.viewerId,
        collectionId: `saved-${input.viewerId}`,
        cursor: input.cursor,
        limit: input.limit,
      });
      const items = page.items.map((row) => ({
        postId: row.postId,
        savedAtMs: Date.parse(row.addedAt) || Date.now(),
      }));
      return {
        cursorIn: input.cursor,
        items,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      };
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_cursor") {
        throw new CollectionsRepositoryError("invalid_cursor", "Collections saved cursor is invalid.");
      }
      throw error;
    }
  }
}
