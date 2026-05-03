import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../app/createApp.js";

describe("v2 posting/upload first slice", () => {
  const app = createApp({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    ENABLE_LEGACY_COMPAT_ROUTES: true
  });
  const viewerHeaders = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal"
  };

  async function createReadyUploadSession(unique: string, clientSessionKey: string): Promise<string> {
    const create = await app.inject({
      method: "POST",
      url: "/v2/posting/upload-session",
      headers: viewerHeaders,
      payload: {
        clientSessionKey,
        mediaCountHint: 1
      }
    });
    expect(create.statusCode).toBe(200);
    const sessionId = create.json().data.uploadSession.sessionId as string;

    const register = await app.inject({
      method: "POST",
      url: "/v2/posting/media/register",
      headers: viewerHeaders,
      payload: {
        sessionId,
        assetIndex: 0,
        assetType: "photo",
        clientMediaKey: `media-${unique}`
      }
    });
    expect(register.statusCode).toBe(200);
    const mediaId = register.json().data.media.mediaId as string;

    const markUploaded = await app.inject({
      method: "POST",
      url: `/v2/posting/media/${encodeURIComponent(mediaId)}/mark-uploaded`,
      headers: viewerHeaders,
      payload: {}
    });
    expect(markUploaded.statusCode).toBe(200);
    return sessionId;
  }

  it("rejects non-internal posting requests", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v2/posting/upload-session",
      payload: {
        clientSessionKey: "client-session-001",
        mediaCountHint: 1
      }
    });
    expect(res.statusCode).toBe(403);
  });

  it("serves places-only location autofill for the posting location setter", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/posting/location/suggest?q=${encodeURIComponent("new")}&limit=8`,
      headers: viewerHeaders
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as { routeName: string; suggestions: Array<Record<string, unknown>> };
    expect(data.routeName).toBe("posting.location_suggest.get");
    expect(Array.isArray(data.suggestions)).toBe(true);
    expect(data.suggestions.length).toBeGreaterThan(0);
    for (const row of data.suggestions.slice(0, 4)) {
      expect(row.suggestionType).toBe("place");
      expect(["town", "state"]).toContain(String(row.type));
      const d = (row.data ?? {}) as Record<string, unknown>;
      expect(typeof d.stateRegionId).toBe("string");
      expect(typeof d.stateName).toBe("string");
      expect(typeof d.locationText).toBe("string");
    }
  });

  it("serves songs for the posting song picker", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v2/posting/songs?page=1&limit=5&search=${encodeURIComponent("mock")}`,
      headers: viewerHeaders
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as {
      routeName: string;
      audio: Array<Record<string, unknown>>;
      total: number;
      page: number;
      limit: number;
    };
    expect(data.routeName).toBe("posting.songs.get");
    expect(Array.isArray(data.audio)).toBe(true);
    expect(data.audio.length).toBeGreaterThan(0);
    expect(typeof data.audio[0]?.id).toBe("string");
    expect(typeof data.audio[0]?.nameOfSong).toBe("string");
    expect(typeof data.total).toBe("number");
    expect(data.page).toBe(1);
    expect(data.limit).toBe(5);
  });

  it("creates upload session with idempotent replay on duplicate key", async () => {
    const unique = randomUUID().slice(0, 8);
    const payload = {
      clientSessionKey: `client-session-abc123-${unique}`,
      mediaCountHint: 2
    };
    const first = await app.inject({
      method: "POST",
      url: "/v2/posting/upload-session",
      headers: viewerHeaders,
      payload
    });
    const second = await app.inject({
      method: "POST",
      url: "/v2/posting/upload-session",
      headers: viewerHeaders,
      payload
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const firstBody = first.json();
    const secondBody = second.json();
    expect(firstBody.data.routeName).toBe("posting.uploadsession.post");
    expect(firstBody.data.idempotency.replayed).toBe(false);
    expect(secondBody.data.idempotency.replayed).toBe(true);
    expect(secondBody.data.uploadSession.sessionId).toBe(firstBody.data.uploadSession.sessionId);
  });

  it("reuses presign for same user + clientStagingKey", async () => {
    process.env.WASABI_ACCESS_KEY_ID = process.env.WASABI_ACCESS_KEY_ID ?? "test-access";
    process.env.WASABI_SECRET_ACCESS_KEY = process.env.WASABI_SECRET_ACCESS_KEY ?? "test-secret";
    process.env.WASABI_ENDPOINT = process.env.WASABI_ENDPOINT ?? "https://s3.us-east-1.wasabisys.com";
    process.env.WASABI_BUCKET_NAME = process.env.WASABI_BUCKET_NAME ?? "locava.app";
    const sessionId = `ps-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const clientStagingKey = `asset://${randomUUID()}`;
    const payload = {
      sessionId,
      items: [{ index: 0, assetType: "video" as const, clientStagingKey }],
    };
    const first = await app.inject({
      method: "POST",
      url: "/v2/posting/staging/presign",
      headers: viewerHeaders,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/v2/posting/staging/presign",
      headers: viewerHeaders,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const firstUrl = first.json().data.urls[0].uploadUrl as string;
    const secondUrl = second.json().data.urls[0].uploadUrl as string;
    const firstKey = first.json().data.urls[0].originalKey as string;
    const secondKey = second.json().data.urls[0].originalKey as string;
    expect(secondUrl).toBe(firstUrl);
    expect(secondKey).toBe(firstKey);

    const diagnostics = await app.inject({
      method: "GET",
      url: "/diagnostics?limit=80",
    });
    expect(diagnostics.statusCode).toBe(200);
    const rows = diagnostics.json().data.recentRequests as Array<{
      routeName?: string;
      idempotency?: { hits?: number };
    }>;
    const row = rows.find((item) => item.routeName === "posting.stagingpresign.post");
    expect((row?.idempotency?.hits ?? 0) >= 1).toBe(true);
  });

  it("creates new presign session for different clientStagingKey", async () => {
    process.env.WASABI_ACCESS_KEY_ID = process.env.WASABI_ACCESS_KEY_ID ?? "test-access";
    process.env.WASABI_SECRET_ACCESS_KEY = process.env.WASABI_SECRET_ACCESS_KEY ?? "test-secret";
    const sessionId = `ps-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const first = await app.inject({
      method: "POST",
      url: "/v2/posting/staging/presign",
      headers: viewerHeaders,
      payload: {
        sessionId,
        items: [{ index: 0, assetType: "video", clientStagingKey: `asset://${randomUUID()}` }],
      },
    });
    const second = await app.inject({
      method: "POST",
      url: "/v2/posting/staging/presign",
      headers: viewerHeaders,
      payload: {
        sessionId,
        items: [{ index: 0, assetType: "video", clientStagingKey: `asset://${randomUUID()}` }],
      },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const firstUrl = first.json().data.urls[0].uploadUrl as string;
    const secondUrl = second.json().data.urls[0].uploadUrl as string;
    expect(secondUrl).not.toBe(firstUrl);
  });

  it("presign loop guard reuses existing object key", async () => {
    process.env.WASABI_ACCESS_KEY_ID = process.env.WASABI_ACCESS_KEY_ID ?? "test-access";
    process.env.WASABI_SECRET_ACCESS_KEY = process.env.WASABI_SECRET_ACCESS_KEY ?? "test-secret";
    const sessionId = `ps-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const clientStagingKey = `asset://${randomUUID()}`;
    let baselineKey = "";
    for (let i = 0; i < 7; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/v2/posting/staging/presign",
        headers: viewerHeaders,
        payload: {
          sessionId,
          items: [{ index: 0, assetType: "video", clientStagingKey }],
        },
      });
      expect(res.statusCode).toBe(200);
      const key = String(res.json().data.urls[0].originalKey ?? "");
      if (!baselineKey) baselineKey = key;
      expect(key).toBe(baselineKey);
    }
  });

  it("finalizes once and replays duplicate finalize idempotently", async () => {
    const unique = randomUUID().slice(0, 8);
    const sessionId = await createReadyUploadSession(unique, `client-session-finalize-001-${unique}`);

    const finalizePayload = {
      sessionId,
      idempotencyKey: `posting-idempotency-001-${unique}`,
      mediaCount: 1
    };

    const firstFinalize = await app.inject({
      method: "POST",
      url: "/v2/posting/finalize",
      headers: viewerHeaders,
      payload: finalizePayload
    });
    const secondFinalize = await app.inject({
      method: "POST",
      url: "/v2/posting/finalize",
      headers: viewerHeaders,
      payload: finalizePayload
    });

    expect(firstFinalize.statusCode).toBe(200);
    expect(secondFinalize.statusCode).toBe(200);
    const first = firstFinalize.json().data;
    const second = secondFinalize.json().data;
    expect(first.routeName).toBe("posting.finalize.post");
    expect(first.idempotency.replayed).toBe(false);
    expect(second.idempotency.replayed).toBe(true);
    expect(second.operation.operationId).toBe(first.operation.operationId);
    expect(second.postId).toBe(first.postId);
  });

  it("finalize postId is immediately readable via /api/posts/:postId", async () => {
    const unique = randomUUID().slice(0, 8);
    const create = await app.inject({
      method: "POST",
      url: "/v2/posting/upload-session",
      headers: viewerHeaders,
      payload: {
        clientSessionKey: `client-session-finalize-poll-${unique}`,
        mediaCountHint: 1
      }
    });
    expect(create.statusCode).toBe(200);
    const sessionId = create.json().data.uploadSession.sessionId as string;

    const register = await app.inject({
      method: "POST",
      url: "/v2/posting/media/register",
      headers: viewerHeaders,
      payload: {
        sessionId,
        assetIndex: 0,
        assetType: "photo",
        clientMediaKey: `media-${unique}`
      }
    });
    expect(register.statusCode).toBe(200);
    const mediaId = register.json().data.media.mediaId as string;

    const markUploaded = await app.inject({
      method: "POST",
      url: `/v2/posting/media/${encodeURIComponent(mediaId)}/mark-uploaded`,
      headers: viewerHeaders,
      payload: {}
    });
    expect(markUploaded.statusCode).toBe(200);

    const finalize = await app.inject({
      method: "POST",
      url: "/v2/posting/finalize",
      headers: viewerHeaders,
      payload: {
        sessionId,
        idempotencyKey: `posting-idempotency-finalize-poll-${unique}`,
        mediaCount: 1
      }
    });
    expect(finalize.statusCode).toBe(200);
    const postId = String(finalize.json().data.postId ?? "");
    expect(postId.length).toBeGreaterThan(0);

    const poll = await app.inject({
      method: "GET",
      url: `/api/posts/${encodeURIComponent(postId)}`,
      headers: viewerHeaders
    });
    expect(poll.statusCode).toBe(200);
    const body = poll.json() as {
      success?: boolean;
      post?: { postId?: string };
      postData?: { postId?: string };
    };
    expect(body.success).toBe(true);
    expect(body.post?.postId).toBe(postId);
    expect(body.postData?.postId).toBe(postId);
    const postRow = (body.postData ?? {}) as Record<string, unknown>;
    const diagnostics = (body as { diagnostics?: { source?: string } }).diagnostics;
    if (diagnostics?.source === "posts_collection") {
      expect(typeof postRow["time"]).toBe("number");
      expect(typeof postRow["time-created"]).toBe("number");
      expect(typeof postRow["createdAt"]).toBe("number");
      expect("lastUpdated" in postRow).toBe(true);
      expect(typeof postRow["geohash"]).toBe("string");
      expect(typeof postRow["cityRegionId"]).toBe("string");
      expect(typeof postRow["countryRegionId"]).toBe("string");
      expect(typeof postRow["geoData"]).toBe("object");
      expect(postRow["assetsReady"]).toBe(true);
      const displayPhotoLink = String(postRow["displayPhotoLink"] ?? "");
      expect(displayPhotoLink.includes("postSessionStaging")).toBe(false);
    }
  });

  it("supports bounded status polling and converges to completed", async () => {
    const unique = randomUUID().slice(0, 8);
    const sessionId = await createReadyUploadSession(unique, `client-session-status-001-${unique}`);

    const finalize = await app.inject({
      method: "POST",
      url: "/v2/posting/finalize",
      headers: viewerHeaders,
      payload: {
        sessionId,
        idempotencyKey: `posting-idempotency-status-001-${unique}`,
        mediaCount: 1
      }
    });
    const operationId = finalize.json().data.operation.operationId as string;

    const statusA = await app.inject({
      method: "GET",
      url: `/v2/posting/operations/${encodeURIComponent(operationId)}`,
      headers: viewerHeaders
    });
    const statusB = await app.inject({
      method: "GET",
      url: `/v2/posting/operations/${encodeURIComponent(operationId)}`,
      headers: viewerHeaders
    });

    expect(statusA.statusCode).toBe(200);
    expect(statusB.statusCode).toBe(200);
    const stateA = statusA.json().data.operation.state as string;
    const stateB = statusB.json().data.operation.state as string;
    expect(["processing", "completed"]).toContain(stateA);
    expect(stateB).toBe("completed");
    expect(statusB.json().data.polling.shouldPoll).toBe(false);
    expect(statusB.json().data.invalidation.applied).toBe(true);
  });

  it("applies completion invalidation even before the first client status poll", async () => {
    const unique = randomUUID().slice(0, 8);
    const sessionId = await createReadyUploadSession(unique, `client-session-background-complete-${unique}`);
    const finalize = await app.inject({
      method: "POST",
      url: "/v2/posting/finalize",
      headers: viewerHeaders,
      payload: {
        sessionId,
        idempotencyKey: `posting-idempotency-background-complete-${unique}`,
        mediaCount: 1
      }
    });
    const operationId = finalize.json().data.operation.operationId as string;

    await new Promise((resolve) => setTimeout(resolve, 2200));
    const status = await app.inject({
      method: "GET",
      url: `/v2/posting/operations/${encodeURIComponent(operationId)}`,
      headers: viewerHeaders
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().data.operation.state).toBe("completed");
    expect(status.json().data.invalidation.applied).toBe(true);
  });

  it("exposes posting route policy and diagnostics metadata", async () => {
    const unique = randomUUID().slice(0, 8);
    await app.inject({
      method: "POST",
      url: "/v2/posting/upload-session",
      headers: viewerHeaders,
      payload: {
        clientSessionKey: `client-session-diag-001-${unique}`,
        mediaCountHint: 1
      }
    });

    const diagnostics = await app.inject({
      method: "GET",
      url: "/diagnostics?limit=40"
    });

    expect(diagnostics.statusCode).toBe(200);
    const rows = diagnostics.json().data.recentRequests as Array<{
      routeName?: string;
      routePolicy?: { routeName: string; priority: string };
      idempotency?: { hits: number; misses: number };
      dedupe?: { hits: number; misses: number };
      budgetViolations?: string[];
    }>;
    const row = rows.find((item) => item.routeName === "posting.uploadsession.post");
    expect(row).toBeTruthy();
    expect(row?.routePolicy?.routeName).toBe("posting.uploadsession.post");
    expect(typeof row?.idempotency?.hits).toBe("number");
    expect(typeof row?.idempotency?.misses).toBe("number");
    expect(typeof row?.dedupe?.hits).toBe("number");
    expect(typeof row?.dedupe?.misses).toBe("number");
    expect(Array.isArray(row?.budgetViolations)).toBe(true);
  });

  it("cancel succeeds, repeated cancel is idempotent, and completed cancel is rejected", async () => {
    const unique = randomUUID().slice(0, 8);
    const sessionId = await createReadyUploadSession(unique, `client-session-cancel-001-${unique}`);
    const finalize = await app.inject({
      method: "POST",
      url: "/v2/posting/finalize",
      headers: viewerHeaders,
      payload: {
        sessionId,
        idempotencyKey: `posting-idempotency-cancel-001-${unique}`,
        mediaCount: 1
      }
    });
    const operationId = finalize.json().data.operation.operationId as string;

    const cancelA = await app.inject({
      method: "POST",
      url: `/v2/posting/operations/${encodeURIComponent(operationId)}/cancel`,
      headers: viewerHeaders
    });
    const cancelB = await app.inject({
      method: "POST",
      url: `/v2/posting/operations/${encodeURIComponent(operationId)}/cancel`,
      headers: viewerHeaders
    });
    expect(cancelA.statusCode).toBe(200);
    expect(cancelB.statusCode).toBe(200);
    expect(cancelA.json().data.operation.state).toBe("cancelled");
    expect(cancelB.json().data.idempotency.replayed).toBe(true);

    const completedSession = await createReadyUploadSession(unique, `client-session-cancel-completed-001-${unique}`);
    const completedFinalize = await app.inject({
      method: "POST",
      url: "/v2/posting/finalize",
      headers: viewerHeaders,
      payload: {
        sessionId: completedSession,
        idempotencyKey: `posting-idempotency-cancel-completed-001-${unique}`,
        mediaCount: 1
      }
    });
    const completedOperationId = completedFinalize.json().data.operation.operationId as string;
    await app.inject({
      method: "GET",
      url: `/v2/posting/operations/${encodeURIComponent(completedOperationId)}`,
      headers: viewerHeaders
    });
    await app.inject({
      method: "GET",
      url: `/v2/posting/operations/${encodeURIComponent(completedOperationId)}`,
      headers: viewerHeaders
    });
    const cancelCompleted = await app.inject({
      method: "POST",
      url: `/v2/posting/operations/${encodeURIComponent(completedOperationId)}/cancel`,
      headers: viewerHeaders
    });
    expect(cancelCompleted.statusCode).toBe(409);
  });

  it("retry succeeds from cancelled, repeated retry is idempotent, and completed retry is rejected", async () => {
    const unique = randomUUID().slice(0, 8);
    const sessionId = await createReadyUploadSession(unique, `client-session-retry-001-${unique}`);
    const finalize = await app.inject({
      method: "POST",
      url: "/v2/posting/finalize",
      headers: viewerHeaders,
      payload: {
        sessionId,
        idempotencyKey: `posting-idempotency-retry-001-${unique}`,
        mediaCount: 1
      }
    });
    const operationId = finalize.json().data.operation.operationId as string;
    await app.inject({
      method: "POST",
      url: `/v2/posting/operations/${encodeURIComponent(operationId)}/cancel`,
      headers: viewerHeaders
    });

    const retryA = await app.inject({
      method: "POST",
      url: `/v2/posting/operations/${encodeURIComponent(operationId)}/retry`,
      headers: viewerHeaders
    });
    const retryB = await app.inject({
      method: "POST",
      url: `/v2/posting/operations/${encodeURIComponent(operationId)}/retry`,
      headers: viewerHeaders
    });
    expect(retryA.statusCode).toBe(200);
    expect(retryA.json().data.operation.state).toBe("processing");
    expect(retryB.statusCode).toBe(200);
    expect(retryB.json().data.idempotency.replayed).toBe(true);
    expect(retryB.json().data.operation.postId).toBe(retryA.json().data.operation.postId);

    const completedSession = await createReadyUploadSession(unique, `client-session-retry-completed-001-${unique}`);
    const completedFinalize = await app.inject({
      method: "POST",
      url: "/v2/posting/finalize",
      headers: viewerHeaders,
      payload: {
        sessionId: completedSession,
        idempotencyKey: `posting-idempotency-retry-completed-001-${unique}`,
        mediaCount: 1
      }
    });
    const completedOperationId = completedFinalize.json().data.operation.operationId as string;
    await app.inject({
      method: "GET",
      url: `/v2/posting/operations/${encodeURIComponent(completedOperationId)}`,
      headers: viewerHeaders
    });
    await app.inject({
      method: "GET",
      url: `/v2/posting/operations/${encodeURIComponent(completedOperationId)}`,
      headers: viewerHeaders
    });
    const retryCompleted = await app.inject({
      method: "POST",
      url: `/v2/posting/operations/${encodeURIComponent(completedOperationId)}/retry`,
      headers: viewerHeaders
    });
    expect(retryCompleted.statusCode).toBe(409);
  });
});
