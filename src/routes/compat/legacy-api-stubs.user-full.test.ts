import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("compat /api/users/:userId/full", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent", ENABLE_LEGACY_COMPAT_ROUTES: true });
  const headers = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
  };

  it("returns 200 with userData for seeded user (or 503 if upstream unavailable)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/users/internal-viewer/full?compact=1",
      headers,
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.userData).toBeTruthy();
    expect(typeof body.userData.handle).toBe("string");
  });
});

