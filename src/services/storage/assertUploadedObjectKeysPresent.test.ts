import { describe, expect, it, vi } from "vitest";
import { assertUploadedObjectKeysPresent } from "./assertUploadedObjectKeysPresent.js";
import type { WasabiRuntimeConfig } from "./wasabi-config.js";

const cfg = {
  bucketName: "test-bucket",
  region: "us-east-1",
  endpoint: "https://s3.example.com",
  accessKeyId: "ak",
  secretAccessKey: "sk",
  publicBaseUrl: "https://cdn.example.com",
} as WasabiRuntimeConfig;

describe("assertUploadedObjectKeysPresent", () => {
  it("fails when required probe finds key missing after HEAD + public fallback", async () => {
    const waitForKeys = vi.fn().mockResolvedValue({
      success: true,
      presentKeys: [],
    });
    const headPublicUrl = vi.fn().mockResolvedValue(false);

    const result = await assertUploadedObjectKeysPresent(cfg, ["posts/a/video.mp4"], {
      requireStorageProbe: true,
      waitForKeys,
      headPublicUrl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missingKeys).toEqual(["posts/a/video.mp4"]);
    }
  });

  it("passes when object appears via public HEAD fallback", async () => {
    const waitForKeys = vi.fn().mockResolvedValue({
      success: true,
      presentKeys: [],
    });
    const headPublicUrl = vi.fn().mockResolvedValue(true);

    const result = await assertUploadedObjectKeysPresent(cfg, ["posts/a/video.mp4"], {
      requireStorageProbe: true,
      waitForKeys,
      headPublicUrl,
    });

    expect(result).toEqual({ ok: true, presentKeys: ["posts/a/video.mp4"] });
  });

  it("soft mode still ok when keys missing", async () => {
    const waitForKeys = vi.fn().mockResolvedValue({
      success: true,
      presentKeys: [],
    });
    const headPublicUrl = vi.fn().mockResolvedValue(false);

    const result = await assertUploadedObjectKeysPresent(cfg, ["posts/a/video.mp4"], {
      requireStorageProbe: false,
      waitForKeys,
      headPublicUrl,
    });

    expect(result.ok).toBe(true);
  });
});
