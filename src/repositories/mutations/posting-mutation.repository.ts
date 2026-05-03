import { randomUUID } from "node:crypto";
import { incrementDbOps } from "../../observability/request-context.js";
import { buildFinalizedSessionAssetKeys } from "../../services/storage/wasabi-presign.service.js";
import {
  postingStatePersistence,
  type PersistedPostingMediaRecord,
  type PersistedPostingMediaState,
  type PersistedPostingOperationRecord,
  type PersistedPostingOperationState,
  type PersistedPostingTerminalReason,
  type PersistedUploadSessionRecord,
  type PersistedUploadSessionState
} from "./posting-state.persistence.js";

type UploadSessionState = PersistedUploadSessionState;
type PostingOperationState = PersistedPostingOperationState;
type PostingTerminalReason = PersistedPostingTerminalReason;
type PostingMediaState = PersistedPostingMediaState;

export class PostingMutationError extends Error {
  constructor(
    public readonly code:
      | "session_not_found"
      | "session_not_owned"
      | "session_not_open"
      | "session_expired"
      | "operation_not_found"
      | "operation_not_owned"
      | "operation_cancel_not_allowed"
      | "operation_retry_not_allowed"
      | "media_not_found"
      | "media_not_owned",
    message: string
  ) {
    super(message);
  }
}

export type UploadSessionRecord = PersistedUploadSessionRecord;

export type PostingOperationRecord = PersistedPostingOperationRecord;
export type PostingMediaRecord = PersistedPostingMediaRecord;

const SESSION_TTL_MS = 45 * 60 * 1000;
const DEFAULT_POLL_AFTER_MS = 1500;
const COMPLETE_AFTER_POLLS = 2;
const MEDIA_READY_AFTER_POLLS = 2;

class PostingMutationRepository {
  async getPostingOperationByPostId(input: {
    viewerId: string;
    postId: string;
  }): Promise<PostingOperationRecord | null> {
    incrementDbOps("queries", 1);
    const state = await postingStatePersistence.getState();
    const operation = Object.values(state.operationsById).find(
      (item) => item.viewerId === input.viewerId && item.postId === input.postId
    );
    return operation ?? null;
  }

  async listSessionMedia(input: {
    viewerId: string;
    sessionId: string;
  }): Promise<PostingMediaRecord[]> {
    incrementDbOps("queries", 1);
    const state = await postingStatePersistence.getState();
    const session = state.sessionsById[input.sessionId];
    if (!session) {
      throw new PostingMutationError("session_not_found", "Upload session was not found.");
    }
    if (session.viewerId !== input.viewerId) {
      throw new PostingMutationError("session_not_owned", "Upload session does not belong to this viewer.");
    }
    const media = Object.values(state.mediaById)
      .filter((item) => item.viewerId === input.viewerId && item.sessionId === input.sessionId)
      .sort((a, b) => a.assetIndex - b.assetIndex || a.createdAtMs - b.createdAtMs);
    return media;
  }

  async createUploadSession(input: {
    viewerId: string;
    clientSessionKey: string;
    mediaCountHint: number;
    nowMs?: number;
  }): Promise<{ session: UploadSessionRecord; idempotent: boolean }> {
    const nowMs = input.nowMs ?? Date.now();
    const viewerKey = `${input.viewerId}:${input.clientSessionKey}`;
    incrementDbOps("queries", 1);
    const state = await postingStatePersistence.getState();
    const existingSessionId = state.sessionsByViewerKey[viewerKey];
    if (existingSessionId) {
      const existing = state.sessionsById[existingSessionId];
      if (existing && existing.expiresAtMs > nowMs && existing.state !== "expired") {
        return { session: existing, idempotent: true };
      }
    }

    const session: PersistedUploadSessionRecord = {
      sessionId: `ups_${randomUUID().slice(0, 12)}`,
      viewerId: input.viewerId,
      clientSessionKey: input.clientSessionKey,
      mediaCountHint: input.mediaCountHint,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + SESSION_TTL_MS,
      state: "open"
    };
    await postingStatePersistence.mutate((draft) => {
      draft.sessionsById[session.sessionId] = session;
      draft.sessionsByViewerKey[viewerKey] = session.sessionId;
    });
    incrementDbOps("writes", 1);
    return { session, idempotent: false };
  }

