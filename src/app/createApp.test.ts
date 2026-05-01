import { describe, expect, it, vi } from "vitest";
import { createApp } from "./createApp.js";
import { requestMetricsCollector } from "../observability/request-metrics.collector.js";
import { errorRingBuffer } from "../observability/error-ring-buffer.js";

describe("backend foundation routes", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", INTERNAL_DASHBOARD_TOKEN: undefined });

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

  it("relays public expo push sends with permissive CORS", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://exp.host/--/api/v2/push/send");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        accept: "application/json",
        "accept-encoding": "gzip, deflate",
        "content-type": "application/json"
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        to: "ExponentPushToken[test-token]",
        sound: "default",
        title: "Locava",
        body: "Hello from Backendv2",
        data: { source: "vitest" }
      });
      return new Response(
        JSON.stringify({
          data: [{ status: "ok", id: "ticket-123" }]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/public/expo-push",
        payload: {
          to: "ExponentPushToken[test-token]",
          body: "Hello from Backendv2",
          data: { source: "vitest" }
        }
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
      expect(res.json().ok).toBe(true);
      expect(res.json().data.expo.data[0].status).toBe("ok");

      const preflight = await app.inject({
        method: "OPTIONS",
        url: "/api/public/expo-push"
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers["access-control-allow-origin"]).toBe("*");
      expect(preflight.headers["access-control-allow-methods"]).toContain("POST");
    } finally {
      vi.unstubAllGlobals();
    }
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
    const local = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", FIRESTORE_SOURCE_ENABLED: false });
    try {
      const res = await local.inject({
        method: "GET",
        url: "/api/posts/post_compat_probe",
        headers: { "x-viewer-id": "session-user-xyz", "x-viewer-roles": "internal" }
      });
      expect(res.statusCode).toBe(503);
      const body = res.json() as { success?: boolean; error?: string };
      expect(body.success).toBe(false);
      expect(body.error).toBe("Firestore unavailable");
    } finally {
      await local.close();
    }
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

  it("dashboard data endpoint returns 200 locally and html endpoint returns html", async () => {
    requestMetricsCollector.clear();
    errorRingBuffer.clear();
    const dataRes = await app.inject({ method: "GET", url: "/internal/health-dashboard/data" });
    expect(dataRes.statusCode).toBe(200);
    expect(dataRes.json().ok).toBe(true);
    expect(dataRes.json().data.routeHealth).toBeTruthy();

    const htmlRes = await app.inject({ method: "GET", url: "/internal/health-dashboard" });
    expect(htmlRes.statusCode).toBe(200);
    expect(htmlRes.headers["content-type"]).toContain("text/html");
    expect(htmlRes.body).toContain("Locava Backendv2 Health Dashboard");
  });

  it("dashboard rejects the wrong token when INTERNAL_DASHBOARD_TOKEN is set", async () => {
    const secured = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      INTERNAL_DASHBOARD_TOKEN: "expected-token"
    });
    try {
      const res = await secured.inject({
        method: "GET",
        url: "/internal/health-dashboard/data",
        headers: {
          "x-internal-dashboard-token": "wrong-token"
        }
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("unauthorized");
    } finally {
      await secured.close();
    }
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
      payload: {
        groupName: "Renamed probe group",
        participants: ["aXngoh9jeqW35FNM3fq1w9aXdEh1", "chat_user_5", "chat_user_305"]
      }
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().data.routeName).toBe("chats.updategroup.post");
    expect(upd.json().data.participantIds).toEqual([
      "aXngoh9jeqW35FNM3fq1w9aXdEh1",
      "chat_user_5",
      "chat_user_305"
    ]);

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

  it("V2 conversation detail returns participants and group metadata for seeded chats", async () => {
    const headers = { "x-viewer-id": "aXngoh9jeqW35FNM3fq1w9aXdEh1", "x-viewer-roles": "internal" };
    const inbox = await app.inject({ method: "GET", url: "/v2/chats/inbox?limit=20", headers });
    expect(inbox.statusCode).toBe(200);
    const items = (inbox.json().data.items ?? []) as Array<{ conversationId: string; isGroup: boolean }>;
    const group = items.find((c) => c.isGroup);
    expect(group).toBeTruthy();
    const detail = await app.inject({
      method: "GET",
      url: `/v2/chats/${encodeURIComponent(group!.conversationId)}`,
      headers
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.routeName).toBe("chats.conversation.get");
    expect(Array.isArray(detail.json().data.conversation.participantIds)).toBe(true);
    expect(detail.json().data.conversation.isGroup).toBe(true);
  });
});
