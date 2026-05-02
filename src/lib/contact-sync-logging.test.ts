import { describe, expect, it, vi } from "vitest";

describe("contact sync logging", () => {
  it("redacts sensitive keys from structured logs in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CONTACT_SYNC_VERBOSE_DIAGNOSTICS", "false");
    vi.resetModules();
    const { redactContactSyncLogPayload } = await import("./contact-sync-logging.js");
    const out = redactContactSyncLogPayload({
      matchedUsers: [{ userId: "x" }],
      phoneSample: "555",
      matchedCount: 3,
    });
    expect(out).not.toHaveProperty("matchedUsers");
    expect(out).not.toHaveProperty("phoneSample");
    expect((out as { matchedCount?: number }).matchedCount).toBe(3);
    vi.unstubAllEnvs();
  });
});