  async finalizePosting(input: {
    viewerId: string;
    sessionId: string;
    idempotencyKey: string;
    mediaCount: number;
    nowMs?: number;
  }): Promise<{
    session: UploadSessionRecord;
    operation: PostingOperationRecord;
    idempotent: boolean;
  }> {
    const nowMs = input.nowMs ?? Date.now();
    const idempotencyMapKey = `${input.viewerId}:${input.idempotencyKey}`;
    const state = await postingStatePersistence.getState();

    incrementDbOps("queries", 1);
    const existingOperationId = state.operationsByViewerIdempotency[idempotencyMapKey];
    if (existingOperationId) {
      const existingOperation = state.operationsById[existingOperationId];
      if (existingOperation) {
        const existingSession = state.sessionsById[existingOperation.sessionId];
        if (existingSession) {
          return { session: existingSession, operation: existingOperation, idempotent: true };
        }
      }
    }

    incrementDbOps("queries", 1);
    const session = state.sessionsById[input.sessionId];
    if (!session) {
      throw new PostingMutationError("session_not_found", "Upload session was not found.");
    }
    if (session.viewerId !== input.viewerId) {
      throw new PostingMutationError("session_not_owned", "Upload session does not belong to this viewer.");
    }
    if (session.expiresAtMs <= nowMs) {
      session.state = "expired";
      await postingStatePersistence.mutate((draft) => {
        draft.sessionsById[input.sessionId] = session;
      });
      incrementDbOps("writes", 1);
      throw new PostingMutationError("session_expired", "Upload session has expired.");
    }
    if (session.state !== "open") {
      throw new PostingMutationError("session_not_open", "Upload session is not open.");
    }

    session.state = "finalized";
    session.mediaCountHint = Math.max(session.mediaCountHint, input.mediaCount);

    const operation: PersistedPostingOperationRecord = {
      operationId: `pop_${randomUUID().slice(0, 12)}`,
      viewerId: input.viewerId,
      sessionId: session.sessionId,
      postId: "",
      idempotencyKey: input.idempotencyKey,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      state: "processing",
      pollCount: 0,
      pollAfterMs: DEFAULT_POLL_AFTER_MS,
      terminalReason: "processing",
      retryCount: 0,
      completionInvalidatedAtMs: null
    };

    await postingStatePersistence.mutate((draft) => {
      draft.sessionsById[session.sessionId] = session;
      draft.operationsById[operation.operationId] = operation;
      draft.operationsByViewerIdempotency[idempotencyMapKey] = operation.operationId;
    });
    incrementDbOps("writes", 2);

    return { session, operation, idempotent: false };
  }

  async getPostingOperation(input: {
    viewerId: string;
    operationId: string;
    nowMs?: number;
  }): Promise<PostingOperationRecord> {
    incrementDbOps("queries", 1);
    const state = await postingStatePersistence.getState();
    const operation = state.operationsById[input.operationId];
    if (!operation) {
      throw new PostingMutationError("operation_not_found", "Posting operation was not found.");
    }
    if (operation.viewerId !== input.viewerId) {
      throw new PostingMutationError("operation_not_owned", "Posting operation does not belong to this viewer.");
    }
    if (operation.state === "processing" && operation.postId) {
      operation.pollCount += 1;
      if (operation.pollCount >= COMPLETE_AFTER_POLLS) {
        operation.state = "completed";
        operation.terminalReason = "ready";
      }
      operation.updatedAtMs = Date.now();
      await postingStatePersistence.mutate((draft) => {
        draft.operationsById[operation.operationId] = operation;
      });
      incrementDbOps("writes", 1);
    }

    return operation;
  }

  async markOperationCompleted(input: {
    operationId: string;
    postId: string;
    nowMs?: number;
  }): Promise<PostingOperationRecord> {
    const nowMs = input.nowMs ?? Date.now();
    incrementDbOps("queries", 1);
    const state = await postingStatePersistence.getState();
    const operation = state.operationsById[input.operationId];
    if (!operation) {
      throw new PostingMutationError("operation_not_found", "Posting operation was not found.");
    }
    operation.postId = input.postId;
    operation.state = "processing";
    operation.terminalReason = "processing";
    operation.pollCount = 0;
    operation.updatedAtMs = nowMs;
    await postingStatePersistence.mutate((draft) => {
      draft.operationsById[operation.operationId] = operation;
    });
    incrementDbOps("writes", 1);
    return operation;
  }

