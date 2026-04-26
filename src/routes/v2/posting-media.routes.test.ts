import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../app/createApp.js";

describe("v2 posting media preservation slice", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const viewerHeaders = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal"
  };

  it("registers media idempotently with repeated registration", async () => {
    const unique = randomUUID().slice(0, 8);
    const sessionRes = await app.inject({
      method: "POST",
      url: "/v2/posting/upload-session",
      headers: viewerHeaders,
      payload: { clientSessionKey: `media-session-${unique}`, mediaCountHint: 1 }
    });
    const sessionId = sessionRes.json().data.uploadSession.sessionId as string;

    const registerPayload = {
      sessionId,
      assetIndex: 0,
      assetType: "video",
      clientMediaKey: `client-media-${unique}`
    };
    const first = await app.inject({
      method: "POST",
      url: "/v2/posting/media/register",
      headers: viewerHeaders,
      payload: registerPayload
    });
    const second = await app.inject({
      method: "POST",
      url: "/v2/posting/media/register",
      headers: viewerHeaders,
      payload: registerPayload
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().data.idempotency.replayed).toBe(false);
    expect(second.json().data.idempotency.replayed).toBe(true);
    expect(second.json().data.media.mediaId).toBe(first.json().data.media.mediaId);
    expect(String(first.json().data.media.expectedObjectKey)).toMatch(/^videos\//);
    expect(String(first.json().data.media.expectedObjectKey)).not.toContain("postSessionStaging");
    expect(first.json().data.upload.binaryUploadThroughApi).toBe(false);
  });

  it("marks uploaded idempotently and status polling remains bounded", async () => {
    const unique = randomUUID().slice(0, 8);
    const sessionRes = await app.inject({
      method: "POST",
      url: "/v2/posting/upload-session",
      headers: viewerHeaders,
      payload: { clientSessionKey: `media-session-uploaded-${unique}`, mediaCountHint: 1 }
    });
    const sessionId = sessionRes.json().data.uploadSession.sessionId as string;
    const registerRes = await app.inject({
      method: "POST",
      url: "/v2/posting/media/register",
      headers: viewerHeaders,
      payload: {
        sessionId,
        assetIndex: 0,
        assetType: "photo",
        clientMediaKey: `client-photo-${unique}`
      }
    });
    const mediaId = registerRes.json().data.media.mediaId as string;
    const expectedObjectKey = registerRes.json().data.media.expectedObjectKey as string;

    const markA = await app.inject({
      method: "POST",
      url: `/v2/posting/media/${encodeURIComponent(mediaId)}/mark-uploaded`,
      headers: viewerHeaders,
      payload: { uploadedObjectKey: expectedObjectKey }
    });
    const markB = await app.inject({
      method: "POST",
      url: `/v2/posting/media/${encodeURIComponent(mediaId)}/mark-uploaded`,
      headers: viewerHeaders,
      payload: { uploadedObjectKey: expectedObjectKey }
    });
    expect(markA.statusCode).toBe(200);
    expect(markB.statusCode).toBe(200);
    expect(markA.json().data.idempotency.replayed).toBe(false);
    expect(markB.json().data.idempotency.replayed).toBe(true);

    const statusA = await app.inject({
      method: "GET",
      url: `/v2/posting/media/${encodeURIComponent(mediaId)}/status`,
      headers: viewerHeaders
    });
    const statusB = await app.inject({
      method: "GET",
      url: `/v2/posting/media/${encodeURIComponent(mediaId)}/status`,
      headers: viewerHeaders
    });
    expect(statusA.statusCode).toBe(200);
    expect(statusB.statusCode).toBe(200);
    expect(["uploaded", "ready"]).toContain(statusA.json().data.media.state);
    expect(statusB.json().data.media.state).toBe("ready");
    expect(statusB.json().data.polling.shouldPoll).toBe(false);
  });

  it("exposes diagnostics with route policy/idempotency/dedupe for media routes", async () => {
    const unique = randomUUID().slice(0, 8);
    const sessionRes = await app.inject({
      method: "POST",
      url: "/v2/posting/upload-session",
      headers: viewerHeaders,
      payload: { clientSessionKey: `media-session-diag-${unique}`, mediaCountHint: 1 }
    });
    const sessionId = sessionRes.json().data.uploadSession.sessionId as string;
    await app.inject({
      method: "POST",
      url: "/v2/posting/media/register",
      headers: viewerHeaders,
      payload: {
        sessionId,
        assetIndex: 0,
        assetType: "photo",
        clientMediaKey: `client-media-diag-${unique}`
      }
    });
    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=60" });
    expect(diagnostics.statusCode).toBe(200);
    const rows = diagnostics.json().data.recentRequests as Array<{
      routeName?: string;
      routePolicy?: { routeName: string };
      idempotency?: { hits: number; misses: number };
      dedupe?: { hits: number; misses: number };
      budgetViolations?: string[];
    }>;
    const row = rows.find((item) => item.routeName === "posting.mediaregister.post");
    expect(row).toBeTruthy();
    expect(row?.routePolicy?.routeName).toBe("posting.mediaregister.post");
    expect(typeof row?.idempotency?.hits).toBe("number");
    expect(typeof row?.idempotency?.misses).toBe("number");
    expect(typeof row?.dedupe?.hits).toBe("number");
    expect(typeof row?.dedupe?.misses).toBe("number");
    expect(Array.isArray(row?.budgetViolations)).toBe(true);
  });
});
