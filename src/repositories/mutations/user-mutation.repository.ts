import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";
import { bumpFollowingFeedCacheGeneration } from "../../lib/feed/following-feed-cache-generation.js";
import { scheduleBackgroundWork } from "../../lib/background-work.js";
import { incrementDbOps, recordSurfaceTimings } from "../../observability/request-context.js";
import { SuggestedFriendsService } from "../../services/surfaces/suggested-friends.service.js";
import { getFirestoreSourceClient } from "../source-of-truth/firestore-client.js";
import { mutationStateRepository } from "./mutation-state.repository.js";

const COLLECTION_INDEX_FIELDS = ["collectionsV2Index", "collectionsV2IndexedAtMs"] as const;

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

export class UserMutationRepository {
  private readonly suggestedFriendsService = new SuggestedFriendsService();
  private static readonly FOLLOW_GRAPH_BACKGROUND_DELAY_MS = 150;

  private preserveCollectionsIndex(
    cachedUserDoc: Record<string, unknown> | undefined
  ): Record<string, unknown> | null {
    if (!cachedUserDoc || typeof cachedUserDoc !== "object") return null;
    const preserved = Object.fromEntries(
      COLLECTION_INDEX_FIELDS.flatMap((field) =>
        Object.prototype.hasOwnProperty.call(cachedUserDoc, field) ? [[field, cachedUserDoc[field]]] : []
      )
    );
    return Object.keys(preserved).length > 0 ? preserved : null;
  }

