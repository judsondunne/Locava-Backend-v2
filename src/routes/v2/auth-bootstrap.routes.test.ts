import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 auth/session/bootstrap routes", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("allows non-internal viewer (signed-in surfaces are not internal-gated)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/auth/session",
      headers: {
        "x-viewer-id": "user-1"
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("includes minimal viewer identity hints from optional headers without waiting on viewerSummary", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/auth/session",
      headers: {
        "x-viewer-id": "user-hdr",
        "x-viewer-roles": "internal",
        "x-viewer-email": "a@example.com",
        "x-viewer-handle": "ahandle",
        "x-viewer-name": "A User",
        "x-viewer-photo-url": "https://cdn.example.com/p.jpg"
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.firstRender.viewer.email).toBe("a@example.com");
    expect(body.data.firstRender.viewer.handle).toBe("ahandle");
    expect(body.data.firstRender.viewer.name).toBe("A User");
    expect(body.data.firstRender.viewer.photoUrl).toBe("https://cdn.example.com/p.jpg");
  });

  it("returns session payload for internal viewer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/auth/session",
      headers: {
        "x-viewer-id": "user-1",
        "x-viewer-roles": "internal"
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.routeName).toBe("auth.session.get");
    expect(body.data.firstRender.viewer.id).toBe("user-1");
  });

  it("falls back when deferred session enrichment is slow", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/auth/session?debugSlowDeferredMs=950",
      headers: {
        "x-viewer-id": "slow-user",
        "x-viewer-roles": "internal"
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.degraded).toBe(false);
    expect(body.data.fallbacks).toContain("viewer_summary_timeout");
    const summaryHandle = String(body.data.deferred?.viewerSummary?.handle ?? "");
    expect(summaryHandle.startsWith("user_")).toBe(false);
  });

  it("returns bootstrap payload for internal viewer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/bootstrap",
      headers: {
        "x-viewer-id": "user-2",
        "x-viewer-roles": "internal"
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("bootstrap.init.get");
    expect(body.data.firstRender.viewer.authenticated).toBe(true);
  });

  it("records db ops and observability fields", async () => {
    await app.inject({
      method: "GET",
      url: "/v2/bootstrap",
      headers: {
        "x-viewer-id": "user-3",
        "x-viewer-roles": "internal"
      }
    });

    const diagnostics = await app.inject({ method: "GET", url: "/diagnostics?limit=5" });
    expect(diagnostics.statusCode).toBe(200);
    const body = diagnostics.json();
    const match = body.data.recentRequests.find((row: { routeName?: string }) => row.routeName === "bootstrap.init.get");
    expect(match).toBeTruthy();
    expect(match.dbOps.reads).toBeGreaterThan(0);
  });

  it("prewarms the first notifications page during auth session bootstrap", async () => {
    const headers = {
      "x-viewer-id": "user-4",
      "x-viewer-roles": "internal"
    };

    const session = await app.inject({
      method: "GET",
      url: "/v2/auth/session",
      headers
    });
    expect(session.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 850));

    const notifications = await app.inject({
      method: "GET",
      url: "/v2/notifications?limit=10",
      headers
    });
    expect(notifications.statusCode).toBe(200);
    expect(notifications.json().meta.db.reads).toBe(0);
    expect(notifications.json().meta.db.queries).toBe(0);
  });
});
