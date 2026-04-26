import { describe, expect, it } from "vitest";
import { buildFinalizedSessionAssetPlan, buildStableSessionAssetId } from "./wasabi-presign.service.js";
import type { WasabiRuntimeConfig } from "./wasabi-config.js";

const mockCfg: WasabiRuntimeConfig = {
  bucketName: "bucket",
  region: "us-east-1",
  endpoint: "https://s3.us-east-1.wasabisys.com",
  accessKeyId: "test",
  secretAccessKey: "secret"
};

describe("wasabi-presign.service", () => {
  it("buildStableSessionAssetId matches v1-style deterministic ids", () => {
    expect(buildStableSessionAssetId("sess-a", 0, "photo")).toBe(
      buildStableSessionAssetId("sess-a", 0, "photo")
    );
    expect(buildStableSessionAssetId("sess-a", 0, "photo")).not.toBe(
      buildStableSessionAssetId("sess-a", 1, "photo")
    );
    expect(buildStableSessionAssetId("sess-a", 0, "video")).toMatch(/^video_/);
    expect(buildStableSessionAssetId("sess-a", 0, "photo")).toMatch(/^image_/);
  });

  it("buildFinalizedSessionAssetPlan matches image/video key layout", () => {
    const photo = buildFinalizedSessionAssetPlan(mockCfg, "s", 2, "photo");
    expect(photo.originalKey).toMatch(/^images\/.*_pending\.jpg$/);
    expect(photo.originalUrl).toContain(photo.originalKey);

    const video = buildFinalizedSessionAssetPlan(mockCfg, "s", 2, "video");
    expect(video.originalKey).toMatch(/^videos\/.*\.mp4$/);
    expect(video.posterKey).toMatch(/_poster\.jpg$/);
    expect(video.posterUrl).toContain(video.posterKey!);
  });
});
