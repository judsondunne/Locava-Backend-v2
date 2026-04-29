import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("compat /api/reports/*", () => {
  it("POST /api/reports/post returns 201 with reportId (mock when Firestore disabled)", async () => {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", FIRESTORE_SOURCE_ENABLED: false });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/reports/post",
        headers: {
          "x-viewer-id": "internal-viewer",
          "x-viewer-roles": "internal",
          "content-type": "application/json"
        },
        payload: JSON.stringify({ postId: "post_123", reason: "Spam" })
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { success?: boolean; reportId?: string };
      expect(body.success).toBe(true);
      expect(typeof body.reportId).toBe("string");
      expect(body.reportId!.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("POST /api/reports/post returns 401 without viewer identity", async () => {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", FIRESTORE_SOURCE_ENABLED: false });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/reports/post",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ postId: "post_123", reason: "Spam" })
      });
      expect(res.statusCode).toBe(401);
      expect((res.json() as { success?: boolean }).success).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("POST /api/reports/post returns 400 for missing postId/reason", async () => {
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", FIRESTORE_SOURCE_ENABLED: false });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/reports/post",
        headers: {
          "x-viewer-id": "internal-viewer",
          "x-viewer-roles": "internal",
          "content-type": "application/json"
        },
        payload: JSON.stringify({})
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { success?: boolean }).success).toBe(false);
    } finally {
      await app.close();
    }
  });
});

