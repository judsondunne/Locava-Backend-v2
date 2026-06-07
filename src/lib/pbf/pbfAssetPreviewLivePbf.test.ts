import { describe, expect, it } from "vitest";
import { getPbfAssetPreviewLiveSources } from "./pbfAssetPreviewLivePbf.service.js";

describe("pbfAssetPreviewLivePbf", () => {
  it("reports Vermont PBF live source metadata", async () => {
    const sources = await getPbfAssetPreviewLiveSources({ tileStepDegrees: 0.4 });
    expect(sources.ok).toBe(true);
    expect(sources.totalTiles).toBeGreaterThan(0);
    expect(sources.tileStepDegrees).toBe(0.4);
    expect(sources.resolvedPath).toContain("vermont-latest.osm.pbf");
  });
});
