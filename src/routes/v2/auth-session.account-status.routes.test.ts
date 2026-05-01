import { describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/source-of-truth/auth-bootstrap-firestore.adapter.js", () => ({
  AuthBootstrapFirestoreAdapter: class {
    isEnabled() {
      return true;
    }
    markUnavailableBriefly() {}
    async getViewerBootstrapFields() {
      return {
        data: {
          handle: "needs-onboarding",
          badge: "standard",
          unreadCount: 0,
          onboardingComplete: false
        },
        queryCount: 0,
        readCount: 1
      };
    }
  }
}));

describe("v2 auth/session account status", () => {
  it("surfaces onboarding-required status for signed-in incomplete users", async () => {
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", FIRESTORE_TEST_MODE: "disabled" });
    try {
      const res = await app.inject({
        method: "GET",
        url: "/v2/auth/session",
        headers: {
          "x-viewer-id": "needs-onboarding-user",
          "x-viewer-roles": "internal"
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.firstRender.account.status).toBe("existing_incomplete");
      expect(body.data.firstRender.account.onboardingComplete).toBe(false);
      expect(body.data.deferred.viewerSummary.onboardingComplete).toBe(false);
    } finally {
      await app.close();
    }
  }, 15_000);
});
