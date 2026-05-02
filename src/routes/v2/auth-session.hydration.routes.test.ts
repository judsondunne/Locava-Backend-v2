import { describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/source-of-truth/auth-bootstrap-firestore.adapter.js", () => ({
  AuthBootstrapFirestoreAdapter: class {
    isEnabled() {
      return true;
    }
    markUnavailableBriefly() {}
    async getViewerBootstrapFields(viewerId: string) {
      return {
        data: {
          uid: viewerId,
          email: "hydrated@example.com",
          handle: "hydrated-user",
          name: "Hydrated User",
          profilePic: "https://cdn.example.com/p-large.jpg",
          profilePicSmallPath: "https://cdn.example.com/p-small.jpg",
          profilePicMediumPath: "https://cdn.example.com/p-medium.jpg",
          profilePicLargePath: "https://cdn.example.com/p-large.jpg",
          badge: "standard",
          unreadCount: 0,
          onboardingComplete: true
        },
        queryCount: 0,
        readCount: 1
      };
    }
  }
}));

describe("v2 auth/session hydration behavior", () => {
  it("avoids minimal fallback for immediate session hydration", async () => {
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", FIRESTORE_TEST_MODE: "disabled" });
    try {
      const headers = {
        "x-viewer-id": "hydrated-user-1",
        "x-viewer-roles": "internal"
      };
      const timedOut = await app.inject({
        method: "GET",
        url: "/v2/auth/session?debugSlowDeferredMs=300",
        headers
      });
      expect(timedOut.statusCode).toBe(200);
      expect(timedOut.json().data.firstRender.account.viewerReady).toBe(true);
      expect(timedOut.json().data.firstRender.account.profileHydrationStatus).toBe("ready");
      expect(timedOut.json().data.firstRender.account.reason ?? null).toBe(null);

      const retried = await app.inject({
        method: "GET",
        url: "/v2/auth/session",
        headers
      });
      expect(retried.statusCode).toBe(200);
      expect(retried.json().data.firstRender.account.viewerReady).toBe(true);
      expect(retried.json().data.firstRender.viewer.photoUrl).toBe("https://cdn.example.com/p-large.jpg");
      expect(retried.json().data.firstRender.viewer.canonicalUserId).toBe("hydrated-user-1");
    } finally {
      await app.close();
    }
  }, 15_000);
});
