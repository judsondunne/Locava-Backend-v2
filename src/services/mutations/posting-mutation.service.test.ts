import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entityCacheKeys } from "../../cache/entity-cache.js";
import { globalCache } from "../../cache/global-cache.js";

function deterministicNativePostId(viewerId: string, idempotencyKey: string): string {
  return `post_${createHash("sha1").update(`${viewerId}:${idempotencyKey}`).digest("hex").slice(0, 16)}`;
}

const { enqueueVideoProcessingCloudTaskMock, triggerVideoProcessingSynchronouslyMock } = vi.hoisted(() => ({
  enqueueVideoProcessingCloudTaskMock: vi.fn().mockResolvedValue({ ok: true, taskName: "tasks/mock" }),
  triggerVideoProcessingSynchronouslyMock: vi.fn().mockResolvedValue({ ok: false, reason: "disabled_for_test" })
}));

vi.mock("../posting/video-processing-cloud-task.service.js", () => ({
  enqueueVideoProcessingCloudTask: enqueueVideoProcessingCloudTaskMock,
  triggerVideoProcessingSynchronously: triggerVideoProcessingSynchronouslyMock
}));

const finalizePostingMock = vi.fn();
const listSessionMediaMock = vi.fn();
const markOperationCompletedMock = vi.fn();
const markOperationFailedMock = vi.fn();
const processPostCreatedMock = vi.fn();

const firestoreGetMock = vi.fn();
const firestoreCreateMock = vi.fn().mockResolvedValue(undefined);
const firestoreUpdateMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../repositories/mutations/posting-mutation.repository.js", () => ({
  postingMutationRepository: {
    finalizePosting: finalizePostingMock,
    listSessionMedia: listSessionMediaMock,
    markOperationCompleted: markOperationCompletedMock,
    markOperationFailed: markOperationFailedMock,
  }
}));

vi.mock("../../repositories/source-of-truth/firestore-client.js", () => ({
  getFirestoreSourceClient: () => ({
    collection: () => ({
      doc: () => ({
        get: firestoreGetMock,
        create: firestoreCreateMock,
        update: firestoreUpdateMock,
      }),
    }),
  }),
}));

vi.mock("./posting-achievements.service.js", () => ({
  postingAchievementsService: {
    processPostCreated: processPostCreatedMock
  }
}));

