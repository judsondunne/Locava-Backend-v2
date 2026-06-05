import { describe, expect, it } from "vitest";
import {
  applyPostingFinalizeAssetLocationsToAssets,
  buildCanonicalAssetLocationBlock,
  normalizePostingFinalizeAssetLocationRows,
} from "./applyPostingFinalizeAssetLocations.js";

describe("applyPostingFinalizeAssetLocations", () => {
  it("writes canonical location blocks for mixed image + video assets", () => {
    const assets: Record<string, unknown>[] = [
      { id: "a0", type: "photo" },
      { id: "a1", type: "video" },
    ];
    const rows = normalizePostingFinalizeAssetLocationRows(
      [
        { lat: 43.5, long: -72.4, source: "asset_exif" },
        { lat: 43.51, long: -72.39, source: "asset_media_library" },
      ],
      2,
    );
    const stats = applyPostingFinalizeAssetLocationsToAssets(assets, rows);
    expect(stats.assetsWithCoordinates).toBe(2);
    const loc0 = assets[0]?.location as { coordinates: { lat: number; lng: number }; source: string };
    const loc1 = assets[1]?.location as { coordinates: { lat: number; lng: number }; source: string };
    expect(loc0.coordinates.lat).toBe(43.5);
    expect(loc0.coordinates.lng).toBe(-72.4);
    expect(loc0.source).toBe("asset_exif");
    expect(loc1.source).toBe("asset_media_library");
    expect(assets[0]?.lat).toBe(43.5);
    expect(assets[1]?.lng).toBe(-72.39);
  });

  it("does not fake coordinates for assets without GPS", () => {
    const assets: Record<string, unknown>[] = [{ id: "a0", type: "photo" }];
    const rows = normalizePostingFinalizeAssetLocationRows([{ lat: null, long: null }], 1);
    const stats = applyPostingFinalizeAssetLocationsToAssets(assets, rows);
    expect(stats.assetsWithCoordinates).toBe(0);
    expect(assets[0]?.location).toBeUndefined();
    expect(assets[0]?.lat).toBeUndefined();
  });

  it("allows explicit post_fallback source", () => {
    const assets: Record<string, unknown>[] = [{ id: "a0", type: "photo" }];
    const rows = normalizePostingFinalizeAssetLocationRows(
      [{ lat: 40.7, long: -75.2, source: "post_fallback" }],
      1,
    );
    applyPostingFinalizeAssetLocationsToAssets(assets, rows);
    const loc = assets[0]?.location as { source: string };
    expect(loc.source).toBe("post_fallback");
  });

  it("builds geohash on canonical location block", () => {
    const block = buildCanonicalAssetLocationBlock({
      lat: 40.7,
      lng: -75.2,
      source: "asset_exif",
    });
    const coords = block.coordinates as { geohash?: string };
    expect(typeof coords.geohash).toBe("string");
    expect((coords.geohash ?? "").length).toBeGreaterThan(0);
  });
});
