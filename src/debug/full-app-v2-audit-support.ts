import { resetEntityCacheDebugState } from "../cache/entity-cache.js";
import { resetInFlightDedupeForTests } from "../cache/in-flight-dedupe.js";
import {
  flushBackgroundWorkForTests,
  getBackgroundWorkSnapshotForTests,
  resetBackgroundWorkForTests
} from "../lib/background-work.js";
import { diagnosticsStore } from "../observability/diagnostics-store.js";
import { mutationStateRepository } from "../repositories/mutations/mutation-state.repository.js";
import { AuthBootstrapFirestoreAdapter } from "../repositories/source-of-truth/auth-bootstrap-firestore.adapter.js";
import { ProfileFirestoreAdapter } from "../repositories/source-of-truth/profile-firestore.adapter.js";
import { chatsRepository } from "../repositories/surfaces/chats.repository.js";
import { commentsRepository } from "../repositories/surfaces/comments.repository.js";
import { notificationsRepository } from "../repositories/surfaces/notifications.repository.js";
import { clearProcessLocalCacheForTests } from "../runtime/coherence-provider.js";
import { SearchDiscoveryService } from "../services/surfaces/search-discovery.service.js";

export type AuditState = {
  viewerId: string;
  targetUserId: string | null;
  unfollowTargetUserId: string | null;
  samplePostId: string | null;
  unlikePostId: string | null;
  sampleCommentPostId: string | null;
  auditCommentPostId: string | null;
  sampleCollectionId: string | null;
  tempCollectionId: string | null;
  seedCollectionItemIds: string[] | null;
  sampleConversationId: string | null;
  sampleCommentId: string | null;
  sampleMessageId: string | null;
  sampleNotificationId: string | null;
  sampleUnreadNotificationId: string | null;
  uploadSessionId: string | null;
  mediaId: string | null;
  operationId: string | null;
  tempConversationId: string | null;
  sampleAchievementEventId: string | null;
};

export type AuditIsolationPolicy = {
  useFreshApp: boolean;
  useDedicatedCommentFixturePost: boolean;
  useFreshCollectionFixture: boolean;
  useFreshConversationFixture: boolean;
  useFreshLikedPostState: boolean;
  useFreshSavedPostState: boolean;
  useFreshFollowState: boolean;
};

const DEFAULT_POLICY: AuditIsolationPolicy = {
  useFreshApp: false,
  useDedicatedCommentFixturePost: false,
  useFreshCollectionFixture: false,
  useFreshConversationFixture: false,
  useFreshLikedPostState: false,
  useFreshSavedPostState: false,
  useFreshFollowState: false
};

const FRESH_APP_SPECS = new Set([
  "users-follow",
  "users-unfollow",
  "collections-create",
  "collections-posts-add",
  "collections-posts-remove",
  "collections-update",
  "collections-delete",
  "comments-create",
  "comments-like",
  "comments-delete",
  "notifications-mark-read",
  "notifications-mark-all-read",
  "chats-create-or-get",
  "chats-create-group",
  "chats-send-message",
  "chats-mark-read",
  "chats-mark-unread",
  "chats-delete-message",
  "chats-delete",
  "achievements-screen-opened",
  "achievements-ack-leaderboard",
  "posts-like",
  "posts-unlike",
  "posts-save",
  "posts-unsave",
  "posting-upload-session",
  "posting-media-register",
  "posting-media-mark-uploaded",
  "posting-finalize",
  "posting-operation-status"
]);
const COMMENT_FIXTURE_SPECS = new Set(["comments-create", "comments-like", "comments-delete"]);
const COLLECTION_FIXTURE_SPECS = new Set([
  "collections-posts-add",
  "collections-posts-remove",
  "collections-update",
  "collections-delete"
]);
const CONVERSATION_FIXTURE_SPECS = new Set([
  "chats-create-or-get",
  "chats-send-message",
  "chats-delete-message",
  "chats-mark-unread",
  "chats-inbox",
  "chats-delete"
]);
const FRESH_LIKED_STATE_SPECS = new Set(["posts-like", "posts-unlike"]);
const FRESH_SAVED_STATE_SPECS = new Set(["posts-save", "posts-unsave"]);
const FRESH_FOLLOW_STATE_SPECS = new Set(["users-follow", "users-unfollow"]);

export function cloneAuditState(state: AuditState): AuditState {
  return {
    ...state,
    seedCollectionItemIds: state.seedCollectionItemIds ? [...state.seedCollectionItemIds] : null
  };
}

export function getAuditIsolationPolicy(specId: string): AuditIsolationPolicy {
  return {
    ...DEFAULT_POLICY,
    useFreshApp: FRESH_APP_SPECS.has(specId),
    useDedicatedCommentFixturePost: COMMENT_FIXTURE_SPECS.has(specId),
    useFreshCollectionFixture: COLLECTION_FIXTURE_SPECS.has(specId),
    useFreshConversationFixture: CONVERSATION_FIXTURE_SPECS.has(specId),
    useFreshLikedPostState: FRESH_LIKED_STATE_SPECS.has(specId),
    useFreshSavedPostState: FRESH_SAVED_STATE_SPECS.has(specId),
    useFreshFollowState: FRESH_FOLLOW_STATE_SPECS.has(specId)
  };
}

export type AuditExecutionContext = {
  auditRunId: string;
  auditSpecId: string;
  auditSpecName: string;
};

export async function resetAuditProcessState(): Promise<void> {
  await flushBackgroundWorkForTests();
  resetBackgroundWorkForTests();
  diagnosticsStore.clear();
  resetInFlightDedupeForTests();
  resetEntityCacheDebugState();
  mutationStateRepository.resetForTests();
  AuthBootstrapFirestoreAdapter.resetCachesForTests();
  ProfileFirestoreAdapter.resetCachesForTests();
  SearchDiscoveryService.resetCachesForTests();
  commentsRepository.resetForTests();
  chatsRepository.resetForTests();
  notificationsRepository.resetForTests();
  await clearProcessLocalCacheForTests();
}

export async function settleAuditSpecState(
  audit: AuditExecutionContext,
  options: { clearMutationWarmState?: boolean } = {}
): Promise<void> {
  await flushBackgroundWorkForTests({
    auditRunId: audit.auditRunId
  });
  const snapshot = getBackgroundWorkSnapshotForTests({
    auditRunId: audit.auditRunId
  });
  if (snapshot.total > 0) {
    throw new Error(
      `orphan_background_work:${audit.auditSpecName}:${snapshot.total}:queued=${snapshot.queued}:active=${snapshot.active}`
    );
  }
  resetInFlightDedupeForTests();
  if (!options.clearMutationWarmState) {
    return;
  }
  resetEntityCacheDebugState();
  mutationStateRepository.resetForTests();
  AuthBootstrapFirestoreAdapter.resetCachesForTests();
  ProfileFirestoreAdapter.resetCachesForTests();
  SearchDiscoveryService.resetCachesForTests();
  commentsRepository.resetForTests();
  chatsRepository.resetForTests();
  notificationsRepository.resetForTests();
  await clearProcessLocalCacheForTests();
}
