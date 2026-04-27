import { FieldValue } from "firebase-admin/firestore";
import { incrementDbOps } from "../../observability/request-context.js";
import { CollectionsFirestoreAdapter } from "../source-of-truth/collections-firestore.adapter.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { mutationStateRepository } from "./mutation-state.repository.js";

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: unknown; details?: unknown; message?: unknown };
  return (
    row.code === 6 ||
    row.code === "already-exists" ||
    row.code === "ALREADY_EXISTS" ||
    String(row.details ?? row.message ?? "")
      .toLowerCase()
      .includes("already exists")
  );
}

export class PostMutationRepository {
  private readonly collectionsAdapter = new CollectionsFirestoreAdapter();

  async likePost(
    viewerId: string,
    postId: string
  ): Promise<{ postId: string; liked: boolean; changed: boolean }> {
    const db = getFirestoreSourceClient();
    if (!db) {
      incrementDbOps("queries", 1);
      const result = mutationStateRepository.likePost(viewerId, postId);
      if (result.changed) {
        incrementDbOps("writes", 1);
      }
      return { postId, liked: result.liked, changed: result.changed };
    }

    const postRef = db.collection("posts").doc(postId);
    const likeRef = postRef.collection("likes").doc(viewerId);
    const now = new Date();
    const viewerDoc = await db.collection("users").doc(viewerId).get();
    incrementDbOps("reads", viewerDoc.exists ? 1 : 0);
    const viewerData = (viewerDoc.data() ?? {}) as Record<string, unknown>;
    const userHandle = typeof viewerData.handle === "string" ? viewerData.handle : undefined;
    const userName =
      typeof viewerData.name === "string"
        ? viewerData.name
        : typeof viewerData.displayName === "string"
          ? viewerData.displayName
          : undefined;
    const userPic =
      typeof viewerData.pic === "string"
        ? viewerData.pic
        : typeof viewerData.profilePic === "string"
          ? viewerData.profilePic
          : typeof viewerData.profilePicture === "string"
            ? viewerData.profilePicture
            : typeof viewerData.photo === "string"
              ? viewerData.photo
              : undefined;
    const batch = db.batch();
    batch.create(likeRef, {
      userId: viewerId,
      userHandle: userHandle ?? null,
      userName: userName ?? null,
      userPic: userPic ?? null,
      createdAt: now,
      updatedAt: now
    });
    batch.update(
      postRef,
      {
        likeCount: FieldValue.increment(1),
        likesCount: FieldValue.increment(1),
        updatedAt: now,
        lastUpdated: now
      }
    );
    incrementDbOps("writes", 2);
    try {
      await batch.commit();
      mutationStateRepository.likePost(viewerId, postId);
      return { postId, liked: true, changed: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAlreadyExistsError(error)) {
        mutationStateRepository.likePost(viewerId, postId);
        return { postId, liked: true, changed: false };
      }
      if (message.includes("NOT_FOUND")) {
        throw new Error("post_not_found");
      }
      throw error;
    }
  }

  async unlikePost(
    viewerId: string,
    postId: string
  ): Promise<{ postId: string; liked: boolean; changed: boolean }> {
    const db = getFirestoreSourceClient();
    if (!db) {
      incrementDbOps("queries", 1);
      const result = mutationStateRepository.unlikePost(viewerId, postId);
      if (result.changed) {
        incrementDbOps("writes", 1);
      }
      return { postId, liked: result.liked, changed: result.changed };
    }

    const postRef = db.collection("posts").doc(postId);
    const likeRef = postRef.collection("likes").doc(viewerId);
    const knownLiked = mutationStateRepository.hasViewerLikedPost(viewerId, postId);
    if (!knownLiked) {
      const likeDoc = await likeRef.get();
      incrementDbOps("reads", likeDoc.exists ? 1 : 0);
      if (!likeDoc.exists) {
        return { postId, liked: false, changed: false };
      }
    }

    const now = new Date();
    const batch = db.batch();
    batch.delete(likeRef);
    batch.set(
      postRef,
      {
        likeCount: FieldValue.increment(-1),
        likesCount: FieldValue.increment(-1),
        updatedAt: now,
        lastUpdated: now
      },
      { merge: true }
    );
    incrementDbOps("writes", 2);
    await batch.commit();
    mutationStateRepository.unlikePost(viewerId, postId);
    return { postId, liked: false, changed: true };
  }

  async savePost(viewerId: string, postId: string): Promise<{ postId: string; saved: boolean; changed: boolean }> {
    const result = await this.collectionsAdapter.savePostToDefaultCollection({ viewerId, postId });
    if (result.changed) {
      mutationStateRepository.savePost(viewerId, postId);
    } else {
      mutationStateRepository.savePost(viewerId, postId);
    }
    return { postId, saved: true, changed: result.changed };
  }

  async unsavePost(viewerId: string, postId: string): Promise<{ postId: string; saved: boolean; changed: boolean }> {
    const result = await this.collectionsAdapter.unsavePostFromDefaultCollection({ viewerId, postId });
    if (result.changed) {
      mutationStateRepository.unsavePost(viewerId, postId);
    } else {
      mutationStateRepository.unsavePost(viewerId, postId);
    }
    return { postId, saved: false, changed: result.changed };
  }
}
