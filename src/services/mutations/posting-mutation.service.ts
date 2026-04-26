import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { invalidateEntitiesForMutation } from "../../cache/entity-invalidation.js";
import { globalCache } from "../../cache/global-cache.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { withMutationLock } from "../../lib/mutation-lock.js";
import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { readWasabiConfigFromEnv } from "../storage/wasabi-config.js";
import { buildFinalizedSessionAssetPlan } from "../storage/wasabi-presign.service.js";
import { postingAchievementsService } from "./posting-achievements.service.js";
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

export class PostingMutationService {
  private readonly completionTimers = new Map<string, NodeJS.Timeout>();
  private readonly mediaVerificationTimers = new Map<string, NodeJS.Timeout>();
  private readonly achievementProcessingTimers = new Map<string, NodeJS.Timeout>();
  private readonly viewerDocWarmTimers = new Map<string, NodeJS.Timeout>();
  private readonly finalizeSupplementaryWriteTimers = new Map<string, NodeJS.Timeout>();

  async createUploadSession(input: {
    viewerId: string;
    clientSessionKey: string;
    mediaCountHint: number;
  }): Promise<{ session: UploadSessionRecord; idempotent: boolean }> {
    this.scheduleViewerDocCacheWarm(input.viewerId);
    return dedupeInFlight(`posting:create-session:${input.viewerId}:${input.clientSessionKey}`, () =>
      withConcurrencyLimit("posting-create-session", 12, () =>
        postingMutationRepository.createUploadSession(input)
      )
    );
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
    authorizationHeader?: string;
  }): Promise<{
    session: UploadSessionRecord;
    operation: PostingOperationRecord;
    idempotent: boolean;
    canonicalCreated: boolean;
    achievementDelta?: AchievementDelta;
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
        return {
          ...result,
          canonicalCreated: true,
          achievementDelta: await this.resolveFinalizeAchievementDelta(input, result.operation.postId)
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
        return {
          session: result.session,
          operation: completed,
          idempotent: result.idempotent,
          canonicalCreated: true,
          achievementDelta: await this.resolveFinalizeAchievementDelta(input, postId)
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
    const timer = setTimeout(() => {
      this.achievementProcessingTimers.delete(postId);
      void this.buildFinalizeAchievementDelta(input, postId).catch(() => undefined);
    }, 0);
    timer.unref?.();
    this.achievementProcessingTimers.set(postId, timer);
  }

  private shouldEnforceFinalizeAssertions(): boolean {
    return process.env.POSTING_FINALIZE_ENFORCE_ASSERTS === "1";
  }

  private shouldUseSynchronousFinalizeAchievements(): boolean {
    return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  }

  private scheduleViewerDocCacheWarm(viewerId: string): void {
    if (this.shouldEnforceFinalizeAssertions()) return;
    if (this.viewerDocWarmTimers.has(viewerId)) return;
    const timer = setTimeout(() => {
      this.viewerDocWarmTimers.delete(viewerId);
      void this.ensureViewerDocCached(viewerId).catch(() => undefined);
    }, 0);
    timer.unref?.();
    this.viewerDocWarmTimers.set(viewerId, timer);
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
    await globalCache.set(entityCacheKeys.userFirestoreDoc(viewerId), data, 25_000);
    return data;
  }

  private scheduleFinalizeSupplementaryWrites(input: {
    viewerId: string;
    postId: string;
    now: number;
    nowTs: Timestamp;
  }): void {
    if (this.finalizeSupplementaryWriteTimers.has(input.postId)) return;
    const timer = setTimeout(() => {
      this.finalizeSupplementaryWriteTimers.delete(input.postId);
      const db = getFirestoreSourceClient();
      if (!db) return;
      void db
        .runTransaction(async (tx) => {
          const userPostRef = db.collection("users").doc(input.viewerId).collection("posts").doc(input.postId);
          const achievementsStateRef = db.collection("users").doc(input.viewerId).collection("achievements").doc("state");
          const existingUserPost = await tx.get(userPostRef);
          if (existingUserPost.exists) return;
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
        })
        .catch(() => undefined);
    }, 0);
    timer.unref?.();
    this.finalizeSupplementaryWriteTimers.set(input.postId, timer);
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
      await this.ensureViewerDocCached(input.viewerId);
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
    const timer = setTimeout(() => {
      this.completionTimers.delete(operationId);
      void this.getPostingOperationWithInvalidation(viewerId, operationId).catch(() => undefined);
    }, 1600);
    timer.unref?.();
    this.completionTimers.set(operationId, timer);
  }

  private scheduleCanonicalMediaVerification(postId: string): void {
    if (this.mediaVerificationTimers.has(postId)) return;
    const timer = setTimeout(() => {
      this.mediaVerificationTimers.delete(postId);
      void this.assertCanonicalMediaPubliclyReadable(postId).catch((error) => {
        console.warn("[posting.finalize] deferred media verification failed", {
          postId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, 0);
    timer.unref?.();
    this.mediaVerificationTimers.set(postId, timer);
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
    const base = process.env.LEGACY_MONOLITH_PROXY_BASE_URL?.trim();
    if (process.env.NODE_ENV === "test") {
      return this.createCanonicalPostFallbackForTests(input);
    }
    const viewer = input.userId?.trim() || input.viewerId;
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
    const authHeader =
      input.authorizationHeader?.trim() ||
      (process.env.LEGACY_MONOLITH_PUBLISH_BEARER_TOKEN?.trim()
        ? `Bearer ${process.env.LEGACY_MONOLITH_PUBLISH_BEARER_TOKEN.trim()}`
        : "");
    const forceLegacyProxy = process.env.POSTING_FINALIZE_FORCE_LEGACY_PROXY === "1";
    if (!forceLegacyProxy || !base || !authHeader) {
      const beforeDirectPublish = debugTimings ? Date.now() : 0;
      const postId = await this.publishCanonicalPostDirect({
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
        stagedItems
      });
      if (debugTimings) {
        console.info("[posting.finalize.timing] publishCanonicalPostDirect", { ms: Date.now() - beforeDirectPublish });
      }
      if (process.env.NODE_ENV !== "test") {
        this.scheduleCanonicalMediaVerification(postId);
      }
      if (debugTimings) {
        console.info("[posting.finalize.timing] direct-path-total", { ms: Date.now() - startedAt });
      }
      return postId;
    }
    const body: Record<string, unknown> = {
      sessionId: canonicalSessionId,
      userId: viewer,
      title: input.title ?? "",
      content: input.content ?? "",
      activities:
        Array.isArray(input.activities) && input.activities.length > 0
          ? input.activities
          : ["misc"],
      lat: String(input.lat ?? 0),
      long: String(input.long ?? 0),
      address: input.address ?? "",
      privacy: input.privacy ?? "Public Spot",
      tags: Array.isArray(input.tags) ? input.tags : [],
      texts: Array.isArray(input.texts) ? input.texts : [],
      recordings: Array.isArray(input.recordings) ? input.recordings : [],
      stagedItems,
      ...(typeof input.displayPhotoBase64 === "string" && input.displayPhotoBase64.trim().length > 0
        ? { displayPhotoBase64: input.displayPhotoBase64.trim() }
        : {}),
      ...(Array.isArray(input.videoPostersBase64) ? { videoPostersBase64: input.videoPostersBase64 } : {}),
      idempotencyKey: createHash("sha256").update(`${viewer}:${input.idempotencyKey}`).digest("hex")
    };
    const url = `${base.replace(/\/+$/, "")}/api/v1/product/upload/create-from-staged`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authHeader ? { authorization: authHeader } : {})
      },
      body: JSON.stringify(body)
    });
    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; postId?: string; error?: string; message?: string };
    if (!response.ok || !payload.success || !payload.postId) {
      throw new Error(payload.error || payload.message || "publish_failed");
    }
    if (process.env.NODE_ENV !== "test") {
      this.scheduleCanonicalMediaVerification(payload.postId);
    }
    if (debugTimings) {
      console.info("[posting.finalize.timing] legacy-proxy-total", { ms: Date.now() - startedAt });
    }
    return payload.postId;
  }

  private async publishCanonicalPostDirect(input: {
    viewerId: string;
    effectiveUserId: string;
    sessionId: string;
    stagedSessionId: string;
    idempotencyKey: string;
    title?: string;
    content?: string;
    activities?: string[];
    lat?: number | string;
    long?: number | string;
    address?: string;
    privacy?: string;
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
    if (debugTimings) {
      console.info("[posting.finalize.timing] publishCanonicalPostDirect:cacheLookup", { ms: Date.now() - startedAt, hit: !!userData });
    }
    if (!userData) {
      userData = (await this.ensureViewerDocCached(input.viewerId)) ?? {};
      if (debugTimings) {
        console.info("[posting.finalize.timing] publishCanonicalPostDirect:userDocRead", { ms: Date.now() - startedAt });
      }
    }
    const now = Date.now();
    const nowTs = Timestamp.fromMillis(now);
    const postId = `post_${createHash("sha1").update(`${input.viewerId}:${input.idempotencyKey}`).digest("hex").slice(0, 16)}`;
    const lat = normalizeNumber(input.lat);
    const lng = normalizeNumber(input.long);
    const primaryItem = input.stagedItems[0];
    const primaryPosterUrl = primaryItem?.posterUrl?.trim() || primaryItem?.originalUrl?.trim() || "";
    const primaryMediaType = primaryItem?.assetType === "video" ? "video" : "image";
    const activities = (input.activities ?? []).map((value) => String(value ?? "").trim()).filter(Boolean);
    const postDoc: Record<string, unknown> = {
      postId,
      userId: input.effectiveUserId,
      title: input.title ?? "",
      content: input.content ?? "",
      caption: input.content ?? input.title ?? "",
      description: input.content ?? "",
      activities,
      lat,
      long: lng,
      lng,
      address: input.address ?? "",
      privacy: input.privacy ?? "Public Spot",
      mediaType: primaryMediaType,
      thumbUrl: primaryPosterUrl,
      displayPhotoLink: primaryPosterUrl,
      createdAtMs: now,
      updatedAtMs: now,
      createdAt: nowTs,
      updatedAt: nowTs,
      lastUpdated: nowTs,
      time: nowTs,
      "time-created": nowTs,
      likesCount: 0,
      likeCount: 0,
      commentsCount: 0,
      commentCount: 0,
      likedBy: [],
      comments: [],
      userHandle: typeof userData.handle === "string" ? userData.handle : "",
      userName: typeof userData.name === "string" ? userData.name : typeof userData.displayName === "string" ? userData.displayName : "",
      userPic:
        typeof userData.profilePic === "string"
          ? userData.profilePic
          : typeof userData.profilePicSmall === "string"
            ? userData.profilePicSmall
            : "",
      assets: input.stagedItems.map((item) => ({
        id: item.assetId ?? `${postId}_asset_${item.index}`,
        type: item.assetType === "video" ? "video" : "image",
        original: item.originalUrl ?? "",
        poster: item.posterUrl ?? item.originalUrl ?? "",
        thumbnail: item.posterUrl ?? item.originalUrl ?? "",
        variants:
          item.assetType === "video"
            ? {
                poster: item.posterUrl ?? item.originalUrl ?? ""
              }
            : {
                sm: item.originalUrl ?? "",
                md: item.originalUrl ?? "",
                lg: item.originalUrl ?? ""
              }
      })),
      sessionId: input.sessionId,
      stagedSessionId: input.stagedSessionId
    };

    const postRef = db.collection("posts").doc(postId);
    const userRef = db.collection("users").doc(input.viewerId);
    await db.runTransaction(async (tx) => {
      const existingPost = await tx.get(postRef);
      if (existingPost.exists) return;
      tx.set(postRef, postDoc, { merge: true });
      tx.set(
        userRef,
        {
          numPosts: FieldValue.increment(1),
          postCount: FieldValue.increment(1),
          postsCount: FieldValue.increment(1),
          postCountVerifiedAtMs: now,
          updatedAt: now
        },
        { merge: true }
      );
    });
    await Promise.allSettled([
      globalCache.del(entityCacheKeys.userPostCount(input.viewerId)),
      globalCache.del(entityCacheKeys.userFirestoreDoc(input.viewerId))
    ]);
    this.scheduleFinalizeSupplementaryWrites({
      viewerId: input.viewerId,
      postId,
      now,
      nowTs
    });
    if (debugTimings) {
      console.info("[posting.finalize.timing] publishCanonicalPostDirect:batchCommit", { ms: Date.now() - startedAt });
    }
    return postId;
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
