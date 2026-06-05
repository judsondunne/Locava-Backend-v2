import { describe, expect, it } from "vitest";
import { mergeAssetLocationsIntoPostRecord } from "./mergeAssetLocationsIntoPostRecord.js";

describe("mergeAssetLocationsIntoPostRecord", () => {
  it("merges top-level assetLocations into media.assets location.coordinates", () => {
    const post: Record<string, unknown> = {
      postId: "post_claim",
      lat: 43.63,
      long: -72.41,
      assetLocations: [
        { lat: 43.538513, long: -72.393622 },
        { lat: 43.537972, long: -72.393845 },
      ],
      media: {
        assets: [
          { id: "img_0", index: 0, type: "image" },
          { id: "vid_1", index: 1, type: "video" },
        ],
      },
    };

    const stats = mergeAssetLocationsIntoPostRecord(post);
    expect(stats.assetsWithCoordinates).toBe(2);

    const assets = (post.media as { assets: Array<{ location?: { coordinates?: { lat?: number; lng?: number } } }> })
      .assets;
    expect(assets[0]?.location?.coordinates?.lat).toBe(43.538513);
    expect(assets[0]?.location?.coordinates?.lng).toBe(-72.393622);
    expect(assets[1]?.location?.coordinates?.lat).toBe(43.537972);
    expect(assets[1]?.location?.coordinates?.lng).toBe(-72.393845);
  });

  it("does not overwrite existing per-asset coordinates with post-level lat/lng", () => {
    const post: Record<string, unknown> = {
      postId: "post_keep_asset",
      lat: 99,
      long: 88,
      assetLocations: [{ lat: 43.5, long: -72.4 }],
      media: {
        assets: [
          {
            id: "img_0",
            type: "image",
            location: {
              coordinates: { lat: 43.538513, lng: -72.393622 },
              source: "asset_exif",
            },
          },
        ],
      },
    };

    mergeAssetLocationsIntoPostRecord(post);
    const asset = (post.media as { assets: Array<{ location?: { coordinates?: { lat?: number; lng?: number } } }> })
      .assets[0];
    expect(asset?.location?.coordinates?.lat).toBe(43.538513);
    expect(asset?.location?.coordinates?.lng).toBe(-72.393622);
  });
});