  async markOperationFailed(input: { operationId: string; reason?: string; nowMs?: number }): Promise<PostingOperationRecord> {
    const nowMs = input.nowMs ?? Date.now();
    incrementDbOps("queries", 1);
    const state = await postingStatePersistence.getState();
    const operation = state.operationsById[input.operationId];
    if (!operation) {
      throw new PostingMutationError("operation_not_found", "Posting operation was not found.");
    }
    operation.state = "failed";
    operation.terminalReason = "failed";
    operation.updatedAtMs = nowMs;
    await postingStatePersistence.mutate((draft) => {
      draft.operationsById[operation.operationId] = operation;
    });
    incrementDbOps("writes", 1);
    return operation;
  }

  async cancelPostingOperation(input: {
    viewerId: string;
    operationId: string;
    nowMs?: number;
  }): Promise<{ operation: PostingOperationRecord; idempotent: boolean }> {
    const nowMs = input.nowMs ?? Date.now();
    incrementDbOps("queries", 1);
    const state = await postingStatePersistence.getState();
    const operation = state.operationsById[input.operationId];
    if (!operation) {
      throw new PostingMutationError("operation_not_found", "Posting operation was not found.");
    }
    if (operation.viewerId !== input.viewerId) {
      throw new PostingMutationError("operation_not_owned", "Posting operation does not belong to this viewer.");
    }
    if (operation.state === "cancelled") {
      return { operation, idempotent: true };
    }
    if (operation.state === "completed") {
      throw new PostingMutationError(
        "operation_cancel_not_allowed",
        "Cannot cancel an operation that is already completed."
      );
    }
    operation.state = "cancelled";
    operation.terminalReason = "cancelled_by_user";
    operation.updatedAtMs = nowMs;
    await postingStatePersistence.mutate((draft) => {
      draft.operationsById[operation.operationId] = operation;
    });
    incrementDbOps("writes", 1);
    return { operation, idempotent: false };
  }

  async retryPostingOperation(input: {
    viewerId: string;
    operationId: string;
    nowMs?: number;
  }): Promise<{ operation: PostingOperationRecord; idempotent: boolean }> {
    const nowMs = input.nowMs ?? Date.now();
    incrementDbOps("queries", 1);
    const state = await postingStatePersistence.getState();
    const operation = state.operationsById[input.operationId];
    if (!operation) {
      throw new PostingMutationError("operation_not_found", "Posting operation was not found.");
    }
    if (operation.viewerId !== input.viewerId) {
      throw new PostingMutationError("operation_not_owned", "Posting operation does not belong to this viewer.");
    }
    if (operation.state === "processing") {
      return { operation, idempotent: true };
    }
    if (operation.state === "completed") {
      throw new PostingMutationError(
        "operation_retry_not_allowed",
        "Cannot retry an operation that is already completed."
      );
    }

    operation.state = "processing";
    operation.terminalReason = "retry_requested";
    operation.retryCount += 1;
    operation.pollCount = 0;
    operation.updatedAtMs = nowMs;
    await postingStatePersistence.mutate((draft) => {
      draft.operationsById[operation.operationId] = operation;
    });
    incrementDbOps("writes", 1);
    return { operation, idempotent: false };
  }

  async markOperationCompletionInvalidated(input: { operationId: string; nowMs?: number }): Promise<PostingOperationRecord> {
    const nowMs = input.nowMs ?? Date.now();
    incrementDbOps("queries", 1);
    const state = await postingStatePersistence.getState();
    const operation = state.operationsById[input.operationId];
    if (!operation) {
      throw new PostingMutationError("operation_not_found", "Posting operation was not found.");
    }
    if (operation.completionInvalidatedAtMs != null) {
      return operation;
    }
    operation.completionInvalidatedAtMs = nowMs;
    operation.updatedAtMs = nowMs;
    await postingStatePersistence.mutate((draft) => {
      draft.operationsById[operation.operationId] = operation;
    });
    incrementDbOps("writes", 1);
    return operation;
  }

