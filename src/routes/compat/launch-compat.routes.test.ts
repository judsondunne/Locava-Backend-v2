import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app/createApp.js";
import { resetVersionConfigCacheForTests } from "../../services/config/versionConfig.service.js";

const resolveVersionConfig = vi.hoisted(() => vi.fn());

vi.mock("../../services/config/versionConfig.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/config/versionConfig.service.js")>();
  return {
    ...actual,
    resolveVersionConfig
  };
});

describe("launch compat routes", () => {
  const app = createApp({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    INTERNAL_DASHBOARD_TOKEN: undefined,
    ENABLE_LEGACY_COMPAT_ROUTES: true
  });

  afterEach(() => {
    resetVersionConfigCacheForTests();
    resolveVersionConfig.mockReset();
  });

  it("returns the flat native version contract at the HTTP root", async () => {
    resolveVersionConfig.mockResolvedValue({
      success: true,
      versionNumber: "3.3.9",
      forceUpdate: true,
      shouldUpdate: true,
      source: "firestore",
      cacheAgeMs: 0
    });

    const response = await app.inject({ method: "GET", url: "/api/config/version" });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      success?: boolean;
      versionNumber?: string;
      forceUpdate?: boolean;
      shouldUpdate?: boolean;
      latestVersion?: string;
      minimumVersion?: string;
      updateAvailable?: boolean;
      updateRequired?: boolean;
      ok?: boolean;
      data?: unknown;
    };

    expect(body.ok).toBeUndefined();
    expect(body.data).toBeUndefined();
    expect(body.success).toBe(true);
    expect(body.versionNumber).toBe("3.3.9");
    expect(body.forceUpdate).toBe(true);
    expect(body.shouldUpdate).toBe(true);
    expect(body.latestVersion).toBe("3.3.9");
    expect(body.minimumVersion).toBe("3.3.9");
    expect(body.updateAvailable).toBe(true);
    expect(body.updateRequired).toBe(true);
  });
});
