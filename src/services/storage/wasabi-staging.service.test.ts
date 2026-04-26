import { describe, expect, it } from "vitest";
import {
  postSessionStagingObjectKey,
  postSessionStagingObjectKeyForAsset,
  postSessionStagingPosterObjectKey,
  postSessionStagingPrefix
} from "./wasabi-staging.service.js";

describe("wasabi-staging.service keys", () => {
  it("matches v1 postSessionStaging layout", () => {
    expect(postSessionStagingPrefix("u1", "sess")).toBe("postSessionStaging/u1/sess/");
    expect(postSessionStagingObjectKey("u1", "sess", 2, "jpg")).toBe("postSessionStaging/u1/sess/2.jpg");
    expect(postSessionStagingObjectKeyForAsset("u1", "sess", 2, "video")).toBe(
      "postSessionStaging/u1/sess/2.mp4"
    );
    expect(postSessionStagingPosterObjectKey("u1", "sess", 2)).toBe("postSessionStaging/u1/sess/2.poster.jpg");
  });
});
