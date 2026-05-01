import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { globalCache } from "../../cache/global-cache.js";
import { scheduleBackgroundWork } from "../../lib/background-work.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { withMutationLock } from "../../lib/mutation-lock.js";
import { buildPostMediaReadiness, type PostMediaReadiness } from "../../lib/posts/media-readiness.js";
import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { achievementsRepository } from "../../repositories/surfaces/achievements.repository.js";
import { AuthBootstrapFirestoreAdapter } from "../../repositories/source-of-truth/auth-bootstrap-firestore.adapter.js";
import { encodeGeohash } from "../../lib/latlng-geohash.js";
import { buildCityRegionId, buildStateRegionId } from "../../lib/search-query-intent.js";
import { readWasabiConfigFromEnv } from "../storage/wasabi-config.js";
import { buildFinalizedSessionAssetPlan } from "../storage/wasabi-presign.service.js";
import { assemblePostAssetsFromStagedItems } from "../posting/assemblePostAssets.js";
import {
  buildNativePostDocument,
  validateNativePostDocumentForWrite,
  type NativePostGeoBlock,
  type NativePostUserSnapshot
} from "../posting/buildPostDocument.js";
import { PostingAudioService } from "../posting/posting-audio.service.js";
import {
  enqueueVideoProcessingCloudTask,
  triggerVideoProcessingSynchronously
} from "../posting/video-processing-cloud-task.service.js";
import { searchPlacesIndexService } from "../surfaces/search-places-index.service.js";
import { postingAchievementsService } from "./posting-achievements.service.js";
import { legendService } from "../../domains/legends/legend.service.js";
import type { AchievementDelta } from "../../contracts/entities/achievement-entities.contract.js";
import {
  type PostingMediaRecord,
  postingMutationRepository,
  type PostingOperationRecord,
  type UploadSessionRecord
} from "../../repositories/mutations/posting-mutation.repository.js";

type FinalizeStagedItem = {
  index: number;
  assetType: "photo" | "video";
  assetId?: string;
  originalKey?: string;
  originalUrl?: string;
  posterKey?: string;
  posterUrl?: string;
};

function trimAuthorField(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim();
}

/**
 * A truthy cached user doc can still be `{}` or metadata-only, which previously skipped Firestore
 * refresh and left userName / userHandle / userPic empty on native finalize.
 */
function userFirestoreDocHasAuthorDisplay(data: Record<string, unknown> | null | undefined): boolean {
  if (!data || Object.keys(data).length === 0) return false;
  if (trimAuthorField(data.handle).length > 0) return true;
  if (trimAuthorField(data.name).length > 0) return true;
  if (trimAuthorField(data.displayName).length > 0) return true;
  for (const k of ["profilePic", "profilePicSmall", "profilePicLarge", "profilePicture", "photo", "photoURL"] as const) {
    if (trimAuthorField(data[k]).length > 0) return true;
  }
  return false;
}

function buildNativeAuthorSnapshotFromUserDoc(data: Record<string, unknown>, effectiveUserId: string): NativePostUserSnapshot {
  const handle = trimAuthorField(data.handle).replace(/^@+/, "");
  const name = trimAuthorField(data.name) || trimAuthorField(data.displayName) || "";
  let profilePic = "";
  for (const k of ["profilePic", "profilePicSmall", "profilePicLarge", "profilePicture", "photo", "photoURL"] as const) {
    const s = trimAuthorField(data[k]);
    if (s) {
      profilePic = s;
      break;
    }
  }
  return {
    handle: handle || `user_${effectiveUserId.slice(0, 8)}`,
    name: name || "Unknown User",
    profilePic: profilePic || "/default-user.png"
  };
}

export class PostingMutationService {
  private readonly completionTimers = new Map<string, true>();
  private readonly mediaVerificationTimers = new Map<string, true>();
  private readonly achievementProcessingTimers = new Map<string, true>();
  private readonly viewerDocWarmTimers = new Map<string, true>();
  private readonly finalizeSupplementaryWriteTimers = new Map<string, true>();
  private readonly authBootstrapAdapter = new AuthBootstrapFirestoreAdapter();
  private readonly postingAudioService = new PostingAudioService();

  async createUploadSession(input: {
    viewerId: string;
    clientSessionKey: string;
    mediaCountHint: number;
  }): Promise<{ session: UploadSessionRecord; idempotent: boolean }> {
    return dedupeInFlight(`posting:create-session:${input.viewerId}:${input.clientSessionKey}`, async () => {
      const [result] = await Promise.all([
        withConcurrencyLimit("posting-create-session", 12, () =>
          postingMutationRepository.createUploadSession(input)
        ),
        this.ensureViewerIdentityCached(input.viewerId)
      ]);
      return result;
    });
  }

