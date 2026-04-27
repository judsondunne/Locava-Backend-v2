import { afterEach, describe, expect, it } from "vitest";
import { scheduleBackgroundWork, resetBackgroundWorkForTests } from "../lib/background-work.js";
import { runWithRequestContext, type RequestContext } from "../observability/request-context.js";
import {
  cloneAuditState,
  getAuditIsolationPolicy,
  settleAuditSpecState,
  type AuditState
} from "./full-app-v2-audit-support.js";

describe("full app v2 audit support", () => {
  afterEach(() => {
    resetBackgroundWorkForTests();
  });

  it("clones audit state so spec-local mutations do not leak across checks", () => {
    const base: AuditState = {
      viewerId: "viewer",
      targetUserId: "target-a",
      unfollowTargetUserId: null,
      samplePostId: "post-a",
      unlikePostId: null,
      sampleCommentPostId: "comment-post-a",
      auditCommentPostId: "audit-comment-post",
      sampleCollectionId: "collection-a",
      tempCollectionId: null,
      seedCollectionItemIds: ["post-a"],
      sampleConversationId: "conversation-a",
      sampleCommentId: null,
      sampleMessageId: null,
      sampleNotificationId: null,
      sampleUnreadNotificationId: null,
      uploadSessionId: null,
      mediaId: null,
      operationId: null,
      tempConversationId: null,
      sampleAchievementEventId: null
    };

    const isolated = cloneAuditState(base);
    isolated.targetUserId = "target-b";
    isolated.tempCollectionId = "temp-collection";
    isolated.sampleMessageId = "message-1";
    isolated.seedCollectionItemIds?.push("post-b");

    expect(base.targetUserId).toBe("target-a");
    expect(base.tempCollectionId).toBeNull();
    expect(base.sampleMessageId).toBeNull();
    expect(base.seedCollectionItemIds).toEqual(["post-a"]);
  });

  it("requires fresh deterministic fixtures for mutation-heavy specs", () => {
    expect(getAuditIsolationPolicy("comments-like")).toMatchObject({
      useFreshApp: true,
      useDedicatedCommentFixturePost: true
    });
    expect(getAuditIsolationPolicy("collections-posts-add")).toMatchObject({
      useFreshApp: true,
      useFreshCollectionFixture: true
    });
    expect(getAuditIsolationPolicy("chats-send-message")).toMatchObject({
      useFreshApp: true,
      useFreshConversationFixture: true
    });
    expect(getAuditIsolationPolicy("chats-delete")).toMatchObject({
      useFreshConversationFixture: true
    });
    expect(getAuditIsolationPolicy("posts-unlike")).toMatchObject({
      useFreshLikedPostState: true
    });
    expect(getAuditIsolationPolicy("posts-unsave")).toMatchObject({
      useFreshSavedPostState: true
    });
    expect(getAuditIsolationPolicy("users-unfollow")).toMatchObject({
      useFreshApp: true,
      useFreshFollowState: true
    });
    expect(getAuditIsolationPolicy("search-users")).toMatchObject({
      useFreshApp: false
    });
  });

  it("drains background work from earlier specs in the same audit run", async () => {
    const executions: string[] = [];
    const buildContext = (auditSpecId: string, auditSpecName: string): RequestContext => ({
      requestId: `${auditSpecId}-request`,
      route: "/test",
      method: "GET",
      startNs: 0n,
      payloadBytes: 0,
      dbOps: { reads: 0, writes: 0, queries: 0 },
      cache: { hits: 0, misses: 0 },
      dedupe: { hits: 0, misses: 0 },
      concurrency: { waits: 0 },
      entityCache: { hits: 0, misses: 0 },
      entityConstruction: { total: 0, types: {} },
      idempotency: { hits: 0, misses: 0 },
      invalidation: { keys: 0, entityKeys: 0, routeKeys: 0, types: {} },
      fallbacks: [],
      timeouts: [],
      surfaceTimings: {},
      audit: {
        auditRunId: "audit-run-1",
        auditSpecId,
        auditSpecName
      }
    });
    runWithRequestContext(buildContext("spec-a", "spec-a"), () => {
      scheduleBackgroundWork(() => {
        executions.push("previous-spec");
      }, 0);
    });
    runWithRequestContext(buildContext("spec-b", "spec-b"), () => {
      scheduleBackgroundWork(() => {
        executions.push("current-spec");
      }, 0);
    });

    await settleAuditSpecState({
      auditRunId: "audit-run-1",
      auditSpecId: "spec-b",
      auditSpecName: "spec-b"
    });

    expect(executions).toEqual(["previous-spec", "current-spec"]);
  });
});
