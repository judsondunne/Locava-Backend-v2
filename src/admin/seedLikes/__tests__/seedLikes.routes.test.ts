import { describe, expect, it } from "vitest";
import { createApp } from "../../../app/createApp.js";

describe("admin seed-likes routes", () => {
  it("exposes status and default config without auth", async () => {
    const app = createApp({
      NODE_ENV: "development",
      LOG_LEVEL: "silent",
      INTERNAL_DASHBOARD_TOKEN: "seed-likes-test-token"
    });
    const res = await app.inject({
      method: "GET",
      url: "/admin/seed-likes/status"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.isRunning).toBe(false);
    expect(body.defaultConfig.minExistingLikes).toBe(10);
    expect(body.defaultConfig.targetMin).toBe(18);
    expect(body.defaultConfig.targetMax).toBe(24);
  });

  it("blocks writes when allowWrites is false in request config", async () => {
    const app = createApp({
      NODE_ENV: "development",
      LOG_LEVEL: "silent"
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/seed-likes/write-first",
      headers: {
        "content-type": "application/json"
      },
      payload: {
        config: {
          allowWrites: false,
          allowTargetBelowMin: false,
          minExistingLikes: 10,
          targetMin: 18,
          targetMax: 24,
          batchSize: 50,
          maxPostsPerRun: 0,
          useOldWebLikers: true,
          runIdPrefix: "seed-likes"
        }
      }
    });
    expect(res.statusCode).toBe(403);
  });
});
