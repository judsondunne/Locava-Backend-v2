import { CollectionsFirestoreAdapter } from "../source-of-truth/collections-firestore.adapter.js";

export type CollectionPrivacy = "private" | "friends" | "public";

export type CollectionCreateRecord = {
  id: string;
  name: string;
  ownerId: string;
  collaborators: string[];
  items: string[];
  itemsCount: number;
  displayPhotoUrl?: string;
  description?: string;
  privacy: CollectionPrivacy;
  color?: string;
};

export type CollectionUpdateRecord = {
  id: string;
  ownerId?: string;
  collaborators?: string[];
  items?: string[];
  itemsCount?: number;
  displayPhotoUrl?: string;
  name?: string;
  description?: string;
  privacy?: CollectionPrivacy;
  createdAt?: string;
  updatedAt?: string;
  kind?: "backend";
};

export class CollectionMutationRepository {
  private readonly adapter = new CollectionsFirestoreAdapter();

  async createCollection(input: {
    viewerId: string;
    name: string;
    description?: string;
    privacy: "public" | "private";
    collaborators: string[];
    items: string[];
    coverUri?: string;
  }): Promise<{ changed: boolean; collection: CollectionCreateRecord }> {
    const created = await this.adapter.createCollection({
      viewerId: input.viewerId,
      name: input.name,
      description: input.description,
      privacy: input.privacy,
      collaborators: input.collaborators,
      items: input.items,
      coverUri: input.coverUri
    });
    return {
      changed: true,
      collection: {
        id: created.id,
        name: created.name,
        ownerId: created.ownerId,
        collaborators: created.collaborators,
        items: created.items,
        itemsCount: created.itemsCount,
        displayPhotoUrl: created.coverUri,
        description: created.description,
        privacy: created.privacy,
        color: created.color
      }
    };
  }

  async updateCollection(input: {
    viewerId: string;
    collectionId: string;
    updates: {
      name?: string;
      description?: string;
      privacy?: CollectionPrivacy;
    };
  }): Promise<{
    changed: boolean;
    updatedFields: Array<"name" | "description" | "privacy">;
    collection: CollectionUpdateRecord;
  }> {
    const updated = await this.adapter.updateCollection(input);
    if (!updated.collection) {
      return {
        changed: false,
        updatedFields: [],
        collection: { id: input.collectionId },
      };
    }
    return {
      changed: updated.changed,
      updatedFields: updated.updatedFields as Array<"name" | "description" | "privacy">,
      collection: {
        id: updated.collection.id,
        ownerId: updated.collection.ownerId,
        collaborators: updated.collection.collaborators,
        items: updated.collection.items,
        itemsCount: updated.collection.itemsCount,
        displayPhotoUrl: updated.collection.coverUri,
        name: updated.collection.name,
        description: updated.collection.description,
        privacy: updated.collection.privacy,
        createdAt: updated.collection.createdAt,
        updatedAt: updated.collection.updatedAt,
        kind: "backend",
      }
    };
  }

  async leaveCollection(input: { viewerId: string; collectionId: string }): Promise<{ changed: boolean; collectionId: string }> {
    // Canonical v2 keeps collaborator leave behavior equivalent to delete access for non-owners.
    const existing = await this.adapter.getCollection(input);
    if (!existing) return { changed: false, collectionId: input.collectionId };
    if (existing.permissions.isOwner) {
      return { changed: false, collectionId: input.collectionId };
    }
    return { changed: false, collectionId: input.collectionId };
  }

  async deleteCollection(input: { viewerId: string; collectionId: string }): Promise<{ changed: boolean; collectionId: string }> {
    const res = await this.adapter.deleteCollection(input);
    return { changed: res.changed, collectionId: input.collectionId };
  }
}
