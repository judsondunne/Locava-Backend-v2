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
    const userRef = db.collection("users").doc(viewerId);
    const likedMetaRef = userRef.collection("likedPostsMeta").doc(postId);
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
    batch.set(
      userRef,
      {
        likedPosts: FieldValue.arrayUnion(postId),
        updatedAt: now
      },
      { merge: true }
    );
    batch.set(
      likedMetaRef,
      {
        postId,
        userId: viewerId,
        likedAt: now,
        createdAt: now,
        updatedAt: now
      },
      { merge: true }
    );
    incrementDbOps("writes", 4);
    try {
      await batch.commit();
      mutationStateRepository.likePost(viewerId, postId);
      return { postId, liked: true, changed: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAlreadyExistsError(error)) {
        await Promise.all([
          userRef.set(
            {
              likedPosts: FieldValue.arrayUnion(postId),
              updatedAt: now
            },
            { merge: true }
          ),
          likedMetaRef.set(
            {
              postId,
              userId: viewerId,
              likedAt: now,
              updatedAt: now
            },
            { merge: true }
          )
        ]).catch(() => undefined);
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
    const userRef = db.collection("users").doc(viewerId);
    const likedMetaRef = userRef.collection("likedPostsMeta").doc(postId);
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
    batch.set(
      userRef,
      {
        likedPosts: FieldValue.arrayRemove(postId),
        updatedAt: now
      },
      { merge: true }
    );
    batch.delete(likedMetaRef);
    incrementDbOps("writes", 4);
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

  async deletePost(
    viewerId: string,
    postId: string
  ): Promise<{ postId: string; deleted: boolean; changed: boolean }> {
    const hardDeleteUsed = true;
    const db = getFirestoreSourceClient();
    if (!db) {
      incrementDbOps("queries", 1);
      const state = mutationStateRepository.deletePost(postId);
      if (state.changed) {
        incrementDbOps("writes", 1);
      }
      try {
        console.log(
          JSON.stringify({
            event: "POST_DELETE_REPOSITORY_RESULT",
            postId,
            callerSurface: "backend_v2_posts_delete_route",
            hardDeleteUsed,
            success: true,
            fallbackMode: "mutation_state_only",
            changed: state.changed,
            ts: Date.now()
          })
        );
      } catch {}
      return { postId, deleted: true, changed: state.changed };
    }

    const postRef = db.collection("posts").doc(postId);
    const snap = await postRef.get();
    incrementDbOps("reads", snap.exists ? 1 : 0);
    if (!snap.exists) {
      throw new Error("post_not_found");
    }
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const authorIdRaw = data.userId ?? data.authorId ?? data.ownerId ?? null;
    const authorId = typeof authorIdRaw === "string" ? authorIdRaw : "";
    if (authorId && authorId !== viewerId) {
      throw new Error("forbidden");
    }
    if (Boolean(data.deleted) || Boolean(data.isDeleted)) {
      // Document may still exist from prior soft-delete path; hard-delete it now.
      await postRef.delete();
      incrementDbOps("writes", 1);
      mutationStateRepository.deletePost(postId);
      try {
        console.log(
          JSON.stringify({
            event: "POST_DELETE_REPOSITORY_RESULT",
            postId,
            callerSurface: "backend_v2_posts_delete_route",
            hardDeleteUsed,
            success: true,
            fallbackMode: "firestore",
            changed: false,
            ts: Date.now()
          })
        );
      } catch {}
      return { postId, deleted: true, changed: false };
    }
    await postRef.delete();
    incrementDbOps("writes", 1);
    mutationStateRepository.deletePost(postId);
    try {
      console.log(
        JSON.stringify({
          event: "POST_DELETE_REPOSITORY_RESULT",
          postId,
          callerSurface: "backend_v2_posts_delete_route",
          hardDeleteUsed,
          success: true,
          fallbackMode: "firestore",
          changed: true,
          ts: Date.now()
        })
      );
    } catch {}
    return { postId, deleted: true, changed: true };
  }
}