  private async clearFollowCaches(viewerId: string, userId: string): Promise<void> {
    const [cachedViewerDoc, cachedTargetDoc] = await Promise.all([
      globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId)),
      globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(userId))
    ]);
    const preservedViewerDoc = this.preserveCollectionsIndex(cachedViewerDoc);
    const preservedTargetDoc = this.preserveCollectionsIndex(cachedTargetDoc);
    await Promise.all([
      preservedViewerDoc
        ? globalCache.set(entityCacheKeys.userFirestoreDoc(viewerId), preservedViewerDoc, 25_000)
        : globalCache.del(entityCacheKeys.userFirestoreDoc(viewerId)),
      preservedTargetDoc
        ? globalCache.set(entityCacheKeys.userFirestoreDoc(userId), preservedTargetDoc, 25_000)
        : globalCache.del(entityCacheKeys.userFirestoreDoc(userId))
    ]);
    void this.suggestedFriendsService.invalidateViewerCaches(viewerId).catch(() => undefined);
    void bumpFollowingFeedCacheGeneration(viewerId).catch(() => undefined);
  }

  private syncFollowMirrorInBackground(input: { viewerId: string; userId: string; following: boolean }): void {
    const db = getFirestoreSourceClient();
    scheduleBackgroundWork(async () => {
      await this.clearFollowCaches(input.viewerId, input.userId);
      if (!db) return;
      const followerRef = db.collection("users").doc(input.userId).collection("followers").doc(input.viewerId);
      if (input.following) {
        const now = new Date();
        await followerRef.set({ userId: input.viewerId, createdAt: now, updatedAt: now }, { merge: true });
      } else {
        await followerRef.delete();
      }
    }, UserMutationRepository.FOLLOW_GRAPH_BACKGROUND_DELAY_MS);
  }

  async followUser(
    viewerId: string,
    userId: string
  ): Promise<{ userId: string; following: boolean; changed: boolean }> {
    const t0 = performance.now();
    const db = getFirestoreSourceClient();
    if (!db) {
      incrementDbOps("queries", 1);
      const result = mutationStateRepository.followUser(viewerId, userId);
      if (result.changed) {
        incrementDbOps("writes", 1);
        this.syncFollowMirrorInBackground({ viewerId, userId, following: true });
        recordSurfaceTimings({
          user_follow_mutation_ms: performance.now() - t0
        });
      }
      return { userId, following: result.following, changed: result.changed };
    }

    const viewerRef = db.collection("users").doc(viewerId);
    const followingRef = viewerRef.collection("following").doc(userId);
    const followerRef = db.collection("users").doc(userId).collection("followers").doc(viewerId);
    // Mutation state is a process-local hint; if it drifts from Firestore we must re-check
    // the source of truth before skipping the write.
    if (mutationStateRepository.isFollowing(viewerId, userId)) {
      const tRead0 = performance.now();
      const followingDoc = await followingRef.get();
      incrementDbOps("reads", 1);
      recordSurfaceTimings({
        user_follow_lookup_ms: performance.now() - tRead0
      });
      if (followingDoc.exists) {
        // Self-heal follower mirror and caches; this prevents "following" edges that never
        // appear in the followers modal/counts due to mirror lag.
        await this.clearFollowCaches(viewerId, userId);
        const now = new Date();
        incrementDbOps("writes", 1);
        await followerRef.set({ userId: viewerId, createdAt: now, updatedAt: now }, { merge: true });
        return { userId, following: true, changed: false };
      }
    }
    const now = new Date();
    const tWrite0 = performance.now();
    let result: { following: boolean; changed: boolean };
    try {
      const batch = db.batch();
      batch.create(followingRef, { userId, createdAt: now, updatedAt: now });
      batch.set(followerRef, { userId: viewerId, createdAt: now, updatedAt: now }, { merge: true });
      incrementDbOps("writes", 2);
      await batch.commit();
      result = { following: true, changed: true };
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        // Still ensure the follower mirror exists (heals older states and multi-process inconsistencies).
        await this.clearFollowCaches(viewerId, userId);
        incrementDbOps("writes", 1);
        await followerRef.set({ userId: viewerId, createdAt: now, updatedAt: now }, { merge: true });
        result = { following: true, changed: false };
      } else {
        throw error;
      }
    }

    if (result.changed) {
      mutationStateRepository.followUser(viewerId, userId);
      await this.clearFollowCaches(viewerId, userId);
      recordSurfaceTimings({
        user_follow_mutation_ms: performance.now() - t0,
        user_follow_create_write_ms: performance.now() - tWrite0
      });
    } else if (result.following) {
      mutationStateRepository.followUser(viewerId, userId);
    }

    return { userId, following: result.following, changed: result.changed };
  }

  async unfollowUser(
    viewerId: string,
    userId: string
  ): Promise<{ userId: string; following: boolean; changed: boolean }> {
    const t0 = performance.now();
    const db = getFirestoreSourceClient();
    if (!db) {
      incrementDbOps("queries", 1);
      const result = mutationStateRepository.unfollowUser(viewerId, userId);
      if (result.changed) {
        incrementDbOps("writes", 1);
        const tInvalidate0 = performance.now();
        await this.suggestedFriendsService.invalidateViewerCaches(viewerId);
        recordSurfaceTimings({
          user_unfollow_mutation_ms: performance.now() - t0,
          user_unfollow_cache_invalidate_ms: performance.now() - tInvalidate0
        });
      }
      return { userId, following: result.following, changed: result.changed };
    }

    const viewerRef = db.collection("users").doc(viewerId);
    const followingRef = viewerRef.collection("following").doc(userId);
    const followerRef = db.collection("users").doc(userId).collection("followers").doc(viewerId);
    const canAssumeExistingFollow = mutationStateRepository.isFollowing(viewerId, userId);
    if (!canAssumeExistingFollow) {
      const tRead0 = performance.now();
      const followingDoc = await followingRef.get();
      incrementDbOps("reads", 1);
      recordSurfaceTimings({
        user_unfollow_lookup_ms: performance.now() - tRead0
      });
      if (!followingDoc.exists) {
        // Self-heal: best-effort delete follower mirror and clear caches so counts/modals converge immediately.
        await this.clearFollowCaches(viewerId, userId);
        incrementDbOps("writes", 1);
        await followerRef.delete().catch(() => undefined);
        return { userId, following: false, changed: false };
      }
    }

    const tWrite0 = performance.now();
    const batch = db.batch();
    batch.delete(followingRef);
    batch.delete(followerRef);
    incrementDbOps("writes", 2);
    await batch.commit();
    const tWrite1 = performance.now();
    const result = { following: false, changed: true };
    mutationStateRepository.unfollowUser(viewerId, userId);

    if (result.changed) {
      await this.clearFollowCaches(viewerId, userId);
    }
    recordSurfaceTimings({
      user_unfollow_mutation_ms: performance.now() - t0,
      user_unfollow_delete_write_ms: tWrite1 - tWrite0
    });

    return { userId, following: result.following, changed: result.changed };
  }
}