  async finalizePosting(input: {
    viewerId: string;
    sessionId: string;
    stagedSessionId?: string;
    stagedItems?: FinalizeStagedItem[];
    idempotencyKey: string;
    mediaCount: number;
    userId?: string;
    title?: string;
    content?: string;
    activities?: string[];
    lat?: number | string;
    long?: number | string;
    address?: string;
    privacy?: string;
    tags?: Array<Record<string, unknown>>;
    texts?: unknown[];
    recordings?: unknown[];
    displayPhotoBase64?: string;
    videoPostersBase64?: Array<string | null>;
    legendStageId?: string;
    authorizationHeader?: string;
  }): Promise<{
    session: UploadSessionRecord;
    operation: PostingOperationRecord;
    idempotent: boolean;
    canonicalCreated: boolean;
    achievementDelta?: AchievementDelta;
    mediaReadiness?: PostMediaReadiness;
  }> {
    return dedupeInFlight(`posting:finalize:${input.viewerId}:${input.idempotencyKey}`, async () => {
      const debugTimings = process.env.POSTING_FINALIZE_DEBUG_TIMINGS === "1";
      const startedAt = debugTimings ? Date.now() : 0;
      const result = await withConcurrencyLimit("posting-finalize", 8, () =>
        withMutationLock(`posting-finalize:${input.viewerId}:${input.sessionId}`, () =>
          postingMutationRepository.finalizePosting(input)
        )
      );
      if (debugTimings) {
        console.info("[posting.finalize.timing] finalizePostingRepository", { ms: Date.now() - startedAt });
      }
      if (result.idempotent && result.operation.state === "completed" && result.operation.postId) {
        if (this.shouldEnforceFinalizeAssertions()) {
          await this.assertFinalizePollInvariant(input.viewerId, result.operation.postId, result.session.sessionId);
          if (debugTimings) {
            console.info("[posting.finalize.timing] assertFinalizePollInvariant:idempotent", { ms: Date.now() - startedAt });
          }
        }
        this.scheduleCompletionInvalidation(input.viewerId, result.operation.operationId);
        this.scheduleLegendsCommit({
          stageId: input.legendStageId,
          postId: result.operation.postId,
          userId: (input.userId?.trim() || input.viewerId).trim()
        });
        const mediaReadiness = await this.loadCanonicalPostMediaReadiness(result.operation.postId);
        return {
          ...result,
          canonicalCreated: true,
          achievementDelta: await this.resolveFinalizeAchievementDelta(input, result.operation.postId),
          ...(mediaReadiness ? { mediaReadiness } : {})
        };
      }

      try {
        const postId = await this.publishToLegacyMonolith(input);
        if (debugTimings) {
          console.info("[posting.finalize.timing] publishToLegacyMonolith", { ms: Date.now() - startedAt });
        }
        if (this.shouldEnforceFinalizeAssertions()) {
          await this.assertCanonicalPostExists(postId);
          if (debugTimings) {
            console.info("[posting.finalize.timing] assertCanonicalPostExists", { ms: Date.now() - startedAt });
          }
        }
        const completed = await postingMutationRepository.markOperationCompleted({
          operationId: result.operation.operationId,
          postId
        });
        if (debugTimings) {
          console.info("[posting.finalize.timing] markOperationCompleted", { ms: Date.now() - startedAt });
        }
        if (this.shouldEnforceFinalizeAssertions()) {
          await this.assertFinalizePollInvariant(input.viewerId, postId, result.session.sessionId);
          if (debugTimings) {
            console.info("[posting.finalize.timing] assertFinalizePollInvariant", { ms: Date.now() - startedAt });
          }
        }
        console.info("[posting.finalize] committed canonical post", {
          viewerId: input.viewerId,
          postId,
          sourceOfTruthPath: `posts/${postId}`,
          sessionId: result.session.sessionId,
          stagedSessionId: input.stagedSessionId ?? null,
          idempotencyKey: input.idempotencyKey,
          operationId: completed.operationId
        });
        this.scheduleCompletionInvalidation(input.viewerId, completed.operationId);
        this.scheduleLegendsCommit({
          stageId: input.legendStageId,
          postId,
          userId: (input.userId?.trim() || input.viewerId).trim()
        });
        const mediaReadiness = await this.loadCanonicalPostMediaReadiness(postId);
        return {
          session: result.session,
          operation: completed,
          idempotent: result.idempotent,
          canonicalCreated: true,
          achievementDelta: await this.resolveFinalizeAchievementDelta(input, postId),
          ...(mediaReadiness ? { mediaReadiness } : {})
        };
      } catch (error) {
        await postingMutationRepository.markOperationFailed({
          operationId: result.operation.operationId,
          reason: error instanceof Error ? error.message : "canonical_post_write_failed"
        });
        throw error;
      }
    });
  }

  private async loadCanonicalPostMediaReadiness(postId: string): Promise<PostMediaReadiness | undefined> {
    const db = getFirestoreSourceClient();
    if (!db) return undefined;
    const snap = await db.collection("posts").doc(postId).get();
    if (!snap.exists) return undefined;
    const readiness = buildPostMediaReadiness((snap.data() ?? {}) as Record<string, unknown>);
    console.info("[posting.finalize.media_readiness]", {
      postId,
      ...readiness
    });
    return readiness;
  }