describe("PostingMutationService finalize parity", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLegacyBase = process.env.LEGACY_MONOLITH_PROXY_BASE_URL;
  const originalSyncFaststartEnabled = process.env.POSTING_VIDEO_SYNC_FASTSTART_ENABLED;

  beforeEach(async () => {
    finalizePostingMock.mockReset();
    listSessionMediaMock.mockReset();
    markOperationCompletedMock.mockReset();
    markOperationFailedMock.mockReset();
    processPostCreatedMock.mockReset();
    firestoreGetMock.mockReset();
    firestoreCreateMock.mockReset();
    firestoreUpdateMock.mockReset();
    enqueueVideoProcessingCloudTaskMock.mockReset();
    triggerVideoProcessingSynchronouslyMock.mockReset();
    enqueueVideoProcessingCloudTaskMock.mockResolvedValue({ ok: true, taskName: "tasks/mock" });
    triggerVideoProcessingSynchronouslyMock.mockResolvedValue({ ok: false, reason: "disabled_for_test" });
    processPostCreatedMock.mockResolvedValue({
      xpGained: 50,
      newTotalXP: 1050,
      leveledUp: false,
      newLevel: 11,
      tier: "Explorer",
      progressBumps: [],
      weeklyCapture: null,
      newlyUnlockedBadges: [],
      uiEvents: ["XP_TOAST"],
      competitiveBadgeUnlocks: [],
      postSuccessMessage: null
    });

    process.env.NODE_ENV = "development";
    process.env.LEGACY_MONOLITH_PROXY_BASE_URL = "http://legacy.test";
    process.env.POSTING_VIDEO_SYNC_FASTSTART_ENABLED = "0";
    await globalCache.del(entityCacheKeys.userFirestoreDoc("viewer-1"));
    await globalCache.del(entityCacheKeys.userSummary("viewer-1"));
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.LEGACY_MONOLITH_PROXY_BASE_URL = originalLegacyBase;
    process.env.POSTING_VIDEO_SYNC_FASTSTART_ENABLED = originalSyncFaststartEnabled;
    vi.unstubAllGlobals();
  });

  it("publishes native canonical post using staged manifest (no monolith create-from-staged)", async () => {
    finalizePostingMock.mockResolvedValue({
      session: {
        sessionId: "ups_live_1",
        viewerId: "viewer-1",
        clientSessionKey: "client-session-key",
        mediaCountHint: 1,
        createdAtMs: 1,
        expiresAtMs: 2,
        state: "finalized",
      },
      operation: {
        operationId: "pop_live_1",
        viewerId: "viewer-1",
        sessionId: "ups_live_1",
        postId: "",
        idempotencyKey: "idem-live-1",
        createdAtMs: 1,
        updatedAtMs: 1,
        state: "processing",
        pollCount: 0,
        pollAfterMs: 1500,
        terminalReason: "processing",
        retryCount: 0,
        completionInvalidatedAtMs: null,
      },
      idempotent: false,
    });
    listSessionMediaMock.mockResolvedValue([
      {
        mediaId: "pmd_live_1",
        viewerId: "viewer-1",
        sessionId: "ups_live_1",
        assetIndex: 0,
        assetType: "video",
        expectedObjectKey: "videos/video_legacy_0.mp4",
        state: "uploaded",
        createdAtMs: 1,
        updatedAtMs: 1,
        uploadedAtMs: 1,
        readyAtMs: null,
        pollCount: 0,
        pollAfterMs: 1500,
        failureReason: null,
        clientMediaKey: "media-1",
      },
    ]);
    markOperationCompletedMock.mockImplementation(async ({ operationId, postId }) => ({
      operationId,
      viewerId: "viewer-1",
      sessionId: "ups_live_1",
      postId,
      idempotencyKey: "idem-live-1",
      createdAtMs: 1,
      updatedAtMs: 2,
      state: "processing",
      pollCount: 0,
      pollAfterMs: 1500,
      terminalReason: "processing",
      retryCount: 0,
      completionInvalidatedAtMs: null,
    }));
    const userSnap = {
      exists: true,
      data: () => ({
        handle: "live",
        name: "Live User",
        profilePic: "https://cdn.example.com/u.jpg",
      }),
    };
    const postSnap = {
      exists: true,
      data: () => ({
        assetsReady: false,
        videoProcessingStatus: "processing",
        instantPlaybackReady: false,
        carouselFitWidth: true,
        letterboxGradients: [{ top: "#1f2937", bottom: "#111827" }],
        assets: [
          {
            id: "video_legacy_0",
            type: "video",
            original: "https://cdn.example.com/video.mp4",
            poster: "https://cdn.example.com/poster.jpg",
            variants: {
              poster: "https://cdn.example.com/poster.jpg",
            },
          },
        ],
      }),
    };
    let firestoreReads = 0;
    firestoreGetMock.mockImplementation(() => {
      firestoreReads += 1;
      if (firestoreReads === 1) return Promise.resolve(userSnap);
      return Promise.resolve(postSnap);
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { PostingMutationService } = await import("./posting-mutation.service.js");
    const service = new PostingMutationService();
    const result = await service.finalizePosting({
      viewerId: "viewer-1",
      sessionId: "ups_live_1",
      stagedSessionId: "stage_live_1",
      stagedItems: [
        {
          index: 0,
          assetType: "video",
          assetId: "video_legacy_0",
          originalKey: "videos/video_legacy_0.mp4",
          originalUrl: "https://cdn.example.com/video.mp4",
          posterKey: "videos/video_legacy_0_poster.jpg",
          posterUrl: "https://cdn.example.com/poster.jpg",
        },
      ],
      idempotencyKey: "idem-live-1",
      mediaCount: 1,
      userId: "viewer-1",
      title: "Parity title",
      content: "Parity content",
      activities: ["hike"],
      lat: 40.7,
      long: -74.0,
      address: "New York, NY",
      privacy: "Public Spot",
      texts: [{ value: "hello" }],
      recordings: [{ id: "r1" }],
      displayPhotoBase64: "abc123base64",
      videoPostersBase64: ["poster64"],
      authorizationHeader: "Bearer token-live-1",
    });

    const expectedPostId = deterministicNativePostId("viewer-1", "idem-live-1");

    expect(result.canonicalCreated).toBe(true);
    expect(result.operation.postId).toBe(expectedPostId);
    expect(result.achievementDelta?.xpGained).toBe(50);
    expect(processPostCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: expectedPostId,
        userId: "viewer-1",
        requestAward: true
      })
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(firestoreCreateMock).toHaveBeenCalled();
    const created = firestoreCreateMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const assets = created.assets as Array<{ original?: string; poster?: string }>;
    expect(assets[0]?.original).toBe("https://cdn.example.com/video.mp4");
    expect(assets[0]?.poster).toBe("https://cdn.example.com/poster.jpg");
  });

  it("writes native rich post via Firestore when legacy proxy is not enabled", async () => {
    process.env.LEGACY_MONOLITH_PROXY_BASE_URL = "http://legacy.test";

    finalizePostingMock.mockResolvedValue({
      session: {
        sessionId: "ups_native",
        viewerId: "viewer-1",
        clientSessionKey: "k",
        mediaCountHint: 1,
        createdAtMs: 1,
        expiresAtMs: 2,
        state: "finalized",
      },
      operation: {
        operationId: "pop_native",
        viewerId: "viewer-1",
        sessionId: "ups_native",
        postId: "",
        idempotencyKey: "idem-native",
        createdAtMs: 1,
        updatedAtMs: 1,
        state: "processing",
        pollCount: 0,
        pollAfterMs: 1500,
        terminalReason: "processing",
        retryCount: 0,
        completionInvalidatedAtMs: null,
      },
      idempotent: false,
    });
    listSessionMediaMock.mockResolvedValue([
      {
        mediaId: "pmd_native",
        viewerId: "viewer-1",
        sessionId: "ups_native",
        assetIndex: 0,
        assetType: "video",
        expectedObjectKey: "videos/video_native_0.mp4",
        state: "uploaded",
        createdAtMs: 1,
        updatedAtMs: 1,
        uploadedAtMs: 1,
        readyAtMs: null,
        pollCount: 0,
        pollAfterMs: 1500,
        failureReason: null,
        clientMediaKey: "m1",
      },
    ]);
    markOperationCompletedMock.mockImplementation(async ({ operationId, postId }) => ({
      operationId,
      viewerId: "viewer-1",
      sessionId: "ups_native",
      postId,
      idempotencyKey: "idem-native",
      createdAtMs: 1,
      updatedAtMs: 2,
      state: "processing",
      pollCount: 0,
      pollAfterMs: 1500,
      terminalReason: "processing",
      retryCount: 0,
      completionInvalidatedAtMs: null,
    }));
    const userSnap = {
      exists: true,
      data: () => ({
        handle: "native",
        name: "Native User",
        profilePic: "https://cdn.example.com/u.jpg",
      }),
    };
    const postSnap = {
      exists: true,
      data: () => ({
        assetsReady: false,
        videoProcessingStatus: "processing",
        instantPlaybackReady: false,
        carouselFitWidth: true,
        letterboxGradients: [{ top: "#1f2937", bottom: "#111827" }],
        assets: [
          {
            id: "video_native_0",
            type: "video",
            original: "https://cdn.example.com/native.mp4",
            poster: "https://cdn.example.com/native_poster.jpg",
            thumbnail: "https://cdn.example.com/native_poster.jpg",
            variants: {
              poster: "https://cdn.example.com/native_poster.jpg",
            },
          },
        ],
      }),
    };
    let firestoreReads = 0;
    firestoreGetMock.mockImplementation(() => {
      firestoreReads += 1;
      if (firestoreReads === 1) return Promise.resolve(userSnap);
      return Promise.resolve(postSnap);
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { PostingMutationService } = await import("./posting-mutation.service.js");
    const service = new PostingMutationService();
    const result = await service.finalizePosting({
      viewerId: "viewer-1",
      sessionId: "ups_native",
      stagedSessionId: "stage_native",
      stagedItems: [
        {
          index: 0,
          assetType: "video",
          assetId: "video_native_0",
          originalKey: "videos/video_native_0.mp4",
          originalUrl: "https://cdn.example.com/native.mp4",
          posterKey: "videos/video_native_0_poster.jpg",
          posterUrl: "https://cdn.example.com/native_poster.jpg",
        },
      ],
      idempotencyKey: "idem-native",
      mediaCount: 1,
      userId: "viewer-1",
    });

    expect(result.operation.postId.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(firestoreCreateMock).toHaveBeenCalled();
    const created = firestoreCreateMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(created.assetsReady).toBe(false);
    expect(created.videoProcessingStatus).toBe("pending");
    const assets = created.assets as Array<{ type: string; variants: Record<string, string> }>;
    expect(assets[0]?.variants?.main720).toBeUndefined();
    expect(created.instantPlaybackReady).toBe(false);
    expect(enqueueVideoProcessingCloudTaskMock).toHaveBeenCalled();
    expect(firestoreUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        videoProcessingStatus: "processing",
        videoProcessingProgress: { totalVideos: 1, processedVideos: 0 }
      })
    );
    expect(result.mediaReadiness).toMatchObject({
      mediaStatus: "processing",
      assetsReady: false,
      playbackReady: false,
      posterReady: true,
      playbackUrlPresent: false,
      fallbackVideoUrl: "https://cdn.example.com/native.mp4",
      resizeMode: "contain",
    });
  });
});
