import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const finalizePostingMock = vi.fn();
const listSessionMediaMock = vi.fn();
const markOperationCompletedMock = vi.fn();
const markOperationFailedMock = vi.fn();
const processPostCreatedMock = vi.fn();

const firestoreGetMock = vi.fn();

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
  const originalForceLegacyProxy = process.env.POSTING_FINALIZE_FORCE_LEGACY_PROXY;

  beforeEach(() => {
    finalizePostingMock.mockReset();
    listSessionMediaMock.mockReset();
    markOperationCompletedMock.mockReset();
    markOperationFailedMock.mockReset();
    processPostCreatedMock.mockReset();
    firestoreGetMock.mockReset();
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
    process.env.POSTING_FINALIZE_FORCE_LEGACY_PROXY = "1";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.LEGACY_MONOLITH_PROXY_BASE_URL = originalLegacyBase;
    process.env.POSTING_FINALIZE_FORCE_LEGACY_PROXY = originalForceLegacyProxy;
    vi.unstubAllGlobals();
  });

  it("forwards staged manifest/extras to legacy create-from-staged and verifies public urls", async () => {
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
    firestoreGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        displayPhotoLink: "https://cdn.example.com/poster.jpg",
        assets: [
          {
            id: "video_legacy_0",
            type: "video",
            original: "https://cdn.example.com/video.mp4",
            poster: "https://cdn.example.com/poster.jpg",
          },
        ],
      }),
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "http://legacy.test/api/v1/product/upload/create-from-staged") {
        return new Response(
          JSON.stringify({
            success: true,
            postId: "post_live_1",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      if (url.startsWith("https://cdn.example.com/")) {
        expect(init?.method).toBe("HEAD");
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });
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

    expect(result.canonicalCreated).toBe(true);
    expect(result.operation.postId).toBe("post_live_1");
    expect(result.achievementDelta?.xpGained).toBe(50);
    expect(processPostCreatedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: "post_live_1",
        userId: "viewer-1",
        requestAward: true
      })
    );

    expect(fetchMock).toHaveBeenCalled();
    const createRequest = fetchMock.mock.calls.find(
      ([url]) => url === "http://legacy.test/api/v1/product/upload/create-from-staged"
    );
    expect(createRequest).toBeTruthy();
    const createBody = JSON.parse(String(createRequest?.[1]?.body ?? "{}")) as Record<string, unknown>;
    expect(createBody.sessionId).toBe("stage_live_1");
    expect(createBody.displayPhotoBase64).toBe("abc123base64");
    expect(createBody.videoPostersBase64).toEqual(["poster64"]);
    expect(createBody.stagedItems).toEqual([
      {
        index: 0,
        assetType: "video",
        assetId: "video_legacy_0",
        originalKey: "videos/video_legacy_0.mp4",
        originalUrl: "https://cdn.example.com/video.mp4",
        posterKey: "videos/video_legacy_0_poster.jpg",
        posterUrl: "https://cdn.example.com/poster.jpg",
      },
    ]);
  });
});