  async registerMedia(input: {
    viewerId: string;
    sessionId: string;
    assetIndex: number;
    assetType: "photo" | "video";
    clientMediaKey: string | null;
    nowMs?: number;
  }): Promise<{ media: PostingMediaRecord; idempotent: boolean }> {
    const nowMs = input.nowMs ?? Date.now();
    incrementDbOps("queries", 1);
    const state = await postingStatePersistence.getState();
    const session = state.sessionsById[input.sessionId];
    if (!session) {
      throw new PostingMutationError("session_not_found", "Upload session was not found.");
    }
    if (session.viewerId !== input.viewerId) {
      throw new PostingMutationError("session_not_owned", "Upload session does not belong to this viewer.");
    }

    const bySessionIndexKey = `${input.viewerId}:${input.sessionId}:${input.assetIndex}`;
    const existingByIndex = state.mediaByViewerSessionIndex[bySessionIndexKey];
    if (existingByIndex) {
      const media = state.mediaById[existingByIndex];
      if (media) {
        return { media, idempotent: true };
      }
    }

    if (input.clientMediaKey) {
      const clientKey = `${input.viewerId}:${input.clientMediaKey}`;
      const existingByClient = state.mediaByViewerClientKey[clientKey];
      if (existingByClient) {
        const media = state.mediaById[existingByClient];
        if (media) {
          return { media, idempotent: true };
        }
      }
    }

    const finalizedKeys = buildFinalizedSessionAssetKeys(
      input.sessionId,
      input.assetIndex,
      input.assetType,
      input.clientMediaKey
    );
    const media: PostingMediaRecord = {
      mediaId: `pmd_${randomUUID().slice(0, 12)}`,
      viewerId: input.viewerId,
      sessionId: input.sessionId,
      assetIndex: input.assetIndex,
      assetType: input.assetType,
      expectedObjectKey: finalizedKeys.originalKey,
      state: "registered",
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      uploadedAtMs: null,
      readyAtMs: null,
      pollCount: 0,
      pollAfterMs: DEFAULT_POLL_AFTER_MS,
      failureReason: null,
      clientMediaKey: input.clientMediaKey
    };
    await postingStatePersistence.mutate((draft) => {
      draft.mediaById[media.mediaId] = media;
      draft.mediaByViewerSessionIndex[bySessionIndexKey] = media.mediaId;
      if (input.clientMediaKey) {
        draft.mediaByViewerClientKey[`${input.viewerId}:${input.clientMediaKey}`] = media.mediaId;
      }
    });
    incrementDbOps("writes", 1);
    return { media, idempotent: false };
  }

  async markMediaUploaded(input: {
    viewerId: string;
    mediaId: string;
    uploadedObjectKey: string | null;
    nowMs?: number;
  }): Promise<{ media: PostingMediaRecord; idempotent: boolean }> {
    const nowMs = input.nowMs ?? Date.now();
    incrementDbOps("queries", 1);
    const state = await postingStatePersistence.getState();
    const media = state.mediaById[input.mediaId];
    if (!media) {
      throw new PostingMutationError("media_not_found", "Posting media was not found.");
    }
    if (media.viewerId !== input.viewerId) {
      throw new PostingMutationError("media_not_owned", "Posting media does not belong to this viewer.");
    }
    if (media.state === "uploaded" || media.state === "ready") {
      return { media, idempotent: true };
    }
    media.state = "uploaded";
    media.uploadedAtMs = nowMs;
    media.updatedAtMs = nowMs;
    if (input.uploadedObjectKey && input.uploadedObjectKey.trim()) {
      media.expectedObjectKey = input.uploadedObjectKey.trim();
    }
    await postingStatePersistence.mutate((draft) => {
      draft.mediaById[media.mediaId] = media;
    });
    incrementDbOps("writes", 1);
    return { media, idempotent: false };
  }

  async getMediaStatus(input: { viewerId: string; mediaId: string; nowMs?: number }): Promise<PostingMediaRecord> {
    const nowMs = input.nowMs ?? Date.now();
    incrementDbOps("queries", 1);
    const state = await postingStatePersistence.getState();
    const media = state.mediaById[input.mediaId];
    if (!media) {
      throw new PostingMutationError("media_not_found", "Posting media was not found.");
    }
    if (media.viewerId !== input.viewerId) {
      throw new PostingMutationError("media_not_owned", "Posting media does not belong to this viewer.");
    }
    if (media.state === "uploaded") {
      media.pollCount += 1;
      if (media.pollCount >= MEDIA_READY_AFTER_POLLS) {
        media.state = "ready";
        media.readyAtMs = nowMs;
      }
      media.updatedAtMs = nowMs;
      await postingStatePersistence.mutate((draft) => {
        draft.mediaById[media.mediaId] = media;
      });
      incrementDbOps("writes", 1);
    }
    return media;
  }
}

export const postingMutationRepository = new PostingMutationRepository();