  private scheduleLegendsCommit(input: { stageId?: string; postId: string; userId: string }): void {
    const stageId = input.stageId?.trim();
    if (!input.postId || !input.userId) return;
    scheduleBackgroundWork(async () => {
      try {
        if (stageId) {
          await legendService.commitStagedPostLegend({
            stageId,
            post: { postId: input.postId, userId: input.userId }
          });
          await achievementsRepository.syncDynamicLeaderBadgesForViewer(input.userId);
          return;
        }
        // Fallback: derive scopes from canonical post doc (single bounded read).
        const db = getFirestoreSourceClient();
        if (!db) return;
        const postSnap = await db.collection("posts").doc(input.postId).get();
        if (!postSnap.exists) return;
        const data = postSnap.data() as Record<string, unknown> | undefined;
        const geoData = data?.geoData && typeof data.geoData === "object" ? (data.geoData as Record<string, unknown>) : null;
        const geohash = typeof data?.geohash === "string" ? data.geohash : null;
        const activities = Array.isArray(data?.activities) ? data!.activities.map((v) => String(v ?? "")).filter(Boolean) : [];
        const city =
          typeof data?.city === "string"
            ? data.city
            : geoData && typeof geoData.city === "string"
              ? geoData.city
              : null;
        const state =
          typeof data?.state === "string"
            ? data.state
            : geoData && typeof geoData.state === "string"
              ? geoData.state
              : null;
        const country =
          typeof data?.countryRegionId === "string"
            ? data.countryRegionId
            : geoData && typeof geoData.country === "string"
              ? geoData.country
              : null;
        const region = typeof data?.region === "string" ? data.region : null;
        await legendService.processPostCreated({
          postId: input.postId,
          userId: input.userId,
          geohash,
          activities,
          city,
          state,
          country,
          region
        });
        await achievementsRepository.syncDynamicLeaderBadgesForViewer(input.userId);
      } catch (error) {
        console.warn("[posting.legends] commit failed", {
          postId: input.postId,
          userId: input.userId,
          stageId: stageId ?? null,
          error: error instanceof Error ? error.message : String(error)
        });
        try {
          const db = getFirestoreSourceClient();
          if (!db) return;
          await db.collection("legendPostResults").doc(input.postId).set(
            {
              postId: input.postId,
              userId: input.userId,
              status: "failed",
              errorCode: "legends_commit_failed",
              updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        } catch {
          // ignore
        }
      }
    });
  }

  private async buildFinalizeAchievementDelta(
    input: {
      viewerId: string;
      userId?: string;
      activities?: string[];
      lat?: number | string;
      long?: number | string;
      address?: string;
    },
    postId: string
  ): Promise<AchievementDelta> {
    try {
      return await postingAchievementsService.processPostCreated({
        viewerId: input.viewerId,
        userId: input.userId?.trim() || input.viewerId,
        postId,
        activities: Array.isArray(input.activities) ? input.activities : [],
        lat: input.lat,
        long: input.long,
        address: input.address,
        requestAward: true
      });
    } catch (error) {
      console.warn("[posting.finalize] achievements post-created failed", {
        viewerId: input.viewerId,
        postId,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        xpGained: 0,
        newTotalXP: 0,
        leveledUp: false,
        newLevel: 1,
        tier: "Beginner",
        progressBumps: [],
        weeklyCapture: null,
        newlyUnlockedBadges: [],
        uiEvents: [],
        competitiveBadgeUnlocks: [],
        postSuccessMessage: null,
        deltaError: "ACHIEVEMENTS_UNAVAILABLE"
      };
    }
  }

  private buildPendingFinalizeAchievementDelta(): AchievementDelta {
    return {
      xpGained: 0,
      newTotalXP: 0,
      leveledUp: false,
      newLevel: 1,
      tier: "Beginner",
      progressBumps: [],
      weeklyCapture: null,
      newlyUnlockedBadges: [],
      uiEvents: [],
      competitiveBadgeUnlocks: [],
      postSuccessMessage: null,
      deltaError: "ACHIEVEMENTS_PENDING"
    };
  }

  private async resolveFinalizeAchievementDelta(
    input: {
      viewerId: string;
      userId?: string;
      activities?: string[];
      lat?: number | string;
      long?: number | string;
      address?: string;
    },
    postId: string
  ): Promise<AchievementDelta> {
    if (this.shouldUseSynchronousFinalizeAchievements()) {
      return this.buildFinalizeAchievementDelta(input, postId);
    }
    this.scheduleFinalizeAchievementProcessing(input, postId);
    return this.buildPendingFinalizeAchievementDelta();
  }

  private scheduleFinalizeAchievementProcessing(
    input: {
      viewerId: string;
      userId?: string;
      activities?: string[];
      lat?: number | string;
      long?: number | string;
      address?: string;
    },
    postId: string
  ): void {
    if (this.achievementProcessingTimers.has(postId)) return;
    this.achievementProcessingTimers.set(postId, true);
    scheduleBackgroundWork(async () => {
      this.achievementProcessingTimers.delete(postId);
      await this.buildFinalizeAchievementDelta(input, postId);
    });
  }

  private shouldEnforceFinalizeAssertions(): boolean {
    return process.env.POSTING_FINALIZE_ENFORCE_ASSERTS === "1";
  }

  private shouldUseSynchronousFinalizeAchievements(): boolean {
    if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") return true;
    // Default: award XP in the finalize response so clients show correct toast/onboarding.
    // Set POSTING_FINALIZE_ASYNC_ACHIEVEMENTS=1 to defer awards (lower finalize latency at scale).
    return process.env.POSTING_FINALIZE_ASYNC_ACHIEVEMENTS !== "1";
  }

  private scheduleViewerDocCacheWarm(viewerId: string): void {
    if (this.shouldEnforceFinalizeAssertions()) return;
    if (this.viewerDocWarmTimers.has(viewerId)) return;
    this.viewerDocWarmTimers.set(viewerId, true);
    scheduleBackgroundWork(async () => {
      this.viewerDocWarmTimers.delete(viewerId);
      await this.ensureViewerIdentityCached(viewerId);
    });
  }

  private async ensureViewerIdentityCached(viewerId: string): Promise<void> {
    const cachedSummary =
      (await globalCache.get<{
        handle?: unknown;
        name?: unknown;
        pic?: unknown;
      }>(entityCacheKeys.userSummary(viewerId))) ?? null;
    if (cachedSummary) {
      return;
    }
    const adapterSummary = AuthBootstrapFirestoreAdapter.getCachedViewerSummary(viewerId);
    if (adapterSummary) {
      await globalCache.set(
        entityCacheKeys.userSummary(viewerId),
        {
          userId: viewerId,
          handle: adapterSummary.handle,
          name: adapterSummary.name,
          pic: adapterSummary.pic
        },
        30_000
      );
      return;
    }
    try {
      if (this.authBootstrapAdapter.isEnabled()) {
        await this.authBootstrapAdapter.getViewerBootstrapFields(viewerId);
        return;
      }
    } catch {
      // Fall through to the broader user-doc cache warm.
    }
    await this.ensureViewerDocCached(viewerId);
  }

  private async ensureViewerDocCached(viewerId: string): Promise<Record<string, unknown> | null> {
    const cached = (await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(viewerId))) ?? null;
    if (cached) {
      return cached;
    }
    const db = getFirestoreSourceClient();
    if (!db) {
      return null;
    }
    const snap = await db.collection("users").doc(viewerId).get();
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    await Promise.all([
      globalCache.set(entityCacheKeys.userFirestoreDoc(viewerId), data, 25_000),
      globalCache.set(
        entityCacheKeys.userSummary(viewerId),
        {
          userId: viewerId,
          handle: typeof data.handle === "string" ? data.handle : "",
          name:
            typeof data.name === "string"
              ? data.name
              : typeof data.displayName === "string"
                ? data.displayName
                : "",
          pic:
            typeof data.profilePic === "string"
              ? data.profilePic
              : typeof data.profilePicSmall === "string"
                ? data.profilePicSmall
                : typeof data.photo === "string"
                  ? data.photo
                  : null
        },
        25_000
      )
    ]);
    return data;
  }

  private scheduleFinalizeSupplementaryWrites(input: {
    viewerId: string;
    postId: string;
    now: number;
    nowTs: Timestamp;
  }): void {
    if (this.finalizeSupplementaryWriteTimers.has(input.postId)) return;
    this.finalizeSupplementaryWriteTimers.set(input.postId, true);
    scheduleBackgroundWork(async () => {
      this.finalizeSupplementaryWriteTimers.delete(input.postId);
      const db = getFirestoreSourceClient();
      if (!db) return;
      await db.runTransaction(async (tx) => {
        const userRef = db.collection("users").doc(input.viewerId);
        const userPostRef = db.collection("users").doc(input.viewerId).collection("posts").doc(input.postId);
        const achievementsStateRef = db.collection("users").doc(input.viewerId).collection("achievements").doc("state");
        const existingUserPost = await tx.get(userPostRef);
        if (existingUserPost.exists) return;
        tx.set(
          userRef,
          {
            numPosts: FieldValue.increment(1),
            postCount: FieldValue.increment(1),
            postsCount: FieldValue.increment(1),
            postCountVerifiedValue: FieldValue.increment(1),
            postCountVerifiedAtMs: input.now,
            updatedAt: input.now
          },
          { merge: true }
        );
        tx.set(
          userPostRef,
          {
            postId: input.postId,
            createdAt: input.nowTs,
            time: input.nowTs
          },
          { merge: true }
        );
        tx.set(
          achievementsStateRef,
          {
            totalPosts: FieldValue.increment(1),
            updatedAt: input.now
          },
          { merge: true }
        );
      });
      await Promise.allSettled([
        globalCache.del(entityCacheKeys.userPostCount(input.viewerId)),
        globalCache.del(entityCacheKeys.userFirestoreDoc(input.viewerId))
      ]);
    });
  }

  private async assertFinalizePollInvariant(viewerId: string, postId: string, sessionId: string): Promise<void> {
    const db = getFirestoreSourceClient();
    if (db) {
      const snap = await db.collection("posts").doc(postId).get();
      if (!snap.exists) {
        throw new Error("finalize_poll_invariant_failed_posts_doc_missing");
      }
      return;
    }
    const operation = await postingMutationRepository.getPostingOperationByPostId({
      viewerId,
      postId
    });
    if (!operation || operation.sessionId !== sessionId) {
      throw new Error("finalize_poll_invariant_failed_operation_missing");
    }
  }

  async getPostingOperation(input: { viewerId: string; operationId: string }): Promise<PostingOperationRecord> {
    return dedupeInFlight(`posting:status:${input.viewerId}:${input.operationId}`, async () =>
      this.getPostingOperationWithInvalidation(input.viewerId, input.operationId)
    );
  }

  async cancelPostingOperation(input: { viewerId: string; operationId: string }): Promise<{
    operation: PostingOperationRecord;
    idempotent: boolean;
  }> {
    return dedupeInFlight(`posting:cancel:${input.viewerId}:${input.operationId}`, () =>
      withConcurrencyLimit("posting-cancel", 8, () =>
        withMutationLock(`posting-operation:${input.viewerId}:${input.operationId}`, () =>
          postingMutationRepository.cancelPostingOperation(input)
        )
      )
    );
  }

  async retryPostingOperation(input: { viewerId: string; operationId: string }): Promise<{
    operation: PostingOperationRecord;
    idempotent: boolean;
  }> {
    return dedupeInFlight(`posting:retry:${input.viewerId}:${input.operationId}`, () =>
      withConcurrencyLimit("posting-retry", 8, () =>
        withMutationLock(`posting-operation:${input.viewerId}:${input.operationId}`, () =>
          postingMutationRepository.retryPostingOperation(input)
        )
      )
    );
  }

  async registerMedia(input: {
    viewerId: string;
    sessionId: string;
    assetIndex: number;
    assetType: "photo" | "video";
    clientMediaKey: string | null;
  }): Promise<{ media: PostingMediaRecord; idempotent: boolean }> {
    this.scheduleViewerDocCacheWarm(input.viewerId);
    const dedupeKey = input.clientMediaKey
      ? `posting:media:register:${input.viewerId}:${input.clientMediaKey}`
      : `posting:media:register:${input.viewerId}:${input.sessionId}:${input.assetIndex}`;
    return dedupeInFlight(dedupeKey, () =>
      withConcurrencyLimit("posting-media-register", 10, () =>
        withMutationLock(`posting-media:${input.viewerId}:${input.sessionId}:${input.assetIndex}`, () =>
          postingMutationRepository.registerMedia(input)
        )
      )
    );
  }

  async markMediaUploaded(input: {
    viewerId: string;
    mediaId: string;
    uploadedObjectKey: string | null;
  }): Promise<{ media: PostingMediaRecord; idempotent: boolean }> {
    return dedupeInFlight(`posting:media:uploaded:${input.viewerId}:${input.mediaId}`, async () => {
      return (
      withConcurrencyLimit("posting-media-mark-uploaded", 10, () =>
        withMutationLock(`posting-media:${input.viewerId}:${input.mediaId}`, () =>
          postingMutationRepository.markMediaUploaded(input)
        )
      )
      );
    });
  }

  async getMediaStatus(input: { viewerId: string; mediaId: string }): Promise<PostingMediaRecord> {
    return dedupeInFlight(`posting:media:status:${input.viewerId}:${input.mediaId}`, () =>
      withConcurrencyLimit("posting-media-status", 16, () => postingMutationRepository.getMediaStatus(input))
    );
  }

  private scheduleCompletionInvalidation(viewerId: string, operationId: string): void {
    if (this.completionTimers.has(operationId)) return;
    this.completionTimers.set(operationId, true);
    scheduleBackgroundWork(async () => {
      this.completionTimers.delete(operationId);
      await this.getPostingOperationWithInvalidation(viewerId, operationId);
    }, 1600);
  }

  private scheduleCanonicalMediaVerification(postId: string): void {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if (this.mediaVerificationTimers.has(postId)) return;
    this.mediaVerificationTimers.set(postId, true);
    scheduleBackgroundWork(async () => {
      this.mediaVerificationTimers.delete(postId);
      await this.assertCanonicalMediaPubliclyReadable(postId).catch((error) => {
        console.warn("[posting.finalize] deferred media verification failed", {
          postId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    });
  }

  private async getPostingOperationWithInvalidation(
    viewerId: string,
    operationId: string
  ): Promise<PostingOperationRecord> {
    const operation = await withConcurrencyLimit("posting-status", 20, () =>
      postingMutationRepository.getPostingOperation({ viewerId, operationId })
    );
    if (operation.state === "completed" && operation.completionInvalidatedAtMs == null) {
      await invalidateEntitiesForMutation({
        mutationType: "posting.complete",
        postId: operation.postId,
        viewerId
      });
      return postingMutationRepository.markOperationCompletionInvalidated({ operationId: operation.operationId });
    }
    return operation;
  }

  private async publishToLegacyMonolith(input: {
    viewerId: string;
    sessionId: string;
    stagedSessionId?: string;
    stagedItems?: FinalizeStagedItem[];
    idempotencyKey: string;
    userId?: string;
    title?: string;
    content?: string;
    activities?: string[];
    lat?: number | string;
    long?: number | string;
    address?: string;
    privacy?: string;
    tags?: Array<Record<string, unknown>>;
    texts?: unknown[];
    recordings?: unknown[];
    displayPhotoBase64?: string;
    videoPostersBase64?: Array<string | null>;
    authorizationHeader?: string;
  }): Promise<string> {
    const debugTimings = process.env.POSTING_FINALIZE_DEBUG_TIMINGS === "1";
    const startedAt = debugTimings ? Date.now() : 0;
    if (process.env.NODE_ENV === "test") {
      return this.createCanonicalPostFallbackForTests(input);
    }
    // Security + correctness: the post author is always the authenticated viewer.
    // Never allow client-provided `userId` to change post ownership.
    const viewer = input.viewerId;
    const media = await postingMutationRepository.listSessionMedia({
      viewerId: input.viewerId,
      sessionId: input.sessionId,
    });
    if (debugTimings) {
      console.info("[posting.finalize.timing] listSessionMedia", { ms: Date.now() - startedAt });
    }
    const uploadedMedia = media.filter((item) => item.state === "uploaded" || item.state === "ready");
    if (uploadedMedia.length === 0) {
      throw new Error("publish_missing_uploaded_media");
    }
    const canonicalSessionId = input.stagedSessionId?.trim() || input.sessionId;
    const mediaByIndex = new Map(
      uploadedMedia.map((item) => [item.assetIndex, item] as const)
    );
    const storageCfg = readWasabiConfigFromEnv();
    const manifestSource: FinalizeStagedItem[] =
      Array.isArray(input.stagedItems) && input.stagedItems.length > 0
        ? input.stagedItems
        : uploadedMedia
            .sort((a, b) => a.assetIndex - b.assetIndex)
            .map((item) => ({
              index: item.assetIndex,
              assetType: item.assetType
            }));
    const stagedItems = manifestSource
      .sort((a, b) => a.index - b.index)
      .map((item) => {
        const mediaRow = mediaByIndex.get(item.index);
        const assetType = item.assetType ?? mediaRow?.assetType;
        if (assetType !== "photo" && assetType !== "video") {
          throw new Error(`publish_missing_asset_type_for_index_${item.index}`);
        }
        if (item.originalKey && item.originalUrl) {
          return {
            index: item.index,
            assetType,
            assetId: item.assetId,
            originalKey: item.originalKey,
            originalUrl: item.originalUrl,
            ...(item.posterKey ? { posterKey: item.posterKey } : {}),
            ...(item.posterUrl ? { posterUrl: item.posterUrl } : {})
          };
        }
        if (!storageCfg) {
          throw new Error("object_storage_unavailable");
        }
        const finalized = buildFinalizedSessionAssetPlan(
          storageCfg,
          canonicalSessionId,
          item.index,
          assetType
        );
        return {
          index: item.index,
          assetType,
          assetId: item.assetId ?? finalized.assetId,
          originalKey: finalized.originalKey,
          originalUrl: finalized.originalUrl,
          ...(finalized.posterKey ? { posterKey: finalized.posterKey } : {}),
          ...(finalized.posterUrl ? { posterUrl: finalized.posterUrl } : {})
        };
      });
    void input.authorizationHeader;
    void input.displayPhotoBase64;
    void input.videoPostersBase64;

    const beforeNative = debugTimings ? Date.now() : 0;
    const postId = await this.publishNativeCanonicalPost({
      viewerId: input.viewerId,
      effectiveUserId: viewer,
      sessionId: input.sessionId,
      stagedSessionId: canonicalSessionId,
      idempotencyKey: input.idempotencyKey,
      title: input.title,
      content: input.content,
      activities: Array.isArray(input.activities) ? input.activities : [],
      lat: input.lat,
      long: input.long,
      address: input.address,
      privacy: input.privacy,
      tags: Array.isArray(input.tags) ? input.tags : [],
      texts: Array.isArray(input.texts) ? input.texts : [],
      recordings: Array.isArray(input.recordings) ? input.recordings : [],
      stagedItems
    });
    if (debugTimings) {
      console.info("[posting.finalize.timing] publishNativeCanonicalPost", { ms: Date.now() - beforeNative });
    }
    if (process.env.NODE_ENV !== "test") {
      this.scheduleCanonicalMediaVerification(postId);
    }
    if (debugTimings) {
      console.info("[posting.finalize.timing] native-path-total", { ms: Date.now() - startedAt });
    }
    return postId;
  }

  private resolveFinalizeGeo(lat: number, lng: number, address: string): NativePostGeoBlock {
    const geohash = lat === 0 && lng === 0 ? "" : encodeGeohash(lat, lng, 9);
    const match =
      lat !== 0 || lng !== 0 ? searchPlacesIndexService.reverseLookup(lat, lng) : null;
    if (match) {
      const gLat = match.lat ?? lat;
      const gLng = match.lng ?? lng;
      return {
        cityRegionId: match.cityRegionId,
        stateRegionId: match.stateRegionId,
        countryRegionId: match.countryCode,
        geohash: geohash || encodeGeohash(gLat, gLng, 9),
        geoData: {
          country: "United States",
          state: match.stateName,
          city: match.text
        }
      };
    }
    const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
    const city = parts[0] || "Unknown";
    const state = parts[1] || "Unknown";
    const country = parts[2] || "United States";
    const normalizedCountry = String(country).trim();
    const countryCode = /^[A-Za-z]{2}$/.test(normalizedCountry)
      ? normalizedCountry.toUpperCase()
      : normalizedCountry || "US";
    return {
      cityRegionId: buildCityRegionId(countryCode, state, city),
      stateRegionId: buildStateRegionId(countryCode, state),
      countryRegionId: countryCode,
      geohash,
      geoData: { country, state, city }
    };
  }

  private async publishNativeCanonicalPost(input: {
    viewerId: string;
    effectiveUserId: string;
    sessionId: string;
    stagedSessionId: string;
    idempotencyKey: string;
    title?: string;
    content?: string;
    activities: string[];
    lat?: number | string;
    long?: number | string;
    address?: string;
    privacy?: string;
    tags: Array<Record<string, unknown>>;
    texts: unknown[];
    recordings: unknown[];
    stagedItems: Array<{
      index: number;
      assetType: "photo" | "video";
      assetId?: string;
      originalKey?: string;
      originalUrl?: string;
      posterKey?: string;
      posterUrl?: string;
    }>;
  }): Promise<string> {
    const db = getFirestoreSourceClient();
    if (!db) {
      throw new Error("firestore_unavailable");
    }
    const debugTimings = process.env.POSTING_FINALIZE_DEBUG_TIMINGS === "1";
    const startedAt = debugTimings ? Date.now() : 0;

    let userData = (await globalCache.get<Record<string, unknown>>(entityCacheKeys.userFirestoreDoc(input.viewerId))) ?? null;
    if (!userFirestoreDocHasAuthorDisplay(userData)) {
      const cachedSummary =
        (await globalCache.get<{
          handle?: unknown;
          name?: unknown;
          pic?: unknown;
        }>(entityCacheKeys.userSummary(input.viewerId))) ?? null;
      if (
        cachedSummary &&
        (trimAuthorField(cachedSummary.handle).length > 0 ||
          trimAuthorField(cachedSummary.name).length > 0 ||
          trimAuthorField(cachedSummary.pic).length > 0)
      ) {
        userData = {
          handle: typeof cachedSummary.handle === "string" ? cachedSummary.handle : "",
          name: typeof cachedSummary.name === "string" ? cachedSummary.name : "",
          profilePic: typeof cachedSummary.pic === "string" ? cachedSummary.pic : ""
        };
      }
    }
    if (!userFirestoreDocHasAuthorDisplay(userData)) {
      userData = (await this.ensureViewerDocCached(input.viewerId)) ?? {};
    }
    const authorSnapshot = buildNativeAuthorSnapshotFromUserDoc(userData ?? {}, input.effectiveUserId);
    const now = Date.now();
    const nowTs = Timestamp.fromMillis(now);
    const postId = `post_${createHash("sha1").update(`${input.viewerId}:${input.idempotencyKey}`).digest("hex").slice(0, 16)}`;
    const lat = normalizeNumber(input.lat);
    const lng = normalizeNumber(input.long);
    const activities = input.activities.map((value) => String(value ?? "").trim()).filter(Boolean);
    const enrichedRecordings = await this.postingAudioService.enrichRecordingsForPublish(input.recordings);
    const assembled = assemblePostAssetsFromStagedItems(postId, input.stagedItems);
    const geo = this.resolveFinalizeGeo(lat, lng, input.address ?? "");
    const postDoc = buildNativePostDocument({
      postId,
      effectiveUserId: input.effectiveUserId,
      viewerId: input.viewerId,
      sessionId: input.sessionId,
      stagedSessionId: input.stagedSessionId,
      idempotencyKey: input.idempotencyKey,
      nowMs: now,
      nowTs,
      user: authorSnapshot,
      title: input.title,
      content: input.content,
      activities: activities.length > 0 ? activities : ["misc"],
      lat,
      lng,
      address: input.address ?? "",
      privacy: input.privacy ?? "Public Spot",
      tags: input.tags,
      texts: input.texts,
      recordings: enrichedRecordings,
      assembled,
      geo
    });
    validateNativePostDocumentForWrite(postDoc);

    const firstVideo = assembled.assets.find((a) => String((a as { type?: string }).type).toLowerCase() === "video") as
      | {
          poster?: string;
          variants?: { main720?: string; main720Avc?: string; preview360Avc?: string; poster?: string };
          original?: string;
        }
      | undefined;
    const playbackUrlPresent = Boolean(
      firstVideo &&
        (String(firstVideo.variants?.preview360Avc ?? "").trim() ||
          String(firstVideo.variants?.main720 ?? "").trim() ||
          String(firstVideo.variants?.main720Avc ?? "").trim())
    );
    const posterPresent = Boolean(
      firstVideo &&
        (String(firstVideo.variants?.poster ?? "").trim() || String(firstVideo.poster ?? "").trim())
    );

    const postRef = db.collection("posts").doc(postId);
    let createdNewPost = true;
    try {
      await postRef.create(postDoc);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("ALREADY_EXISTS")) {
        throw error;
      }
      createdNewPost = false;
    }

    if (createdNewPost) {
      await this.postingAudioService.recordUsageForPublishedPost({
        recordings: enrichedRecordings,
        activities,
        postId
      });
    }

    let videoTaskEnqueued = false;
    let videoTaskReason: string | undefined;
    let syncFaststartAttempted = false;
    let instantPlaybackReady = false;
    if (createdNewPost && assembled.hasVideo) {
      const videoAssets = assembled.assets
        .filter((a) => String((a as { type?: string }).type).toLowerCase() === "video")
        .map((a) => {
          const row = a as { id?: string; original?: string };
          return { id: String(row.id ?? "").trim(), original: String(row.original ?? "").trim() };
        })
        .filter((a) => a.id.length > 0 && a.original.length > 0);
      if (videoAssets.length > 0) {
        if (await this.shouldAttemptSyncVideoFaststart(videoAssets)) {
          syncFaststartAttempted = true;
          const timeoutMs = this.getSyncVideoFaststartTimeoutMs();
          const syncResult = await triggerVideoProcessingSynchronously({
            postId,
            userId: input.effectiveUserId,
            videoAssets,
            correlationId: input.sessionId,
            timeoutMs
          });
          if (!syncResult.ok) {
            videoTaskReason = `sync_faststart_failed:${syncResult.reason}`;
          } else {
            instantPlaybackReady = await this.verifyAndMarkInstantPlaybackReady(postId);
          }
        }

        if (!instantPlaybackReady) {
          const taskResult = await enqueueVideoProcessingCloudTask({
            postId,
            userId: input.effectiveUserId,
            videoAssets,
            correlationId: input.sessionId
          });
          if (taskResult.ok) {
            videoTaskEnqueued = true;
            const readiness = buildPostMediaReadiness({
              assets: postDoc.assets,
              assetsReady: false,
              videoProcessingStatus: "processing",
              instantPlaybackReady: false
            });
            await postRef.update({
              mediaStatus: "processing",
              videoProcessingStatus: "processing",
              instantPlaybackReady: false,
              assetsReady: false,
              playbackReady: false,
              playbackUrlPresent: false,
              ...(readiness.fallbackVideoUrl ? { fallbackVideoUrl: readiness.fallbackVideoUrl } : {}),
              posterReady: readiness.posterReady,
              posterPresent: readiness.posterPresent,
              ...(readiness.posterUrl ? { posterUrl: readiness.posterUrl } : {}),
              videoProcessingProgress: {
                totalVideos: videoAssets.length,
                processedVideos: 0
              }
            });
            this.scheduleInstantPlaybackReadyMonitor(postId);
          } else {
            videoTaskReason = taskResult.reason;
            const readiness = buildPostMediaReadiness({
              assets: postDoc.assets,
              assetsReady: false,
              videoProcessingStatus: "failed",
              instantPlaybackReady: false
            });
            await postRef.update({
              mediaStatus: "failed",
              videoProcessingStatus: "failed",
              instantPlaybackReady: false,
              assetsReady: false,
              playbackReady: false,
              playbackUrlPresent: false,
              ...(readiness.fallbackVideoUrl ? { fallbackVideoUrl: readiness.fallbackVideoUrl } : {}),
              posterReady: readiness.posterReady,
              posterPresent: readiness.posterPresent,
              ...(readiness.posterUrl ? { posterUrl: readiness.posterUrl } : {}),
              videoProcessingFailureReason: taskResult.reason
            });
            console.warn("[video.processing.failed]", {
              postId,
              reason: taskResult.reason,
              phase: "enqueue"
            });
            console.warn("[posting.finalize] video_processing_task_not_enqueued", {
              postId,
              reason: taskResult.reason
            });
          }
        }
      }
    }

    console.info("[posting.finalize]", {
      event: "native_canonical_post",
      finalizePath: "native_v2",
      postId,
      mediaCount: input.stagedItems.length,
      mediaTypes: input.stagedItems.map((r) => r.assetType),
      hasVideo: assembled.hasVideo,
      assetsReady: postDoc.assetsReady,
      variantCount: assembled.variantUrlCount,
      posterPresent,
      playbackUrlPresent,
      syncFaststartAttempted,
      instantPlaybackReady,
      videoTaskEnqueued,
      ...(videoTaskReason ? { videoTaskReason } : {}),
      sessionIdPrefix: input.sessionId.slice(0, 8)
    });

    this.scheduleFinalizeSupplementaryWrites({
      viewerId: input.viewerId,
      postId,
      now,
      nowTs
    });
    if (debugTimings) {
      console.info("[posting.finalize.timing] publishNativeCanonicalPost:canonicalCreate", { ms: Date.now() - startedAt });
    }
    return postId;
  }

  private async shouldAttemptSyncVideoFaststart(videoAssets: Array<{ id: string; original: string }>): Promise<boolean> {
    // Keep finalize fast by default; opt into sync faststart only via explicit env.
    if (process.env.POSTING_VIDEO_SYNC_FASTSTART_ENABLED !== "1") return false;
    const maxVideos = 2;
    if (!(videoAssets.length > 0 && videoAssets.length <= maxVideos)) return false;
    const maxBytes = Number(process.env.POSTING_VIDEO_SYNC_FASTSTART_MAX_BYTES ?? 157286400);
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) return true;
    let totalBytes = 0;
    for (const asset of videoAssets) {
      try {
        const res = await fetch(asset.original, { method: "HEAD" });
        const len = Number(res.headers.get("content-length") ?? "0");
        if (Number.isFinite(len) && len > 0) {
          totalBytes += len;
          if (totalBytes > maxBytes) return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  private getSyncVideoFaststartTimeoutMs(): number {
    const raw = Number(process.env.POSTING_VIDEO_SYNC_FASTSTART_MAX_SECONDS ?? 45);
    if (!Number.isFinite(raw) || raw <= 0) return 45_000;
    return Math.round(raw * 1000);
  }

  private async verifyAndMarkInstantPlaybackReady(postId: string): Promise<boolean> {
    const db = getFirestoreSourceClient();
    if (!db) return false;
    const snap = await db.collection("posts").doc(postId).get();
    if (!snap.exists) return false;
    const post = (snap.data() ?? {}) as Record<string, unknown>;
    const assets = Array.isArray(post.assets) ? (post.assets as Record<string, unknown>[]) : [];
    const videoAssets = assets.filter((a) => String(a.type ?? "").toLowerCase() === "video");
    if (videoAssets.length === 0) return true;
    for (const asset of videoAssets) {
      const poster = String(asset.poster ?? "").trim();
      const variants = (asset.variants ?? {}) as Record<string, unknown>;
      const preview360 = String(variants.preview360 ?? variants.preview360Avc ?? "").trim();
      const main720 = String(variants.main720 ?? "").trim();
      const main720Avc = String(variants.main720Avc ?? "").trim();
      if (!poster || !preview360 || !main720 || !main720Avc) return false;
      if (
        preview360 === String(asset.original ?? "").trim() ||
        main720 === String(asset.original ?? "").trim() ||
        main720Avc === String(asset.original ?? "").trim()
      ) {
        return false;
      }
      const urls = [preview360, main720, main720Avc];
      if (process.env.POSTING_VIDEO_FASTSTART_REQUIRED !== "0") {
        for (const url of urls) {
          if (!(await this.verifyMp4Faststart(url))) return false;
        }
      }
    }
    const readiness = buildPostMediaReadiness({
      ...post,
      assetsReady: true,
      instantPlaybackReady: true,
      videoProcessingStatus: "completed"
    });
    await db.collection("posts").doc(postId).update({
      mediaStatus: "ready",
      instantPlaybackReady: true,
      assetsReady: true,
      playbackReady: true,
      playbackUrlPresent: readiness.playbackUrlPresent,
      ...(readiness.playbackUrl ? { playbackUrl: readiness.playbackUrl } : {}),
      ...(readiness.fallbackVideoUrl ? { fallbackVideoUrl: readiness.fallbackVideoUrl } : {}),
      posterReady: readiness.posterReady,
      posterPresent: readiness.posterPresent,
      ...(readiness.posterUrl ? { posterUrl: readiness.posterUrl } : {}),
      videoProcessingStatus: "completed",
      videoProcessingProgress: FieldValue.delete()
    });
    console.info("[video.processing.completed]", {
      postId,
      assetsReady: true,
      instantPlaybackReady: true,
      videoProcessingStatus: "completed"
    });
    return true;
  }

  private scheduleInstantPlaybackReadyMonitor(postId: string): void {
    scheduleBackgroundWork(async () => {
      for (let i = 0; i < 8; i += 1) {
        const ok = await this.verifyAndMarkInstantPlaybackReady(postId).catch(() => false);
        if (ok) return;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    });
  }

  private async verifyMp4Faststart(url: string): Promise<boolean> {
    if (!/^https?:\/\//i.test(url)) return false;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-524287" }
      });
      if (!res.ok && res.status !== 206) return false;
      const buf = Buffer.from(await res.arrayBuffer());
      const body = buf.toString("binary");
      const moov = body.indexOf("moov");
      const mdat = body.indexOf("mdat");
      return moov >= 0 && (mdat < 0 || moov < mdat);
    } catch {
      return false;
    }
  }

  private async assertCanonicalMediaPubliclyReadable(postId: string): Promise<void> {
    const db = getFirestoreSourceClient();
    if (!db) {
      throw new Error("firestore_unavailable");
    }
    const snap = await db.collection("posts").doc(postId).get();
    if (!snap.exists) {
      throw new Error("canonical_post_not_found_for_media_verify");
    }
    const row = (snap.data() ?? {}) as Record<string, unknown>;
    const urls = new Set<string>();
    const displayPhotoLink = String(row.displayPhotoLink ?? "").trim();
    if (displayPhotoLink) urls.add(displayPhotoLink);
    const assets = Array.isArray(row.assets) ? row.assets : [];
    for (const asset of assets) {
      if (!asset || typeof asset !== "object") continue;
      const candidate = asset as {
        type?: string;
        original?: string;
        poster?: string;
        variants?: { poster?: string };
      };
      if (typeof candidate.original === "string" && candidate.original.trim()) {
        urls.add(candidate.original.trim());
      }
      if (String(candidate.type ?? "").toLowerCase() === "video") {
        const poster =
          typeof candidate.poster === "string" && candidate.poster.trim()
            ? candidate.poster.trim()
            : typeof candidate.variants?.poster === "string" && candidate.variants.poster.trim()
              ? candidate.variants.poster.trim()
              : "";
        if (poster) urls.add(poster);
      }
    }
    if (urls.size === 0) {
      throw new Error("canonical_media_missing_public_urls");
    }
    for (const url of urls) {
      const ok = await this.verifyPublicUrlReadable(url);
      if (!ok) {
        throw new Error(`canonical_media_public_read_failed:${url}`);
      }
    }
  }

  private async verifyPublicUrlReadable(url: string): Promise<boolean> {
    if (!/^https?:\/\//i.test(url)) return false;
    try {
      const head = await fetch(url, { method: "HEAD" });
      if (head.ok) return true;
    } catch {
      // Fall through to GET probe.
    }
    try {
      const get = await fetch(url, {
        method: "GET",
        headers: {
          Range: "bytes=0-0"
        }
      });
      return get.ok || get.status === 206;
    } catch {
      return false;
    }
  }

  private async assertCanonicalPostExists(postId: string): Promise<void> {
    const db = getFirestoreSourceClient();
    if (!db) {
      throw new Error("firestore_unavailable");
    }
    const snap = await db.collection("posts").doc(postId).get();
    if (!snap.exists) {
      throw new Error("canonical_post_not_found_after_finalize");
    }
  }

  private async createCanonicalPostFallbackForTests(input: {
    viewerId: string;
    sessionId: string;
    stagedSessionId?: string;
    idempotencyKey: string;
    title?: string;
    content?: string;
    activities?: string[];
    lat?: number | string;
    long?: number | string;
    address?: string;
    privacy?: string;
  }): Promise<string> {
    const db = getFirestoreSourceClient();
    const postId = `post_${createHash("sha1").update(`${input.viewerId}:${input.idempotencyKey}`).digest("hex").slice(0, 10)}`;
    if (!db) {
      return postId;
    }
    const now = Date.now();
    const nowTs = Timestamp.fromMillis(now);
    const geoData = {
      country: "United States",
      state: "California",
      city: "San Francisco"
    };
    const imageUrl = `https://media.locava.test/images/${postId}_lg.webp`;
    const postDoc: Record<string, unknown> = {
      postId,
      userId: input.viewerId,
      title: input.title ?? "",
      content: input.content ?? "",
      activities: Array.isArray(input.activities) && input.activities.length > 0 ? input.activities : ["misc"],
      lat: Number(input.lat ?? 0),
      long: Number(input.long ?? 0),
      address: input.address ?? "",
      privacy: input.privacy ?? "Public Spot",
      assets: [
        {
          id: `${postId}_asset_0`,
          type: "image",
          original: imageUrl,
          variants: {
            thumb: { webp: imageUrl, w: 180, h: 320 },
            sm: { webp: imageUrl, w: 360, h: 640 },
            md: { webp: imageUrl, w: 720, h: 1280 },
            lg: { webp: imageUrl, w: 1080, h: 1920 },
            fallbackJpg: { jpg: imageUrl.replace(".webp", ".jpg") }
          },
          aspectRatio: 0.5625,
          orientation: "portrait"
        }
      ],
      assetsReady: true,
      imageProcessingStatus: "completed",
      videoProcessingStatus: "completed",
      displayPhotoLink: imageUrl,
      photoLink: imageUrl,
      photoLinks2: imageUrl,
      photoLinks3: imageUrl,
      legacy: {
        photoLink: imageUrl,
        photoLinks2: imageUrl,
        photoLinks3: imageUrl
      },
      carouselFitWidth: true,
      letterboxGradients: [{ top: "#1f2937", bottom: "#111827" }],
      cityRegionId: "US-California-San-Francisco",
      stateRegionId: "US-California",
      countryRegionId: "US",
      geohash: "9q8yyk8yt",
      geoData,
      sessionId: input.sessionId,
      stagedSessionId: input.stagedSessionId ?? null,
      createdAt: nowTs,
      time: nowTs,
      "time-created": nowTs,
      lastUpdated: nowTs,
      likesCount: 0,
      commentsCount: 0
    };
    await db.collection("posts").doc(postId).set(postDoc, { merge: true });
    await db.collection("users").doc(input.viewerId).collection("posts").doc(postId).set({
      postId,
      createdAt: nowTs,
      time: nowTs
    }, { merge: true });
    return postId;
  }
}

function normalizeNumber(value: number | string | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}
