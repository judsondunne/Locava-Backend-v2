import { describe, expect, it } from "vitest";
import { createApp } from "./createApp.js";

describe("backend foundation routes", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("returns health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("ok");
  });

  it("validates echo payload", async () => {
    const res = await app.inject({ method: "POST", url: "/test/echo", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation_error");
  });

  it("tracks db simulation", async () => {
    const res = await app.inject({ method: "GET", url: "/test/db-simulate?reads=2&writes=1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("stubs legacy monolith paths used by native dev (no 404 spam on Backendv2)", async () => {
    const version = await app.inject({ method: "GET", url: "/api/config/version" });
    expect(version.statusCode).toBe(200);
    const vBody = version.json() as { success?: boolean; shouldUpdate?: boolean };
    expect(vBody.success).toBe(true);
    expect(vBody.shouldUpdate).toBe(false);

    const analytics = await app.inject({
      method: "POST",
      url: "/api/analytics/v2/events",
      payload: { events: [{ event: "test", eventId: "e1" }] }
    });
    expect(analytics.statusCode).toBe(202);
    expect((analytics.json() as { ok?: boolean }).ok).toBe(true);

    const userPut = await app.inject({
      method: "PUT",
      url: "/api/users/test-user-id",
      payload: { expoPushToken: "ExponentPushToken[stub]" }
    });
    expect(userPut.statusCode).toBe(200);
    expect((userPut.json() as { success?: boolean }).success).toBe(true);
  });

  it("location autocomplete returns upstream_unavailable when monolith proxy is explicitly unset", async () => {
    const local = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", LEGACY_MONOLITH_PROXY_BASE_URL: undefined });
    try {
      const res = await local.inject({ method: "GET", url: "/api/v1/product/location/autocomplete?q=test" });
      expect(res.statusCode).toBe(503);
      expect((res.json() as { code?: string }).code).toBe("upstream_unavailable");
    } finally {
      await local.close();
    }
  });

  it("PATCH /api/v1/product/viewer merges fields and uses x-viewer-id", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/product/viewer",
      headers: {
        "x-viewer-id": "firebase-user-abc",
        "x-viewer-roles": "internal",
        "content-type": "application/json"
      },
      payload: { name: "Patched Name", settings: { language: "en" } }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { viewer: { userId: string; name: string; settings?: { language?: string } }; etag?: string };
    expect(body.viewer.userId).toBe("firebase-user-abc");
    expect(body.viewer.name).toBe("Patched Name");
    expect(body.viewer.settings?.language).toBe("en");
    expect(body.etag).toMatch(/^viewer:/);
  });

  it("PATCH /api/v1/product/viewer resolves uid from Bearer JWT sub when header absent", async () => {
    const payload = Buffer.from(JSON.stringify({ sub: "jwt-resolved-uid" })).toString("base64url");
    const token = `e30.${payload}.x`;
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/product/viewer",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      payload: {}
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { viewer: { userId: string } }).viewer.userId).toBe("jwt-resolved-uid");
  });

  it("session bootstrap uses resolved viewer id from x-viewer-id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/product/session/bootstrap",
      headers: { "x-viewer-id": "session-user-xyz", "x-viewer-roles": "internal" }
    });
    expect(res.statusCode).toBe(200);
    const j = res.json() as { viewer: { userId: string }; user: { uid: string } };
    expect(j.viewer.userId).toBe("session-user-xyz");
    expect(j.user.uid).toBe("session-user-xyz");
  });

  it("compat /api/posts/:postId does not crash when Firestore is unavailable", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/posts/post_compat_probe",
      headers: { "x-viewer-id": "session-user-xyz", "x-viewer-roles": "internal" }
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { success?: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe("Firestore unavailable");
  });

  it("exposes coherence mode and operational signals in diagnostics", async () => {
    await app.inject({ method: "GET", url: "/test/ping" });
    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().data.coherence.mode).toBeDefined();

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=20" });
    expect(diagnostics.statusCode).toBe(200);
    const body = diagnostics.json().data;
    expect(body.operationalSignals).toBeTruthy();
    expect(typeof body.operationalSignals.fallbackRate).toBe("number");
    expect(typeof body.operationalSignals.timeoutRate).toBe("number");
    expect(Array.isArray(body.alerts)).toBe(true);
  });

  it("internal backfill route is unavailable without INTERNAL_OPS_TOKEN", async () => {
    const res = await app.inject({ method: "POST", url: "/internal/ops/backfill/user-search-fields", payload: {} });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("internal_ops_disabled");
  });

  it("V2 update-group and post chat messages work for seeded chats", async () => {
    const headers = { "x-viewer-id": "aXngoh9jeqW35FNM3fq1w9aXdEh1", "x-viewer-roles": "internal" };
    const inbox = await app.inject({ method: "GET", url: "/v2/chats/inbox?limit=20", headers });
    expect(inbox.statusCode).toBe(200);
    const items = (inbox.json().data.items ?? []) as Array<{ conversationId: string; isGroup: boolean }>;
    const group = items.find((c) => c.isGroup);
    expect(group).toBeTruthy();
    const gid = encodeURIComponent(group!.conversationId);
    const upd = await app.inject({
      method: "POST",
      url: `/v2/chats/${gid}/update-group`,
      headers: { ...headers, "content-type": "application/json" },
      payload: { groupName: "Renamed probe group" }
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().data.routeName).toBe("chats.updategroup.post");

    const dm = items.find((c) => !c.isGroup);
    expect(dm).toBeTruthy();
    const did = encodeURIComponent(dm!.conversationId);
    const postMsg = await app.inject({
      method: "POST",
      url: `/v2/chats/${did}/messages`,
      headers: { ...headers, "content-type": "application/json" },
      payload: { messageType: "post", postId: "post_smoke_123456" }
    });
    expect(postMsg.statusCode).toBe(200);
    expect(postMsg.json().data.message.messageType).toBe("post");
  });

  it("V2 message reaction persists on seeded messages", async () => {
    const headers = { "x-viewer-id": "aXngoh9jeqW35FNM3fq1w9aXdEh1", "x-viewer-roles": "internal" };
    const inbox = await app.inject({ method: "GET", url: "/v2/chats/inbox?limit=10", headers });
    expect(inbox.statusCode).toBe(200);
    const convId = String((inbox.json().data.items[0] as { conversationId?: string })?.conversationId ?? "");
    expect(convId.length).toBeGreaterThan(0);
    const thread = await app.inject({
      method: "GET",
      url: `/v2/chats/${encodeURIComponent(convId)}/messages?limit=10`,
      headers
    });
    expect(thread.statusCode).toBe(200);
    const mid = String((thread.json().data.items[0] as { messageId?: string })?.messageId ?? "");
    expect(mid.length).toBeGreaterThan(0);
    const react = await app.inject({
      method: "POST",
      url: `/v2/chats/${encodeURIComponent(convId)}/messages/${encodeURIComponent(mid)}/reaction`,
      headers: { ...headers, "content-type": "application/json" },
      payload: { emoji: "🔥" }
    });
    expect(react.statusCode).toBe(200);
    const body = react.json().data;
    expect(body.viewerReaction).toBe("🔥");
    const thread2 = await app.inject({
      method: "GET",
      url: `/v2/chats/${encodeURIComponent(convId)}/messages?limit=10`,
      headers
    });
    const first = thread2.json().data.items[0] as { reactions?: Record<string, string> };
    expect(first.reactions?.["aXngoh9jeqW35FNM3fq1w9aXdEh1"]).toBe("🔥");
  });
});
