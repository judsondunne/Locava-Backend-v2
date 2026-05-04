import { describe, expect, it } from "vitest";
import { normalizeMasterPostV2 } from "./normalizeMasterPostV2.js";
import { diffMasterPostPreview } from "./diffMasterPostPreview.js";

describe("diffMasterPostPreview", () => {
  it("reports additive summary fields", () => {
    const raw = {
      id: "post1",
      userId: "u1",
      createdAt: "2026-05-04T00:00:00.000Z",
      likes: [{ userId: "a" }, { userId: "b" }],
      photoLink: "https://legacy/x.jpg"
    };
    const normalized = normalizeMasterPostV2(raw, { postId: "post1" });
    const diff = diffMasterPostPreview({
      raw,
      canonical: normalized.canonical,
      recoveredLegacyAssets: normalized.recoveredLegacyAssets,
      dedupedAssets: normalized.dedupedAssets,
      warnings: normalized.warnings,
      errors: normalized.errors,
      processingDebugExtracted: false
    });
    expect(diff.fieldsAdded).toContain("schema");
    expect(diff.mediaAssetCountBefore).toBe(0);
    expect(diff.mediaAssetCountAfter).toBeGreaterThan(0);
    expect(diff.compatibilityFieldsGenerated).toContain("photoLink");
  });
});
