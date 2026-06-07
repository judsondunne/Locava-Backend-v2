import { describe, expect, it } from "vitest";
import { renderPbfPhotoAssetPreviewPage } from "./pbf-photo-asset-preview.js";

describe("pbf-photo-asset-preview page", () => {
  it("renders standalone photo preview page with fetch button", () => {
    const html = renderPbfPhotoAssetPreviewPage();
    expect(html).toContain("PBF Photo Preview");
    expect(html).toContain("SCAN PBF + FETCH PHOTOS");
    expect(html).toContain("vermont-latest.osm.pbf");
    expect(html).toContain("fetch-stream-live");
    expect(html).toContain("Strict title/source match");
    expect(html).toContain("Show rejected results");
    expect(html).toContain("strictTitleSourceMatch");
  });
});
